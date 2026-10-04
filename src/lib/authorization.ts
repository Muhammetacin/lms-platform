import "server-only";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { organizationMembershipStore } from "@/lib/organization-membership-store";
import type { AuthenticatedUser } from "@/lib/auth-core";
import type { OrganizationRole } from "@/generated/prisma/enums";
import {
  AuthorizationError,
  can as canWithIdentity,
  requireAuthenticatedIdentity,
  requireOrganizationMembership as requireMembershipWithIdentity,
  requireOrganizationPermission as requirePermissionWithIdentity,
  requireOrganizationRole as requireRoleWithIdentity,
  type AuthorizationStore,
  type OrganizationPermission,
} from "@/lib/authorization-core";

const authorizationStore: AuthorizationStore = organizationMembershipStore;

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  let user: AuthenticatedUser | null;
  try {
    user = await getAuthenticatedUser();
  } catch {
    throw new AuthorizationError("authorization_unavailable");
  }
  return requireAuthenticatedIdentity(user);
}

export async function requireOrganizationMembership(
  organizationId: string | null | undefined,
) {
  const user = await requireAuthenticatedUser();
  return requireMembershipWithIdentity(user, organizationId, authorizationStore);
}

export async function requireOrganizationRole(
  organizationId: string | null | undefined,
  role: OrganizationRole,
) {
  const user = await requireAuthenticatedUser();
  return requireRoleWithIdentity(user, organizationId, role, authorizationStore);
}

export async function requireOrganizationPermission(
  organizationId: string | null | undefined,
  permission: OrganizationPermission,
) {
  const user = await requireAuthenticatedUser();
  return requirePermissionWithIdentity(
    user,
    organizationId,
    permission,
    authorizationStore,
  );
}

/** UX-only permission query. Protected server operations must use a require* function. */
export async function can(
  organizationId: string | null | undefined,
  permission: OrganizationPermission,
): Promise<boolean> {
  let user: AuthenticatedUser | null;
  try {
    user = await getAuthenticatedUser();
  } catch {
    return false;
  }
  return canWithIdentity(user, organizationId, permission, authorizationStore);
}
