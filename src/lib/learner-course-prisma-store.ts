import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { isCourseId } from "./course-core.ts";
import { toCoursePreview } from "./course-preview-core.ts";
import { readCoursePreviewRecord } from "./course-preview-prisma-store.ts";

export type LearnerIdentity = { organizationId: string; userId: string };

export function assignedCourseWhere({ organizationId, userId }: LearnerIdentity): Prisma.CourseWhereInput {
  const member = { organizationId, userId, active: true, role: "MEMBER" } as const;
  return {
    organizationId,
    status: "PUBLISHED",
    OR: [
      { memberAssignments: { some: { membership: { is: member } } } },
      { teamAssignments: { some: { team: { memberships: { some: { membership: { is: member } } } } } } },
    ],
  };
}

export function createPrismaLearnerCourseStore(db: PrismaClient) {
  return {
    list(identity: LearnerIdentity) {
      return db.course.findMany({
        where: assignedCourseWhere(identity),
        select: { id: true, title: true, description: true },
        orderBy: [{ title: "asc" }, { id: "asc" }],
      });
    },

    async get(identity: LearnerIdentity, courseId: string) {
      if (!isCourseId(courseId)) return null;
      const record = await db.$transaction(
        (transaction) => readCoursePreviewRecord(transaction, identity.organizationId, courseId, assignedCourseWhere(identity)),
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return record ? toCoursePreview(record) : null;
    },
  };
}
