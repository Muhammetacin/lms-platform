import { isAdminRole } from "./admin-portal-core.ts";
import { TenantContextError, type TenantContext } from "./tenant-context-core.ts";

type PortalDestination = "/login" | "/admin" | "/learn" | "forbidden" | "unavailable";
type PortalAccess =
  | { destination: "/learn"; tenant: TenantContext }
  | { destination: Exclude<PortalDestination, "/learn"> };

export async function resolvePortalAccess(
  getTenantContext: () => Promise<TenantContext | null>,
): Promise<PortalAccess> {
  try {
    const tenant = await getTenantContext();
    if (!tenant) return { destination: "/login" };
    if (tenant.role === "MEMBER") return { destination: "/learn", tenant };
    return { destination: isAdminRole(tenant.role) ? "/admin" : "forbidden" };
  } catch (error) {
    return { destination: error instanceof TenantContextError && error.status === 403 ? "forbidden" : "unavailable" };
  }
}

export async function resolvePortalDestination(
  getTenantContext: () => Promise<TenantContext | null>,
): Promise<PortalDestination> {
  return (await resolvePortalAccess(getTenantContext)).destination;
}
