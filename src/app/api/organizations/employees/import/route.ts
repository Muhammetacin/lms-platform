import { isTrustedAuthRequest } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { createEmployeeImportHandler } from "@/lib/employee-import-core";
import { employeeImportStore } from "@/lib/employee-import-store";
import { requireTenantContext } from "@/lib/tenant-context";

const post = createEmployeeImportHandler({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  store: employeeImportStore,
  isTrustedRequest: (request) => isTrustedAuthRequest(request, "multipart/form-data"),
});

export const POST = post;
