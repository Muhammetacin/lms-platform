import { isTrustedAuthRequest } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { requireTenantContext } from "@/lib/tenant-context";
import { createTeamMembershipHandlers } from "@/lib/team-membership-core";
import { teamMembershipStore } from "@/lib/team-membership-store";

const handlers = createTeamMembershipHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: async () => null,
  store: teamMembershipStore,
});

type Context = { params: Promise<{ teamId: string; employeeId: string }> };

export async function DELETE(request: Request, { params }: Context) {
  const { teamId, employeeId } = await params;
  return handlers.DELETE(request, teamId, employeeId);
}
