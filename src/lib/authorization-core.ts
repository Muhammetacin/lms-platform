import type { OrganizationRole } from "../generated/prisma/enums";
import type { AuthenticatedUser } from "./auth-core";

export type AuthorizationErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "authorization_unavailable";

const authorizationFailureDetails: Record<
  AuthorizationErrorCode,
  { status: 401 | 403 | 503; message: string }
> = {
  unauthenticated: { status: 401, message: "Authentication is required." },
  forbidden: { status: 403, message: "Access is forbidden." },
  authorization_unavailable: {
    status: 503,
    message: "Authorization is temporarily unavailable.",
  },
};

export class AuthorizationError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code: AuthorizationErrorCode;

  constructor(code: AuthorizationErrorCode) {
    const details = authorizationFailureDetails[code];
    super(details.message);
    this.name = "AuthorizationError";
    this.code = code;
    this.status = details.status;
  }
}

export type OrganizationPermission =
  | "VIEW_ORGANIZATION"
  | "VIEW_OWN_MEMBERSHIP"
  | "VIEW_EMPLOYEE_PROFILES"
  | "MANAGE_OWN_PROFILE"
  | "MANAGE_ORGANIZATION_SETTINGS"
  | "MANAGE_MEMBERS"
  | "MANAGE_TEAMS"
  | "MANAGE_COURSES"
  | "ASSIGN_TRAINING"
  | "VIEW_ORGANIZATION_REPORTS"
  | "MANAGE_ORGANIZATION_OWNERSHIP";

export const ORGANIZATION_PERMISSION_ROLES = {
  VIEW_ORGANIZATION: "MEMBER",
  VIEW_OWN_MEMBERSHIP: "MEMBER",
  VIEW_EMPLOYEE_PROFILES: "ADMIN",
  MANAGE_OWN_PROFILE: "MEMBER",
  MANAGE_ORGANIZATION_SETTINGS: "ADMIN",
  MANAGE_MEMBERS: "ADMIN",
  MANAGE_TEAMS: "ADMIN",
  MANAGE_COURSES: "ADMIN",
  ASSIGN_TRAINING: "ADMIN",
  VIEW_ORGANIZATION_REPORTS: "ADMIN",
  MANAGE_ORGANIZATION_OWNERSHIP: "OWNER",
} satisfies Record<OrganizationPermission, OrganizationRole>;

const roleRank: Record<OrganizationRole, number> = {
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

export interface AuthorizationStore {
  findOrganizationRole(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationRole | null>;
}

export type OrganizationAuthorization = {
  user: AuthenticatedUser;
  organizationId: string;
  role: OrganizationRole;
};

export function requireAuthenticatedIdentity(
  user: AuthenticatedUser | null,
): AuthenticatedUser {
  if (!user) throw new AuthorizationError("unauthenticated");
  return user;
}

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && Object.hasOwn(roleRank, value);
}

function meetsMinimumRole(
  actualRole: OrganizationRole,
  requiredRole: OrganizationRole,
): boolean {
  return roleRank[actualRole] >= roleRank[requiredRole];
}

function isOrganizationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export async function requireOrganizationMembership(
  user: AuthenticatedUser | null,
  organizationId: string | null | undefined,
  store: AuthorizationStore,
): Promise<OrganizationAuthorization> {
  const authenticatedUser = requireAuthenticatedIdentity(user);
  if (!isOrganizationId(organizationId)) {
    throw new AuthorizationError("forbidden");
  }

  let role: OrganizationRole | null;
  try {
    role = await store.findOrganizationRole(authenticatedUser.id, organizationId);
  } catch {
    throw new AuthorizationError("authorization_unavailable");
  }

  if (role === null) throw new AuthorizationError("forbidden");
  if (!isOrganizationRole(role)) {
    throw new AuthorizationError("authorization_unavailable");
  }

  return { user: authenticatedUser, organizationId, role };
}

export async function requireOrganizationRole(
  user: AuthenticatedUser | null,
  organizationId: string | null | undefined,
  requiredRole: OrganizationRole,
  store: AuthorizationStore,
): Promise<OrganizationAuthorization> {
  if (!isOrganizationRole(requiredRole)) {
    throw new AuthorizationError("forbidden");
  }

  const authorization = await requireOrganizationMembership(
    user,
    organizationId,
    store,
  );
  if (!meetsMinimumRole(authorization.role, requiredRole)) {
    throw new AuthorizationError("forbidden");
  }

  return authorization;
}

export async function requireOrganizationPermission(
  user: AuthenticatedUser | null,
  organizationId: string | null | undefined,
  permission: OrganizationPermission,
  store: AuthorizationStore,
): Promise<OrganizationAuthorization> {
  if (
    typeof permission !== "string" ||
    !Object.hasOwn(ORGANIZATION_PERMISSION_ROLES, permission)
  ) {
    throw new AuthorizationError("forbidden");
  }

  return requireOrganizationRole(
    user,
    organizationId,
    ORGANIZATION_PERMISSION_ROLES[permission],
    store,
  );
}

export async function can(
  user: AuthenticatedUser | null,
  organizationId: string | null | undefined,
  permission: OrganizationPermission,
  store: AuthorizationStore,
): Promise<boolean> {
  try {
    await requireOrganizationPermission(user, organizationId, permission, store);
    return true;
  } catch {
    return false;
  }
}
