import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { createInvitationActivationHandlers } from "@/lib/employee-invitation-core";
import { employeeInvitationStore } from "@/lib/employee-invitation-store";

const handlers = createInvitationActivationHandlers({
  store: employeeInvitationStore,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: readJsonBody,
});

export async function POST(request: Request) {
  return handlers.VALIDATE(request);
}
