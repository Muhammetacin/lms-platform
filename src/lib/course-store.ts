import "server-only";
import type { CourseStore } from "./course-core";
import { createPrismaCourseStore } from "./course-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaCourseStore(db);
};

export const courseStore: CourseStore = {
  async list(organizationId) {
    return (await storeForRequest()).list(organizationId);
  },
  async get(organizationId, courseId) {
    return (await storeForRequest()).get(organizationId, courseId);
  },
  async create(organizationId, input) {
    return (await storeForRequest()).create(organizationId, input);
  },
  async update(organizationId, courseId, input) {
    return (await storeForRequest()).update(organizationId, courseId, input);
  },
  async delete(organizationId, courseId) {
    return (await storeForRequest()).delete(organizationId, courseId);
  },
};
