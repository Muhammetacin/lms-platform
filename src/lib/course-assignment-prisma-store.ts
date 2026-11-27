import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import type { CourseAssignmentEntry, CourseAssignmentStore } from "./course-assignment-core.ts";

const memberSelect = {
  id: true,
  employeeName: true,
  active: true,
  role: true,
  user: { select: { name: true, email: true } },
} satisfies Prisma.OrganizationMembershipSelect;

type Member = Prisma.OrganizationMembershipGetPayload<{ select: typeof memberSelect }>;

function memberEntry(member: Member): CourseAssignmentEntry {
  return {
    type: "member",
    targetId: member.id,
    name: member.employeeName?.trim() || member.user.name?.trim() || member.user.email,
    email: member.user.email,
    active: member.active && member.role === "MEMBER",
  };
}

function teamEntry(team: { id: string; name: string }): CourseAssignmentEntry {
  return { type: "team", targetId: team.id, name: team.name, active: true };
}

export function createPrismaCourseAssignmentStore(db: PrismaClient): CourseAssignmentStore {
  return {
    async courseStatus(organizationId, courseId) {
      const course = await db.course.findUnique({
        where: { id_organizationId: { id: courseId, organizationId } },
        select: { status: true },
      });
      return course?.status ?? null;
    },

    async list(organizationId, courseId) {
      const where = { organizationId, courseId };
      const [members, teams] = await Promise.all([
        db.courseMemberAssignment.findMany({
          where,
          orderBy: [{ createdAt: "asc" }, { membershipId: "asc" }],
          select: { membership: { select: memberSelect } },
        }),
        db.courseTeamAssignment.findMany({
          where,
          orderBy: [{ team: { name: "asc" } }, { teamId: "asc" }],
          select: { team: { select: { id: true, name: true } } },
        }),
      ]);
      return [...members.map(({ membership }) => memberEntry(membership)), ...teams.map(({ team }) => teamEntry(team))];
    },

    async search(organizationId, type, query) {
      const match = { contains: query.replace(/[\\%_]/g, "\\$&"), mode: "insensitive" as const };
      if (type === "team") {
        const teams = await db.team.findMany({
          where: { organizationId, name: match },
          select: { id: true, name: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: 50,
        });
        return teams.map(teamEntry);
      }

      const members = await db.organizationMembership.findMany({
        where: {
          organizationId,
          active: true,
          role: "MEMBER",
          ...(query.length > 0
            ? { OR: [{ employeeName: match }, { user: { is: { name: match } } }, { user: { is: { email: match } } }] }
            : {}),
        },
        select: memberSelect,
        orderBy: [{ employeeName: "asc" }, { user: { email: "asc" } }, { id: "asc" }],
        take: 50,
      });
      return members.map(memberEntry);
    },

    async grant(organizationId, courseId, { type, targetId }) {
      try {
        return await db.$transaction(async (transaction) => {
          if (type === "member") {
            const member = await transaction.organizationMembership.findUnique({
              where: { id_organizationId: { id: targetId, organizationId }, active: true, role: "MEMBER" },
              select: { id: true },
            });
            if (!member) return false;
            await transaction.courseMemberAssignment.createMany({
              data: { organizationId, courseId, membershipId: member.id },
              skipDuplicates: true,
            });
          } else {
            const team = await transaction.team.findUnique({
              where: { id_organizationId: { id: targetId, organizationId } },
              select: { id: true },
            });
            if (!team) return false;
            await transaction.courseTeamAssignment.createMany({
              data: { organizationId, courseId, teamId: team.id },
              skipDuplicates: true,
            });
          }
          return true;
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return false;
        throw error;
      }
    },

    async revoke(organizationId, courseId, { type, targetId }) {
      if (type === "member") {
        await db.courseMemberAssignment.deleteMany({ where: { organizationId, courseId, membershipId: targetId } });
      } else {
        await db.courseTeamAssignment.deleteMany({ where: { organizationId, courseId, teamId: targetId } });
      }
    },
  };
}
