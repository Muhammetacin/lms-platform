import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { createOrganizationSettingsHandlers } from "@/lib/organization-settings-core";
import { requireTenantContext } from "@/lib/tenant-context";

const handlers = createOrganizationSettingsHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: readJsonBody,
  store: {
    async findSettings(organizationId) {
      const { db } = await import("@/lib/db");
      return db.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, slug: true },
      });
    },
    async updateName(organizationId, name) {
      const { db } = await import("@/lib/db");
      return db.organization.update({
        where: { id: organizationId },
        data: { name },
        select: { name: true, slug: true },
      });
    },
  },
});

export const GET = handlers.GET;

export async function PATCH(request: Request) {
  return handlers.PATCH(request);
}
