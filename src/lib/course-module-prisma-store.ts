import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import type {
  CourseModule,
  CourseModuleCreate,
  CourseModuleMutation,
  CourseModuleStore,
  CourseModuleUpdate,
} from "./course-module-core.ts";

const moduleResponseFields = {
  id: true,
  title: true,
  description: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} as const;

type Transaction = Prisma.TransactionClient;

/** Locking the parent serializes all structural writes for a Course. */
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

function result<T>(kind: CourseModuleMutation<T>["kind"]): CourseModuleMutation<T> {
  return { kind } as CourseModuleMutation<T>;
}

async function requireDraftCourse(
  transaction: Transaction,
  organizationId: string,
  courseId: string,
): Promise<"ready" | "course_not_found" | "published_course_structure_locked"> {
  const status = await lockCourse(transaction, organizationId, courseId);
  if (status === null) return "course_not_found";
  if (status === "PUBLISHED") return "published_course_structure_locked";
  return "ready";
}

async function updateOnePosition(
  transaction: Transaction,
  organizationId: string,
  courseId: string,
  fromPosition: number,
  toPosition: number,
): Promise<void> {
  const changed = await transaction.$executeRaw`
    UPDATE "CourseModule"
    SET "position" = ${toPosition}
    WHERE "organizationId" = ${organizationId}::uuid
      AND "courseId" = ${courseId}::uuid
      AND "position" = ${fromPosition}
  `;
  if (changed !== 1) throw new Error("Course module position invariant was not satisfied.");
}

/**
 * Every CourseModule write first locks its Course row. The lock makes create,
 * move, delete, and future publish operations serializable per Course as long
 * as the publishing transaction takes the same lock before changing status.
 */
export function createPrismaCourseModuleStore(db: PrismaClient): CourseModuleStore {
  return {
    async courseExists(organizationId, courseId) {
      return (await db.course.findFirst({
        where: { id: courseId, organizationId },
        select: { id: true },
      })) !== null;
    },

    async list(organizationId, courseId) {
      const course = await db.course.findFirst({
        where: { id: courseId, organizationId },
        select: { id: true },
      });
      if (!course) return null;
      return db.courseModule.findMany({
        where: { organizationId, courseId },
        orderBy: { position: "asc" },
        select: moduleResponseFields,
      });
    },

    async get(organizationId, courseId, moduleId) {
      return db.courseModule.findFirst({
        where: { id: moduleId, courseId, organizationId },
        select: moduleResponseFields,
      });
    },

    async create(organizationId, courseId, input: CourseModuleCreate) {
      return db.$transaction(async (transaction) => {
        const draft = await requireDraftCourse(transaction, organizationId, courseId);
        if (draft !== "ready") return result<CourseModule>(draft);

        const positions = await transaction.$queryRaw<{ nextPosition: number }[]>`
          SELECT COALESCE(MAX("position"), 0)::integer + 1 AS "nextPosition"
          FROM "CourseModule"
          WHERE "organizationId" = ${organizationId}::uuid AND "courseId" = ${courseId}::uuid
        `;
        const createdModule = await transaction.courseModule.create({
          data: {
            organizationId,
            courseId,
            title: input.title,
            description: input.description,
            position: positions[0]?.nextPosition ?? 1,
          },
          select: moduleResponseFields,
        });
        return { kind: "ok", value: createdModule };
      });
    },

    async update(organizationId, courseId, moduleId, input: CourseModuleUpdate) {
      return db.$transaction(async (transaction) => {
        const draft = await requireDraftCourse(transaction, organizationId, courseId);
        if (draft !== "ready") return result<CourseModule>(draft);
        const existing = await transaction.courseModule.findFirst({
          where: { id: moduleId, courseId, organizationId },
          select: { id: true },
        });
        if (!existing) return result<CourseModule>("module_not_found");

        const updated = await transaction.courseModule.updateMany({
          where: { id: moduleId, courseId, organizationId },
          data: input,
        });
        if (updated.count !== 1) return result<CourseModule>("module_not_found");
        const updatedModule = await transaction.courseModule.findFirst({
          where: { id: moduleId, courseId, organizationId },
          select: moduleResponseFields,
        });
        return updatedModule ? { kind: "ok", value: updatedModule } : result<CourseModule>("module_not_found");
      });
    },

    async move(organizationId, courseId, moduleId, position) {
      return db.$transaction(async (transaction) => {
        const draft = await requireDraftCourse(transaction, organizationId, courseId);
        if (draft !== "ready") return result<CourseModule>(draft);
        const modules = await transaction.courseModule.findMany({
          where: { organizationId, courseId },
          orderBy: { position: "asc" },
          select: { id: true, position: true },
        });
        const moving = modules.find((module) => module.id === moduleId);
        if (!moving) return result<CourseModule>("module_not_found");
        if (position < 1 || position > modules.length) return result<CourseModule>("invalid_position");
        if (position === moving.position) {
          const unchanged = await transaction.courseModule.findFirst({
            where: { id: moduleId, courseId, organizationId },
            select: moduleResponseFields,
          });
          return unchanged ? { kind: "ok", value: unchanged } : result<CourseModule>("module_not_found");
        }

        const sentinelPosition = Math.max(...modules.map((module) => module.position)) + 1;
        await updateOnePosition(transaction, organizationId, courseId, moving.position, sentinelPosition);

        if (position < moving.position) {
          for (let current = moving.position - 1; current >= position; current -= 1) {
            await updateOnePosition(transaction, organizationId, courseId, current, current + 1);
          }
        } else {
          for (let current = moving.position + 1; current <= position; current += 1) {
            await updateOnePosition(transaction, organizationId, courseId, current, current - 1);
          }
        }
        await updateOnePosition(transaction, organizationId, courseId, sentinelPosition, position);

        const moved = await transaction.courseModule.findFirst({
          where: { id: moduleId, courseId, organizationId },
          select: moduleResponseFields,
        });
        return moved ? { kind: "ok", value: moved } : result<CourseModule>("module_not_found");
      });
    },

    async delete(organizationId, courseId, moduleId) {
      return db.$transaction(async (transaction) => {
        const draft = await requireDraftCourse(transaction, organizationId, courseId);
        if (draft !== "ready") return result<true>(draft);
        const modules = await transaction.courseModule.findMany({
          where: { organizationId, courseId },
          orderBy: { position: "asc" },
          select: { id: true, position: true },
        });
        const deleting = modules.find((module) => module.id === moduleId);
        if (!deleting) return result<true>("module_not_found");

        const deleted = await transaction.courseModule.deleteMany({
          where: { id: moduleId, courseId, organizationId },
        });
        if (deleted.count !== 1) return result<true>("module_not_found");
        for (let current = deleting.position + 1; current <= modules.length; current += 1) {
          await updateOnePosition(transaction, organizationId, courseId, current, current - 1);
        }
        return { kind: "ok", value: true };
      });
    },
  };
}
