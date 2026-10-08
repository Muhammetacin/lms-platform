import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import type { Course } from "./course-core.ts";
import type { CoursePublishingIssue, CoursePublishingStore } from "./course-publishing-core.ts";
import { parseLessonTextContent, parseLessonUrl } from "./lesson-core.ts";

const courseResponseFields = {
  id: true,
  title: true,
  description: true,
  status: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Transaction = Prisma.TransactionClient;
type LessonForPublication = {
  id: string;
  moduleId: string;
  position: number;
  type: "TEXT" | "VIDEO" | "PDF" | "IMAGE" | "LINK" | "QUIZ";
  textContent: string | null;
  contentUrl: string | null;
};
type ModuleForPublication = { id: string; position: number };
const MAX_ISSUES = 100;

async function lockCourse(
  transaction: Transaction,
  organizationId: string,
  courseId: string,
): Promise<{ status: "DRAFT" | "PUBLISHED"; publishedAt: Date | null } | null> {
  const rows = await transaction.$queryRaw<{ status: "DRAFT" | "PUBLISHED"; publishedAt: Date | null }[]>`
    SELECT "status", "publishedAt"
    FROM "Course"
    WHERE "id" = ${courseId}::uuid
      AND "organizationId" = ${organizationId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function publicationIssues(
  modules: ModuleForPublication[],
  lessons: LessonForPublication[],
): { issues: CoursePublishingIssue[]; truncated: boolean } {
  const issues: CoursePublishingIssue[] = [];
  const lessonsByModule = new Map<string, LessonForPublication[]>();
  for (const lesson of lessons) {
    const group = lessonsByModule.get(lesson.moduleId);
    if (group) group.push(lesson);
    else lessonsByModule.set(lesson.moduleId, [lesson]);
  }
  const add = (issue: CoursePublishingIssue) => {
    if (issues.length <= MAX_ISSUES) issues.push(issue);
  };

  if (modules.length === 0) add({ code: "course_requires_module" });
  for (const [index, courseModule] of modules.entries()) {
    if (courseModule.position !== index + 1) {
      add({ code: "module_order_invalid", moduleId: courseModule.id });
      if (issues.length > MAX_ISSUES) return { issues: issues.slice(0, MAX_ISSUES), truncated: true };
    }
    if (!lessonsByModule.has(courseModule.id)) {
      add({ code: "module_requires_lesson", moduleId: courseModule.id });
      if (issues.length > MAX_ISSUES) return { issues: issues.slice(0, MAX_ISSUES), truncated: true };
    }
  }

  for (const courseModule of modules) {
    const moduleLessons = lessonsByModule.get(courseModule.id) ?? [];
    for (const [index, lesson] of moduleLessons.entries()) {
      if (lesson.position !== index + 1) {
        add({ code: "lesson_order_invalid", moduleId: courseModule.id, lessonId: lesson.id });
        if (issues.length > MAX_ISSUES) return { issues: issues.slice(0, MAX_ISSUES), truncated: true };
      }

      if (lesson.type === "QUIZ") {
        add({ code: "quiz_not_configured", moduleId: courseModule.id, lessonId: lesson.id });
      } else if (lesson.type === "TEXT") {
        const parsed = parseLessonTextContent(lesson.textContent);
        if (!parsed.valid || parsed.value === null) {
          add({ code: "lesson_content_missing", moduleId: courseModule.id, lessonId: lesson.id, type: "TEXT" });
        }
      } else {
        const parsed = parseLessonUrl(lesson.contentUrl);
        if (!parsed.valid || parsed.value === null) {
          add({
            code: "lesson_content_missing",
            moduleId: courseModule.id,
            lessonId: lesson.id,
            type: lesson.type,
          });
        }
        if (issues.length > MAX_ISSUES) return { issues: issues.slice(0, MAX_ISSUES), truncated: true };
      }
    }
  }

  return { issues: issues.slice(0, MAX_ISSUES), truncated: issues.length > MAX_ISSUES };
}

/** Publishing takes the same scoped Course lock held by all Module and Lesson mutations. */
export function createPrismaCoursePublishingStore(db: PrismaClient): CoursePublishingStore {
  return {
    async publish(organizationId, courseId) {
      return db.$transaction(async (transaction) => {
        const lockedCourse = await lockCourse(transaction, organizationId, courseId);
        if (lockedCourse === null) return { kind: "not_found" } as const;

        if (lockedCourse.status === "PUBLISHED") {
          const course = await transaction.course.findFirst({
            where: { id: courseId, organizationId },
            select: courseResponseFields,
          });
          if (!course) return { kind: "not_found" } as const;
          return { kind: "published", course } as const;
        }

        const modules = await transaction.courseModule.findMany({
          where: { organizationId, courseId },
          orderBy: [{ position: "asc" }, { id: "asc" }],
          select: { id: true, position: true },
        });
        const lessons = modules.length === 0
          ? []
          : await transaction.lesson.findMany({
              where: { organizationId, moduleId: { in: modules.map(({ id }) => id) } },
              orderBy: [{ position: "asc" }, { id: "asc" }],
              select: { id: true, moduleId: true, position: true, type: true, textContent: true, contentUrl: true },
            });
        const completeness = publicationIssues(modules, lessons);
        if (completeness.issues.length > 0) {
          return { kind: "not_publishable", ...completeness } as const;
        }

        const publishedAt = new Date();
        const updated = await transaction.course.updateMany({
          where: { id: courseId, organizationId, status: "DRAFT", publishedAt: null },
          data: { status: "PUBLISHED", publishedAt },
        });
        if (updated.count !== 1) throw new Error("Locked Course lifecycle invariant was not satisfied.");

        const course = await transaction.course.findFirst({
          where: { id: courseId, organizationId },
          select: courseResponseFields,
        });
        if (!course) throw new Error("Published Course could not be read inside its transaction.");
        return { kind: "published", course } as const satisfies { kind: "published"; course: Course };
      });
    },
  };
}
