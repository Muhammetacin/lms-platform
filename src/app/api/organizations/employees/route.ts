import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { createEmployeeManagementHandlers } from "@/lib/employee-management-core";
import { employeeManagementStore } from "@/lib/employee-management-store";
import { requireTenantContext } from "@/lib/tenant-context";

const handlers = createEmployeeManagementHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: readJsonBody,
  store: employeeManagementStore,
});

export const GET = handlers.GET;

export async function POST(request: Request) {
  return handlers.POST(request);
}
