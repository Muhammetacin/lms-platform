import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { requireTenantContext } from "@/lib/tenant-context";
import { createTeamHandlers } from "@/lib/team-core";
import { teamStore } from "@/lib/team-store";

const handlers = createTeamHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: readJsonBody,
  store: teamStore,
});

type Context = { params: Promise<{ teamId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { teamId } = await params;
  return handlers.GET_ONE(teamId);
}

export async function PATCH(request: Request, { params }: Context) {
  const { teamId } = await params;
  return handlers.PATCH(request, teamId);
}

export async function DELETE(request: Request, { params }: Context) {
  const { teamId } = await params;
  return handlers.DELETE(request, teamId);
}
