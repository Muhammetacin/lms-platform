import { Prisma } from "../generated/prisma/client.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  TeamMembershipConflictError,
  TeamMembershipTargetNotFoundError,
  type TeamMember,
  type TeamMembershipStore,
} from "./team-membership-core.ts";

/** Production Prisma queries for team membership; every operation carries the trusted tenant ID. */
export function createPrismaTeamMembershipStore(db: PrismaClient): TeamMembershipStore {
  return {
    async list(organizationId, teamId) {
      return db.$transaction(async (transaction) => {
        const team = await transaction.team.findFirst({
          where: { id: teamId, organizationId },
          select: { id: true },
        });
        if (!team) return null;

        const rows = await transaction.organizationMembership.findMany({
          where: {
            organizationId,
            active: true,
            teamMemberships: { some: { organizationId, teamId } },
          },
          orderBy: [{ employeeName: "asc" }, { id: "asc" }],
          take: 100,
          select: {
            id: true,
            employeeName: true,
            jobTitle: true,
            department: true,
            user: { select: { email: true } },
          },
        });

        return rows.map(toTeamMember);
      });
    },

    async add(organizationId, teamId, employeeId) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          return await db.$transaction(async (transaction) => {
            const team = await transaction.team.findFirst({
              where: { id: teamId, organizationId },
              select: { id: true },
            });
            if (!team) throw new TeamMembershipTargetNotFoundError("team");

            const membership = await transaction.organizationMembership.findFirst({
              where: { id: employeeId, organizationId, active: true },
              select: {
                id: true,
                employeeName: true,
                jobTitle: true,
                department: true,
                user: { select: { email: true } },
              },
            });
            if (!membership) throw new TeamMembershipTargetNotFoundError("employee");

            const existing = await transaction.teamMembership.findFirst({
              where: { organizationId, teamId, membershipId: employeeId },
              select: { id: true },
            });
            if (existing) throw new TeamMembershipConflictError();

            await transaction.teamMembership.create({
              data: { organizationId, teamId, membershipId: employeeId },
              select: { id: true },
            });
            return toTeamMember(membership);
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        } catch (error) {
          if (isUniqueConstraintViolation(error) || isSerializationFailure(error)) {
            const existing = await db.teamMembership.findFirst({
              where: { organizationId, teamId, membershipId: employeeId },
              select: { id: true },
            });
            if (existing) throw new TeamMembershipConflictError();
            if (isSerializationFailure(error) && attempt === 0) {
              // Retry once against the current tenant state after a concurrent write.
              continue;
            }
          }
          throw error;
        }
      }
      throw new Error("Team membership transaction retry limit exceeded.");
    },

    async remove(organizationId, teamId, employeeId) {
      const result = await db.teamMembership.deleteMany({
        where: { organizationId, teamId, membershipId: employeeId },
      });
      return result.count === 1;
    },
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return isPrismaCode(error, "P2002");
}

function isSerializationFailure(error: unknown): boolean {
  return isPrismaCode(error, "P2034");
}

function isPrismaCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function toTeamMember(row: {
  id: string;
  employeeName: string | null;
  jobTitle: string | null;
  department: string | null;
  user: { email: string };
}): TeamMember {
  return {
    id: row.id,
    email: row.user.email,
    employeeName: row.employeeName,
    jobTitle: row.jobTitle,
    department: row.department,
  };
}
