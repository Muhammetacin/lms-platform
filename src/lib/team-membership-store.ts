import "server-only";
import type { TeamMembershipStore } from "./team-membership-core";
import { createPrismaTeamMembershipStore } from "./team-membership-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaTeamMembershipStore(db);
};

export const teamMembershipStore: TeamMembershipStore = {
  async list(organizationId, teamId) {
    return (await storeForRequest()).list(organizationId, teamId);
  },
  async add(organizationId, teamId, employeeId) {
    return (await storeForRequest()).add(organizationId, teamId, employeeId);
  },
  async remove(organizationId, teamId, employeeId) {
    return (await storeForRequest()).remove(organizationId, teamId, employeeId);
  },
};
