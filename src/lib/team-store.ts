import "server-only";
import type { TeamStore } from "./team-core";
import { createPrismaTeamStore } from "./team-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaTeamStore(db);
};

export const teamStore: TeamStore = {
  async list(organizationId) {
    return (await storeForRequest()).list(organizationId);
  },
  async get(organizationId, teamId) {
    return (await storeForRequest()).get(organizationId, teamId);
  },
  async create(organizationId, input) {
    return (await storeForRequest()).create(organizationId, input);
  },
  async update(organizationId, teamId, input) {
    return (await storeForRequest()).update(organizationId, teamId, input);
  },
  async delete(organizationId, teamId) {
    return (await storeForRequest()).delete(organizationId, teamId);
  },
};
