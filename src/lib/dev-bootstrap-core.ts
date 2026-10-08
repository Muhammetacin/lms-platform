import {
  isPasswordValid,
  parseLoginCredentials,
} from "./auth-core.ts";
import type { OrganizationRole } from "../generated/prisma/enums.ts";

export class DevelopmentBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevelopmentBootstrapError";
  }
}

export type DevelopmentBootstrapConfig = {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  organizationSlug: string;
};

export type ExistingBootstrapSetup = {
  user: { id: string; email: string; name: string | null; hasPasswordCredential: boolean } | null;
  organization: { id: string; name: string } | null;
  membership: { role: OrganizationRole; active: boolean } | null;
};

export interface DevelopmentBootstrapStore {
  findSetup(email: string, organizationSlug: string): Promise<ExistingBootstrapSetup>;
  createOwnerSetup(config: DevelopmentBootstrapConfig, passwordHash: string): Promise<void>;
}

export function isProductionLikeEnvironment(environment: NodeJS.ProcessEnv): boolean {
  const deploymentIndicators = [
    environment.NODE_ENV,
    environment.APP_ENV,
    environment.ENVIRONMENT,
    environment.DEPLOYMENT_ENV,
    environment.VERCEL_ENV,
  ];
  return deploymentIndicators.some((value) => /^(prod|production)$/i.test(value?.trim() ?? ""));
}

export function readDevelopmentBootstrapConfig(
  environment: NodeJS.ProcessEnv,
): DevelopmentBootstrapConfig {
  const email = environment.DEV_BOOTSTRAP_EMAIL;
  const password = environment.DEV_BOOTSTRAP_PASSWORD;
  const credentials = parseLoginCredentials({ email, password });
  const name = environment.DEV_BOOTSTRAP_NAME?.trim() ?? "";
  const organizationName = environment.DEV_BOOTSTRAP_ORG_NAME?.trim() ?? "";
  const organizationSlug = environment.DEV_BOOTSTRAP_ORG_SLUG?.trim() ?? "";

  if (!credentials || !isPasswordValid(credentials.password)) {
    throw new DevelopmentBootstrapError(
      "Set a valid DEV_BOOTSTRAP_EMAIL and a DEV_BOOTSTRAP_PASSWORD of at least 12 characters.",
    );
  }
  if (!name || [...name].length > 120 || /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(name)) {
    throw new DevelopmentBootstrapError("Set a valid DEV_BOOTSTRAP_NAME (up to 120 characters).");
  }
  if (!organizationName || [...organizationName].length > 160 || /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(organizationName)) {
    throw new DevelopmentBootstrapError("Set a valid DEV_BOOTSTRAP_ORG_NAME (up to 160 characters).");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(organizationSlug)) {
    throw new DevelopmentBootstrapError("Set DEV_BOOTSTRAP_ORG_SLUG using lowercase letters, numbers, and single hyphens.");
  }

  return {
    email: credentials.email,
    password: credentials.password,
    name,
    organizationName,
    organizationSlug,
  };
}

export async function bootstrapDevelopmentOwner(
  environment: NodeJS.ProcessEnv,
  store: DevelopmentBootstrapStore,
  hashPassword: (password: string) => Promise<string>,
): Promise<{ created: boolean; email: string; organizationName: string }> {
  if (isProductionLikeEnvironment(environment)) {
    throw new DevelopmentBootstrapError("Development bootstrap is disabled in production environments.");
  }

  const config = readDevelopmentBootstrapConfig(environment);
  const existing = await store.findSetup(config.email, config.organizationSlug);
  if (existing.user || existing.organization) {
    const isExpectedSetup =
      existing.user?.email === config.email &&
      existing.user.name === config.name &&
      existing.user.hasPasswordCredential &&
      existing.organization?.name === config.organizationName &&
      existing.membership?.role === "OWNER" &&
      existing.membership.active;

    if (isExpectedSetup) {
      return { created: false, email: config.email, organizationName: config.organizationName };
    }

    throw new DevelopmentBootstrapError(
      "The configured email or organization slug belongs to a different setup. No data was changed.",
    );
  }

  const passwordHash = await hashPassword(config.password);
  await store.createOwnerSetup(config, passwordHash);
  return { created: true, email: config.email, organizationName: config.organizationName };
}
