import {
  AuthorizationError,
  type OrganizationPermission,
} from "./authorization-core.ts";
import type { OrganizationRole } from "../generated/prisma/enums.ts";
import {
  TenantContextError,
  type TenantContext,
} from "./tenant-context-core.ts";

export type AdminPortalProfile = {
  email: string;
  name: string | null;
  organizationName: string;
};

export type AdminPortalAccess =
  | { kind: "allowed"; tenant: TenantContext; profile: AdminPortalProfile }
  | { kind: "unauthenticated" }
  | { kind: "forbidden" }
  | { kind: "unavailable" };

export type AdminDashboardCounts = {
  total: number;
  draft: number;
  published: number;
};

export interface AdminPortalStore {
  getProfile(userId: string, organizationId: string): Promise<AdminPortalProfile | null>;
  getCourseCounts(organizationId: string): Promise<AdminDashboardCounts>;
}

export type AdminPortalAccessDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(
    organizationId: string,
    permission: OrganizationPermission,
  ): Promise<unknown>;
  store: Pick<AdminPortalStore, "getProfile">;
};

function accessFailure(error: unknown): "unauthenticated" | "forbidden" | "unavailable" {
  if (error instanceof TenantContextError || error instanceof AuthorizationError) {
    if (error.status === 401) return "unauthenticated";
    if (error.status === 403) return "forbidden";
  }
  return "unavailable";
}

export async function resolveAdminPortalAccess(
  dependencies: AdminPortalAccessDependencies,
): Promise<AdminPortalAccess> {
  let tenant: TenantContext;
  try {
    tenant = await dependencies.requireTenantContext();
  } catch (error) {
    return { kind: accessFailure(error) };
  }

  try {
    await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
  } catch (error) {
    return { kind: accessFailure(error) };
  }

  try {
    const profile = await dependencies.store.getProfile(tenant.userId, tenant.organizationId);
    if (!profile) return { kind: "unavailable" };
    return { kind: "allowed", tenant, profile };
  } catch {
    return { kind: "unavailable" };
  }
}

export function isAdminRole(role: OrganizationRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function homeDestination(isAuthenticated: boolean): "/login" | "/admin" {
  return isAuthenticated ? "/admin" : "/login";
}
