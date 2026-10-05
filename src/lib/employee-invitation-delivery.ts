import "server-only";
import type { EmployeeInvitationDelivery } from "./employee-invitation-core";

/**
 * LMS-052 has not supplied an email provider yet. Keep a narrow boundary here;
 * invitations are not persisted until an actual delivery adapter is configured.
 */
export const employeeInvitationDelivery: EmployeeInvitationDelivery = {
  available: false,
  async send() {
    throw new Error("Invitation email delivery is not configured.");
  },
};
