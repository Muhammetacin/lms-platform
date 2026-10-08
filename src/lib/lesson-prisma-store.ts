import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import type { LessonType } from "../generated/prisma/enums.ts";
import type {
  LessonCreate,
  LessonMutation,
  LessonRecord,
  LessonRead,
  LessonStore,
  LessonSummary,
  LessonUpdate,
} from "./lesson-core.ts";
import { isLessonBuilderId, parseLessonContent } from "./lesson-core.ts";

const lessonFields = {
  id: true,
  title: true,
  type: true,
  position: true,
  textContent: true,
  contentUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

const lessonSummaryFields = {
  id: true,
  title: true,
  type: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Transaction = Prisma.TransactionClient;
type PositionRow = { id: string; position: number };

async function lockCourse(
  transaction: Transaction,
  organizationId: string,
  courseId: string,
): Promise<"DRAFT" | "PUBLISHED" | null> {
  const rows = await transaction.$queryRaw<{ status: "DRAFT" | "PUBLISHED" }[]>`
    SELECT "status"
    FROM "Course"
    WHERE "id" = ${courseId}::uuid AND "organizationId" = ${organizationId}::uuid
    FOR UPDATE
  `;
  return rows[0]?.status ?? null;
}

function result<T>(kind: LessonMutation<T>["kind"]): LessonMutation<T> {
  return { kind } as LessonMutation<T>;
}

async function requireDraftModule(
  transaction: Transaction,
  organizationId: string,
  courseId: string,
  moduleId: string,
): Promise<"ready" | "course_not_found" | "module_not_found" | "published_course_structure_locked"> {
  const status = await lockCourse(transaction, organizationId, courseId);
  if (status === null) return "course_not_found";
  if (status === "PUBLISHED") return "published_course_structure_locked";
  if (!isLessonBuilderId(moduleId)) return "module_not_found";
  const courseModule = await transaction.courseModule.findFirst({
    where: { id: moduleId, courseId, organizationId },
    select: { id: true },
  });
  return courseModule ? "ready" : "module_not_found";
}

async function positionRows(transaction: Transaction, organizationId: string, moduleId: string) {
  return transaction.lesson.findMany({
    where: { organizationId, moduleId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, position: true },
  });
}

async function updatePosition(
  transaction: Transaction,
  organizationId: string,
  moduleId: string,
  lessonId: string,
  toPosition: number,
): Promise<void> {
  const changed = await transaction.$executeRaw`
    UPDATE "Lesson"
    SET "position" = ${toPosition}
    WHERE "id" = ${lessonId}::uuid
      AND "organizationId" = ${organizationId}::uuid
      AND "moduleId" = ${moduleId}::uuid
  `;
  if (changed !== 1) throw new Error("Lesson position invariant was not satisfied.");
}

/** Repairs pre-existing gaps without changing IDs or timestamps. */
async function compactPositions(
  transaction: Transaction,
  organizationId: string,
  moduleId: string,
  rows: PositionRow[],
): Promise<void> {
  if (rows.every((row, index) => row.position === index + 1)) return;
  const maxPosition = rows.reduce((max, row) => Math.max(max, row.position), 0);
  for (const [index, row] of rows.entries()) {
    await updatePosition(transaction, organizationId, moduleId, row.id, maxPosition + index + 1);
  }
  for (const [index, row] of rows.entries()) {
    await updatePosition(transaction, organizationId, moduleId, row.id, index + 1);
  }
}

async function getRecord(
  transaction: Transaction,
  organizationId: string,
  moduleId: string,
  lessonId: string,
): Promise<LessonRecord | null> {
  return transaction.lesson.findFirst({
    where: { id: lessonId, moduleId, organizationId },
    select: lessonFields,
  });
}

/**
 * All Lesson mutations lock the tenant-scoped Course row first and keep the
 * lock until their transaction finishes. This shares LMS-020's serialization
 * boundary with Module mutations and the future LMS-023 publish operation.
 */
export function createPrismaLessonStore(db: PrismaClient): LessonStore {
  return {
    async list(organizationId, courseId, moduleId): Promise<LessonRead<LessonSummary[]>> {
      const course = await db.course.findFirst({
        where: { id: courseId, organizationId },
        select: { id: true },
      });
      if (!course) return { kind: "course_not_found" };
      if (!isLessonBuilderId(moduleId)) return { kind: "module_not_found" };
      const courseModule = await db.courseModule.findFirst({
        where: { id: moduleId, courseId, organizationId },
        select: { id: true },
      });
      if (!courseModule) return { kind: "module_not_found" };
      const lessons = await db.lesson.findMany({
        where: { organizationId, moduleId },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: lessonSummaryFields,
      });
      return { kind: "ok", value: lessons };
    },

    async get(organizationId, courseId, moduleId, lessonId): Promise<LessonRead<LessonRecord>> {
      const course = await db.course.findFirst({
        where: { id: courseId, organizationId },
        select: { id: true },
      });
      if (!course) return { kind: "course_not_found" };
      if (!isLessonBuilderId(moduleId)) return { kind: "module_not_found" };
      const courseModule = await db.courseModule.findFirst({
        where: { id: moduleId, courseId, organizationId },
        select: { id: true },
      });
      if (!courseModule) return { kind: "module_not_found" };
      if (!isLessonBuilderId(lessonId)) return { kind: "lesson_not_found" };
      const lesson = await db.lesson.findFirst({
        where: { id: lessonId, moduleId, organizationId },
        select: lessonFields,
      });
      return lesson ? { kind: "ok", value: lesson } : { kind: "lesson_not_found" };
    },

    async create(organizationId, courseId, moduleId, input: LessonCreate) {
      return db.$transaction(async (transaction) => {
        const ready = await requireDraftModule(transaction, organizationId, courseId, moduleId);
        if (ready !== "ready") return result<LessonRecord>(ready);

        const rows = await positionRows(transaction, organizationId, moduleId);
        await compactPositions(transaction, organizationId, moduleId, rows);
        const positions = await transaction.$queryRaw<{ nextPosition: number }[]>`
          SELECT COALESCE(MAX("position"), 0)::integer + 1 AS "nextPosition"
          FROM "Lesson"
          WHERE "organizationId" = ${organizationId}::uuid AND "moduleId" = ${moduleId}::uuid
        `;
        const created = await transaction.lesson.create({
          data: {
            organizationId,
            moduleId,
            title: input.title,
            type: input.type,
            position: positions[0]?.nextPosition ?? 1,
          },
          select: lessonFields,
        });
        return { kind: "ok", value: created };
      });
    },

    async update(organizationId, courseId, moduleId, lessonId, input: LessonUpdate) {
      return db.$transaction(async (transaction) => {
        const ready = await requireDraftModule(transaction, organizationId, courseId, moduleId);
        if (ready !== "ready") return result<LessonRecord>(ready);
        if (!isLessonBuilderId(lessonId)) return result<LessonRecord>("lesson_not_found");
        const existing = await transaction.lesson.findFirst({
          where: { id: lessonId, moduleId, organizationId },
          select: { type: true },
        });
        if (!existing) return result<LessonRecord>("lesson_not_found");

        const data = { ...input } as { title?: string; type?: LessonType; textContent?: null; contentUrl?: null };
        if (input.type !== undefined && input.type !== existing.type) {
          data.textContent = null;
          data.contentUrl = null;
        }
        const updated = await transaction.lesson.updateMany({
          where: { id: lessonId, moduleId, organizationId },
          data,
        });
        if (updated.count !== 1) return result<LessonRecord>("lesson_not_found");
        const lesson = await getRecord(transaction, organizationId, moduleId, lessonId);
        return lesson ? { kind: "ok", value: lesson } : result<LessonRecord>("lesson_not_found");
      });
    },

    async move(organizationId, courseId, moduleId, lessonId, position) {
      return db.$transaction(async (transaction) => {
        const ready = await requireDraftModule(transaction, organizationId, courseId, moduleId);
        if (ready !== "ready") return result<LessonRecord>(ready);
        if (!isLessonBuilderId(lessonId)) return result<LessonRecord>("lesson_not_found");
        const rows = await positionRows(transaction, organizationId, moduleId);
        const movingIndex = rows.findIndex((row) => row.id === lessonId);
        if (movingIndex < 0) return result<LessonRecord>("lesson_not_found");
        if (position < 1 || position > rows.length) return result<LessonRecord>("invalid_position");
        await compactPositions(transaction, organizationId, moduleId, rows);
        const currentPosition = movingIndex + 1;
        if (position !== currentPosition) {
          const sentinelPosition = rows.length + 1;
          await updatePosition(transaction, organizationId, moduleId, lessonId, sentinelPosition);
          if (position < currentPosition) {
            for (let index = movingIndex - 1; index >= position - 1; index -= 1) {
              const row = rows[index];
              if (!row) throw new Error("Lesson move range invariant was not satisfied.");
              await updatePosition(transaction, organizationId, moduleId, row.id, index + 2);
            }
          } else {
            for (let index = movingIndex + 1; index < position; index += 1) {
              const row = rows[index];
              if (!row) throw new Error("Lesson move range invariant was not satisfied.");
              await updatePosition(transaction, organizationId, moduleId, row.id, index);
            }
          }
          await updatePosition(transaction, organizationId, moduleId, lessonId, position);
        }
        const lesson = await getRecord(transaction, organizationId, moduleId, lessonId);
        return lesson ? { kind: "ok", value: lesson } : result<LessonRecord>("lesson_not_found");
      });
    },

    async delete(organizationId, courseId, moduleId, lessonId) {
      return db.$transaction(async (transaction) => {
        const ready = await requireDraftModule(transaction, organizationId, courseId, moduleId);
        if (ready !== "ready") return result<true>(ready);
        if (!isLessonBuilderId(lessonId)) return result<true>("lesson_not_found");
        const rows = await positionRows(transaction, organizationId, moduleId);
        const deleting = rows.find((row) => row.id === lessonId);
        if (!deleting) return result<true>("lesson_not_found");
        const deleted = await transaction.lesson.deleteMany({
          where: { id: lessonId, moduleId, organizationId },
        });
        if (deleted.count !== 1) return result<true>("lesson_not_found");
        await compactPositions(transaction, organizationId, moduleId, rows.filter((row) => row.id !== lessonId));
        return { kind: "ok", value: true };
      });
    },

    async updateContent(organizationId, courseId, moduleId, lessonId, body) {
      return db.$transaction(async (transaction) => {
        const ready = await requireDraftModule(transaction, organizationId, courseId, moduleId);
        if (ready !== "ready") return result<LessonRecord>(ready);
        if (!isLessonBuilderId(lessonId)) return result<LessonRecord>("lesson_not_found");
        const existing = await transaction.lesson.findFirst({
          where: { id: lessonId, moduleId, organizationId },
          select: { type: true },
        });
        if (!existing) return result<LessonRecord>("lesson_not_found");
        if (existing.type === "QUIZ") return result<LessonRecord>("quiz_content_not_available");
        const content = parseLessonContent(existing.type, body);
        if (!content) return result<LessonRecord>("invalid_content");
        const updated = await transaction.lesson.updateMany({
          where: { id: lessonId, moduleId, organizationId },
          data: content,
        });
        if (updated.count !== 1) return result<LessonRecord>("lesson_not_found");
        const lesson = await getRecord(transaction, organizationId, moduleId, lessonId);
        return lesson ? { kind: "ok", value: lesson } : result<LessonRecord>("lesson_not_found");
      });
    },
  };
}
