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
  async create(organizationId, input, actorUserId) {
    return (await storeForRequest()).create(organizationId, input, actorUserId);
  },
  async update(organizationId, teamId, input, actorUserId) {
    return (await storeForRequest()).update(organizationId, teamId, input, actorUserId);
  },
  async delete(organizationId, teamId, actorUserId) {
    return (await storeForRequest()).delete(organizationId, teamId, actorUserId);
  },
};
