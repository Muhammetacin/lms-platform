import "server-only";
import { getAuthenticatedUser } from "@/lib/auth-server";
import { organizationMembershipStore } from "@/lib/organization-membership-store";
import {
  resolveTenantContext,
  TenantContextError,
  type TenantContext,
} from "@/lib/tenant-context-core";

/**
 * Returns null for an unauthenticated request. Any supplied organization ID is
 * untrusted until resolveTenantContext verifies the user's membership.
 */
export async function getTenantContext(
  organizationCandidate?: string | null,
): Promise<TenantContext | null> {
  let user;
  try {
    user = await getAuthenticatedUser();
  } catch {
    throw new TenantContextError("tenant_context_unavailable");
  }

  if (!user) return null;

  return resolveTenantContext(
    user,
    organizationCandidate,
    organizationMembershipStore,
  );
}

/** Require a trusted tenant context; use this at protected server operations. */
export async function requireTenantContext(
  organizationCandidate?: string | null,
): Promise<TenantContext> {
  const context = await getTenantContext(organizationCandidate);
  if (!context) throw new TenantContextError("unauthenticated");
  return context;
}

export { TenantContextError, type TenantContext } from "@/lib/tenant-context-core";
