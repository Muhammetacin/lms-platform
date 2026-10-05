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

type Context = { params: Promise<{ employeeId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { employeeId } = await params;
  return handlers.GET_ONE(employeeId);
}

export async function PATCH(request: Request, { params }: Context) {
  const { employeeId } = await params;
  return handlers.PATCH(request, employeeId);
}
