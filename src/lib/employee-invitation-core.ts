import {
  hashPassword,
  isPasswordValid,
} from "./auth-core.ts";
import {
  AuthorizationError,
  type OrganizationPermission,
} from "./authorization-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";
import { createHash, randomBytes } from "node:crypto";

export const EMPLOYEE_INVITATION_TTL_MS = 72 * 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type InvitationStatus =
  | "valid"
  | "invalid"
  | "expired"
  | "consumed"
  | "inactive"
  | "already_activated";

export type StoredEmployeeInvitation = {
  id: string;
  userId: string;
  organizationId: string;
  membershipId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  hasPasswordCredential: boolean;
  membership: {
    id: string;
    userId: string;
    organizationId: string;
    active: boolean;
    role: string;
  } | null;
};

export type InvitationCreation =
  | { status: "created"; invitationId: string; email: string }
  | { status: "not_found" | "inactive" | "wrong_role" | "existing_credential" };

export interface EmployeeInvitationStore {
  createInvitation(
    organizationId: string,
    membershipId: string,
    tokenHash: string,
    expiresAt: Date,
    now: Date,
  ): Promise<InvitationCreation>;
  invalidateInvitation(invitationId: string, now: Date): Promise<void>;
  findInvitation(tokenHash: string): Promise<StoredEmployeeInvitation | null>;
  activate(tokenHash: string, passwordHash: string, now: Date): Promise<InvitationStatus>;
}

export interface EmployeeInvitationDelivery {
  available: boolean;
  send(email: string, activationUrl: string): Promise<void>;
}

export function createInvitationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isInvitationToken(value: unknown): value is string {
  return typeof value === "string" && tokenPattern.test(value);
}

export function isEmployeeInvitationTarget(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function getEmployeeInvitationStatus(
  invitation: StoredEmployeeInvitation | null,
  now: Date,
): InvitationStatus {
  if (!invitation) return "invalid";
  if (invitation.consumedAt !== null) return "consumed";
  if (invitation.expiresAt.getTime() <= now.getTime()) return "expired";

  const membership = invitation.membership;
  if (
    !membership ||
    membership.id !== invitation.membershipId ||
    membership.userId !== invitation.userId ||
    membership.organizationId !== invitation.organizationId
  ) return "invalid";
  if (!membership.active) return "inactive";
  if (membership.role !== "MEMBER") return "invalid";
  if (invitation.hasPasswordCredential) return "already_activated";
  return "valid";
}

export async function validateEmployeeInvitation(
  token: unknown,
  store: EmployeeInvitationStore,
  now = new Date(),
): Promise<InvitationStatus> {
  if (!isInvitationToken(token)) return "invalid";
  return getEmployeeInvitationStatus(await store.findInvitation(hashInvitationToken(token)), now);
}

export type InvitationCreationResult =
  | { status: "created" }
  | { status: "not_found" | "inactive" | "wrong_role" | "existing_credential" }
  | { status: "delivery_unavailable" | "delivery_failed" };

export async function createEmployeeInvitation(
  organizationId: string,
  membershipId: string,
  store: EmployeeInvitationStore,
  delivery: EmployeeInvitationDelivery,
  appUrl: string | undefined,
  now = new Date(),
  onCleanupFailure?: () => void,
): Promise<InvitationCreationResult> {
  if (!delivery.available || !isEmployeeInvitationTarget(membershipId)) {
    return { status: "delivery_unavailable" };
  }

  let activationUrl: URL;
  try {
    if (!appUrl) return { status: "delivery_unavailable" };
    const configuredUrl = new URL(appUrl);
    if (configuredUrl.protocol !== "https:" && configuredUrl.protocol !== "http:") {
      return { status: "delivery_unavailable" };
    }
    activationUrl = new URL("/auth/activate", configuredUrl.origin);
  } catch {
    return { status: "delivery_unavailable" };
  }

  const rawToken = createInvitationToken();
  const creation = await store.createInvitation(
    organizationId,
    membershipId,
    hashInvitationToken(rawToken),
    new Date(now.getTime() + EMPLOYEE_INVITATION_TTL_MS),
    now,
  );
  if (creation.status !== "created") return creation;

  activationUrl.hash = new URLSearchParams({ token: rawToken }).toString();
  try {
    await delivery.send(creation.email, activationUrl.toString());
  } catch {
    try {
      await store.invalidateInvitation(creation.invitationId, now);
    } catch {
      onCleanupFailure?.();
    }
    return { status: "delivery_failed" };
  }

  return { status: "created" };
}

export function parseEmployeeInvitationRequest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

function parseTokenRequest(value: unknown): { token: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "token")) return null;
  return isInvitationToken(input.token) ? { token: input.token } : null;
}

