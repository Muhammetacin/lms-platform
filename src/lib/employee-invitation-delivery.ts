import "server-only";
import type { EmployeeInvitationDelivery } from "./employee-invitation-core.ts";
import { createBrevoEmailProvider, isBrevoEmailConfigured } from "./brevo-email-provider.ts";
import { createEmployeeInvitationEmail } from "./employee-invitation-email.ts";

function brevoConfiguration() {
  return {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: process.env.EMAIL_FROM_ADDRESS,
    senderName: process.env.EMAIL_FROM_NAME || "LMS Platform",
  };
}

export const employeeInvitationDelivery: EmployeeInvitationDelivery = {
  get available() {
    return isBrevoEmailConfigured(brevoConfiguration());
  },
  async send(email, activationUrl) {
    const message = createEmployeeInvitationEmail(email, activationUrl);
    await createBrevoEmailProvider(brevoConfiguration()).send(message);
  },
};
