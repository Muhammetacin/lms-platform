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

export const GET = handlers.GET;

export async function POST(request: Request) {
  return handlers.POST(request);
}
