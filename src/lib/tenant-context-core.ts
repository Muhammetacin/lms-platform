import type { OrganizationRole } from "../generated/prisma/enums";
import type { AuthenticatedUser } from "./auth-core";

export type TenantContextErrorCode =
  | "unauthenticated"
  | "no_organization_membership"
  | "invalid_organization_context"
  | "tenant_context_unavailable";

const tenantContextFailureDetails: Record<
  TenantContextErrorCode,
  { status: 401 | 403 | 503; message: string }
> = {
  unauthenticated: { status: 401, message: "Authentication is required." },
  no_organization_membership: {
    status: 403,
    message: "An organization membership is required.",
  },
  invalid_organization_context: {
    status: 403,
    message: "The requested organization context is invalid.",
  },
  tenant_context_unavailable: {
    status: 503,
    message: "Organization context is temporarily unavailable.",
  },
};

export class TenantContextError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code: TenantContextErrorCode;

  constructor(code: TenantContextErrorCode) {
    const details = tenantContextFailureDetails[code];
    super(details.message);
    this.name = "TenantContextError";
    this.code = code;
    this.status = details.status;
  }
}

export type TenantContext = {
  userId: string;
  organizationId: string;
  role: OrganizationRole;
};

export type DefaultOrganizationMembership = {
  organizationId: string;
  role: OrganizationRole;
};

export interface TenantMembershipStore {
  findOrganizationRole(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationRole | null>;
  findDefaultOrganizationMembership(
    userId: string,
  ): Promise<DefaultOrganizationMembership | null>;
}

const roles = new Set<OrganizationRole>(["OWNER", "ADMIN", "MEMBER"]);

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && roles.has(value as OrganizationRole);
}

function isOrganizationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function createTenantContext(
  user: AuthenticatedUser,
  organizationId: unknown,
  role: unknown,
): TenantContext {
  if (!isOrganizationId(organizationId) || !isOrganizationRole(role)) {
    throw new TenantContextError("tenant_context_unavailable");
  }

  return { userId: user.id, organizationId, role };
}

/**
 * Resolves a trusted organization from the authenticated identity and the
 * server-side membership store. An explicit organization ID is only a candidate.
 */
export async function resolveTenantContext(
  user: AuthenticatedUser | null,
  organizationCandidate: unknown,
  store: TenantMembershipStore,
): Promise<TenantContext> {
  if (!user) throw new TenantContextError("unauthenticated");

  if (organizationCandidate === undefined) {
    let membership: DefaultOrganizationMembership | null;
    try {
      membership = await store.findDefaultOrganizationMembership(user.id);
    } catch {
      throw new TenantContextError("tenant_context_unavailable");
    }

    if (!membership) {
      throw new TenantContextError("no_organization_membership");
    }

    return createTenantContext(user, membership.organizationId, membership.role);
  }

  if (!isOrganizationId(organizationCandidate)) {
    throw new TenantContextError("invalid_organization_context");
  }

  let role: OrganizationRole | null;
  try {
    role = await store.findOrganizationRole(user.id, organizationCandidate);
  } catch {
    throw new TenantContextError("tenant_context_unavailable");
  }

  if (role === null) {
    throw new TenantContextError("invalid_organization_context");
  }

  return createTenantContext(user, organizationCandidate, role);
}
