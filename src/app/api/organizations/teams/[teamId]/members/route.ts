import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { requireTenantContext } from "@/lib/tenant-context";
import { createTeamMembershipHandlers } from "@/lib/team-membership-core";
import { teamMembershipStore } from "@/lib/team-membership-store";

const handlers = createTeamMembershipHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: readJsonBody,
  store: teamMembershipStore,
});

type Context = { params: Promise<{ teamId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { teamId } = await params;
  return handlers.GET(teamId);
}

export async function POST(request: Request, { params }: Context) {
  const { teamId } = await params;
  return handlers.POST(request, teamId);
}
