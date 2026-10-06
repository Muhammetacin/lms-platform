import type { PrismaClient } from "../generated/prisma/client.ts";
import type { CourseCreate, CourseDeleteResult, CourseStore, CourseUpdate } from "./course-core.ts";

const courseResponseFields = {
  id: true,
  title: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Production Course queries always include the trusted organization ID. */
export function createPrismaCourseStore(db: PrismaClient): CourseStore {
  return {
    async list(organizationId) {
      return db.course.findMany({
        where: { organizationId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
        select: courseResponseFields,
      });
    },

    async get(organizationId, courseId) {
      return db.course.findFirst({
        where: { id: courseId, organizationId },
        select: courseResponseFields,
      });
    },

    async create(organizationId, input: CourseCreate) {
      return db.course.create({
        data: {
          organizationId,
          title: input.title,
          description: input.description,
          status: "DRAFT",
        },
        select: courseResponseFields,
      });
    },

    async update(organizationId, courseId, input: CourseUpdate) {
      const data: { title?: string; description?: string | null } = {};
      if (input.title !== undefined) data.title = input.title;
      if (input.description !== undefined) data.description = input.description;

      return db.$transaction(async (transaction) => {
        const updated = await transaction.course.updateMany({
          where: { id: courseId, organizationId },
          data,
        });
        if (updated.count !== 1) return null;
        return transaction.course.findFirst({
          where: { id: courseId, organizationId },
          select: courseResponseFields,
        });
      });
    },

    async delete(organizationId, courseId): Promise<CourseDeleteResult> {
      return db.$transaction(async (transaction) => {
        const existing = await transaction.course.findFirst({
          where: { id: courseId, organizationId },
          select: { status: true },
        });
        if (!existing) return "not_found";
        if (existing.status === "PUBLISHED") return "published";

        // Status is part of the delete predicate so a concurrent publish wins safely.
        const deleted = await transaction.course.deleteMany({
          where: { id: courseId, organizationId, status: "DRAFT" },
        });
        if (deleted.count === 1) return "deleted";

        const current = await transaction.course.findFirst({
          where: { id: courseId, organizationId },
          select: { status: true },
        });
        if (!current) return "not_found";
        return current.status === "PUBLISHED" ? "published" : "not_found";
      });
    },
  };
}