function parseActivationRequest(
  value: unknown,
): { token: string; password: string; confirmPassword: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 3 ||
    !Object.hasOwn(input, "token") ||
    !Object.hasOwn(input, "password") ||
    !Object.hasOwn(input, "confirmPassword") ||
    !isInvitationToken(input.token) ||
    typeof input.password !== "string" ||
    typeof input.confirmPassword !== "string"
  ) return null;
  return {
    token: input.token,
    password: input.password,
    confirmPassword: input.confirmPassword,
  };
}

type InvitationHandlerDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<unknown>;
  store: EmployeeInvitationStore;
  delivery: EmployeeInvitationDelivery;
  appUrl?: string;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: "invite" | "validate" | "activate" | "cleanup"): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });

function errorResponse(
  error: unknown,
  operation: "invite" | "validate" | "activate",
  logError?: InvitationHandlerDependencies["logError"],
) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (logError) logError(operation);
  else console.error("Employee invitation request could not be completed.", { operation });
  return json({ error: "invitation_unavailable" }, 503);
}

function statusResponse(status: InvitationStatus) {
  switch (status) {
    case "valid": return json({ valid: true });
    case "expired": return json({ error: "invitation_expired" }, 410);
    case "consumed": return json({ error: "invitation_already_used" }, 410);
    case "inactive": return json({ error: "employee_inactive" }, 410);
    case "already_activated": return json({ error: "account_already_activated" }, 409);
    default: return json({ error: "invalid_invitation" }, 400);
  }
}

export function createEmployeeInvitationHandler(dependencies: InvitationHandlerDependencies) {
  return async function POST(request: Request, employeeId: string): Promise<Response> {
    if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
    try {
      const tenant = await dependencies.requireTenantContext();
      await dependencies.requirePermission(tenant.organizationId, "MANAGE_MEMBERS");
      if (!isEmployeeInvitationTarget(employeeId)) return json({ error: "employee_not_found" }, 404);
      if (!parseEmployeeInvitationRequest(await dependencies.readBody(request))) {
        return json({ error: "invalid_request" }, 400);
      }

      const result = await createEmployeeInvitation(
        tenant.organizationId,
        employeeId,
        dependencies.store,
        dependencies.delivery,
        dependencies.appUrl,
        new Date(),
        () => dependencies.logError?.("cleanup"),
      );
      if (result.status === "created") return json({ success: true }, 201);
      if (result.status === "not_found") return json({ error: "employee_not_found" }, 404);
      if (result.status === "inactive" || result.status === "wrong_role" || result.status === "existing_credential") {
        return json({ error: "employee_invitation_unavailable" }, 409);
      }
      return json({ error: "invitation_delivery_unavailable" }, 503);
    } catch (error) {
      return errorResponse(error, "invite", dependencies.logError);
    }
  };
}

export function createInvitationActivationHandlers(dependencies: Pick<
  InvitationHandlerDependencies,
  "store" | "isTrustedRequest" | "readBody" | "logError"
>) {
  return {
    async VALIDATE(request: Request): Promise<Response> {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const parsed = parseTokenRequest(await dependencies.readBody(request));
        if (!parsed) return json({ error: "invalid_request" }, 400);
        return statusResponse(await validateEmployeeInvitation(parsed.token, dependencies.store));
      } catch (error) {
        return errorResponse(error, "validate", dependencies.logError);
      }
    },

    async ACTIVATE(request: Request): Promise<Response> {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const parsed = parseActivationRequest(await dependencies.readBody(request));
        if (!parsed) return json({ error: "invalid_request" }, 400);
        if (parsed.password !== parsed.confirmPassword) {
          return json({ error: "password_mismatch" }, 400);
        }
        if (!isPasswordValid(parsed.password)) return json({ error: "invalid_password" }, 400);

        const currentStatus = await validateEmployeeInvitation(parsed.token, dependencies.store);
        if (currentStatus !== "valid") return statusResponse(currentStatus);
        const activationStatus = await dependencies.store.activate(
          hashInvitationToken(parsed.token),
          await hashPassword(parsed.password),
          new Date(),
        );
        if (activationStatus === "valid") return json({ success: true });
        return statusResponse(activationStatus);
      } catch (error) {
        return errorResponse(error, "activate", dependencies.logError);
      }
    },
  };
}
