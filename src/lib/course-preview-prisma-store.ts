import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import type { CoursePreviewRecord, CoursePreviewStore } from "./course-preview-core.ts";

/** Reads the complete preview hierarchy from one tenant-scoped MVCC snapshot. */
export function createPrismaCoursePreviewStore(db: PrismaClient): CoursePreviewStore {
  return {
    async get(organizationId, courseId) {
      return db.$transaction(async (transaction) => {
        const course = await transaction.course.findFirst({
          where: { id: courseId, organizationId },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            publishedAt: true,
          },
        });
        if (!course) return null;

        const modules = await transaction.courseModule.findMany({
          where: { courseId: course.id, organizationId },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true, title: true, description: true, position: true },
        });
        const moduleIds = modules.map(({ id }) => id);
        const lessons = moduleIds.length === 0
          ? []
          : await transaction.lesson.findMany({
              where: { organizationId, moduleId: { in: moduleIds } },
              orderBy: [{ position: "asc" }, { id: "asc" }],
              select: {
                id: true,
                moduleId: true,
                title: true,
                type: true,
                position: true,
                textContent: true,
                contentUrl: true,
              },
            });
        const lessonsByModule = new Map<string, typeof lessons>();
        for (const lesson of lessons) {
          const group = lessonsByModule.get(lesson.moduleId);
          if (group) group.push(lesson);
          else lessonsByModule.set(lesson.moduleId, [lesson]);
        }

        return {
          ...course,
          modules: modules.map((courseModule) => ({
            ...courseModule,
            lessons: (lessonsByModule.get(courseModule.id) ?? []).map((lesson) => ({
              id: lesson.id,
              title: lesson.title,
              type: lesson.type,
              position: lesson.position,
              textContent: lesson.textContent,
              contentUrl: lesson.contentUrl,
            })),
          })),
        } satisfies CoursePreviewRecord;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
  };
}
