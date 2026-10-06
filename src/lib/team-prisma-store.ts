import type { PrismaClient } from "../generated/prisma/client.ts";
import { TeamNameConflictError, type TeamCreate, type TeamStore, type TeamUpdate } from "./team-core.ts";

/** Production Prisma queries for Teams; every operation requires the trusted tenant ID. */
export function createPrismaTeamStore(db: PrismaClient): TeamStore {
  return {
    async list(organizationId) {
      return db.team.findMany({
        where: { organizationId },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 100,
        select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
      });
    },

    async get(organizationId, teamId) {
      return db.team.findFirst({
        where: { id: teamId, organizationId },
        select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
      });
    },

    async create(organizationId, input: TeamCreate) {
      try {
        return await db.team.create({
          data: { organizationId, name: input.name, description: input.description },
          select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
        });
      } catch (error) {
        if (isTeamNameConflict(error)) throw new TeamNameConflictError();
        throw error;
      }
    },

    async update(organizationId, teamId, input: TeamUpdate) {
      const data: { name?: string; description?: string | null } = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.description !== undefined) data.description = input.description;

      try {
        return await db.$transaction(async (transaction) => {
          const updated = await transaction.team.updateMany({
            where: { id: teamId, organizationId },
            data,
          });
          if (updated.count !== 1) return null;
          return transaction.team.findFirst({
            where: { id: teamId, organizationId },
            select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
          });
        });
      } catch (error) {
        if (isTeamNameConflict(error)) throw new TeamNameConflictError();
        throw error;
      }
    },

    async delete(organizationId, teamId) {
      const deleted = await db.team.deleteMany({ where: { id: teamId, organizationId } });
      return deleted.count === 1;
    },
  };
}

function isTeamNameConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
    return false;
  }
  if (!("meta" in error) || typeof error.meta !== "object" || error.meta === null || !("target" in error.meta)) {
    return false;
  }
  const target = error.meta.target;
  return Array.isArray(target)
    ? target.includes("organizationId") && target.includes("name")
    : typeof target === "string" && /Team_organizationId_name|organizationId_name/.test(target);
}
