import { isAdminRole } from "./admin-portal-core.ts";
import { TenantContextError, type TenantContext } from "./tenant-context-core.ts";

type PortalDestination = "/login" | "/admin" | "/learn" | "forbidden" | "unavailable";

export async function resolvePortalDestination(
  getTenantContext: () => Promise<TenantContext | null>,
): Promise<PortalDestination> {
  try {
    const tenant = await getTenantContext();
    if (!tenant) return "/login";
    if (tenant.role === "MEMBER") return "/learn";
    return isAdminRole(tenant.role) ? "/admin" : "forbidden";
  } catch (error) {
    if (error instanceof TenantContextError && error.status === 403) return "forbidden";
    return "unavailable";
  }
}
