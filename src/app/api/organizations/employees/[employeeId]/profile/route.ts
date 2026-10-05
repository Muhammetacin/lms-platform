import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { employeeManagementStore } from "@/lib/employee-management-store";
import { createEmployeeProfileHandlers } from "@/lib/employee-profile-core";
import { requireTenantContext } from "@/lib/tenant-context";

const handlers = createEmployeeProfileHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: readJsonBody,
  store: employeeManagementStore,
});

type Context = { params: Promise<{ employeeId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { employeeId } = await params;
  return handlers.GET(employeeId);
}

export async function PATCH(request: Request, { params }: Context) {
  const { employeeId } = await params;
  return handlers.PATCH(request, employeeId);
}
