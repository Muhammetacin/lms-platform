import "server-only";
import type { EmployeeInvitationStore } from "./employee-invitation-core";
import { createPrismaEmployeeInvitationStore } from "./employee-invitation-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaEmployeeInvitationStore(db);
};

export const employeeInvitationStore: EmployeeInvitationStore = {
  async createInvitation(...args) {
    return (await storeForRequest()).createInvitation(...args);
  },
  async invalidateInvitation(...args) {
    return (await storeForRequest()).invalidateInvitation(...args);
  },
  async findInvitation(...args) {
    return (await storeForRequest()).findInvitation(...args);
  },
  async activate(...args) {
    return (await storeForRequest()).activate(...args);
  },
};
