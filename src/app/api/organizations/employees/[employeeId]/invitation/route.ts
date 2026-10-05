import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { createEmployeeInvitationHandler } from "@/lib/employee-invitation-core";
import { employeeInvitationDelivery } from "@/lib/employee-invitation-delivery";
import { employeeInvitationStore } from "@/lib/employee-invitation-store";
import { requireTenantContext } from "@/lib/tenant-context";

const POST_INVITATION = createEmployeeInvitationHandler({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  store: employeeInvitationStore,
  delivery: employeeInvitationDelivery,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: readJsonBody,
});

type Context = { params: Promise<{ employeeId: string }> };

export async function POST(request: Request, { params }: Context) {
  const { employeeId } = await params;
  return POST_INVITATION(request, employeeId);
}
