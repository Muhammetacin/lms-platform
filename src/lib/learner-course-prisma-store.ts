import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { isCourseId } from "./course-core.ts";
import { toCoursePreview } from "./course-preview-core.ts";
import { readCoursePreviewRecord } from "./course-preview-prisma-store.ts";
import { readLessonActivity } from "./learning-progress-prisma-store.ts";

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

export function activeLearnerMembership(transaction: Prisma.TransactionClient, { organizationId, userId }: LearnerIdentity) {
  return transaction.organizationMembership.findUnique({
    where: { userId_organizationId: { organizationId, userId }, active: true, role: "MEMBER" },
    select: { id: true },
  });
}

export function createPrismaLearnerCourseStore(db: PrismaClient) {
  return {
    list(identity: LearnerIdentity) {
      return db.$transaction(async (transaction) => {
        const member = await activeLearnerMembership(transaction, identity);
        if (!member) return [];
        const courses = await transaction.course.findMany({
          where: assignedCourseWhere(identity),
          select: { id: true, title: true, description: true },
          orderBy: [{ title: "asc" }, { id: "asc" }],
        });
        if (!courses.length) return [];
        const activity = await readLessonActivity(
          transaction, identity.organizationId, courses.map(({ id }) => id), [member.id],
        );
        return courses.map((course) => {
          const { total, completedByMember } = activity.get(course.id)!;
          return { ...course, progress: { completed: completedByMember.get(member.id)?.size ?? 0, total } };
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },

    async get(identity: LearnerIdentity, courseId: string) {
      if (!isCourseId(courseId)) return null;
      return db.$transaction(async (transaction) => {
        const member = await activeLearnerMembership(transaction, identity);
        if (!member) return null;
        const record = await readCoursePreviewRecord(
          transaction, identity.organizationId, courseId, assignedCourseWhere(identity),
        );
        if (!record) return null;
        const activity = await readLessonActivity(transaction, identity.organizationId, [courseId], [member.id]);
        const { total, completedByMember } = activity.get(courseId)!;
        const completedLessons = completedByMember.get(member.id) ?? new Set<string>();
        return { ...toCoursePreview(record), completedLessons, progress: { completed: completedLessons.size, total } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },

    async completeLesson(identity: LearnerIdentity, courseId: string, lessonId: string) {
      if (!isCourseId(courseId) || !isCourseId(lessonId)) return false;
      return db.$transaction(async (transaction) => {
        const member = await activeLearnerMembership(transaction, identity);
        if (!member) return false;
        const lesson = await transaction.lesson.findFirst({
          where: {
            id: lessonId,
            organizationId: identity.organizationId,
            type: { not: "QUIZ" },
            module: { course: { id: courseId, AND: assignedCourseWhere(identity) } },
          },
          select: { id: true },
        });
        if (!lesson) return false;
        await transaction.lessonCompletion.createMany({
          data: { organizationId: identity.organizationId, lessonId: lesson.id, membershipId: member.id },
          skipDuplicates: true,
        });
        return true;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },
  };
}
