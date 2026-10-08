import "server-only";
import type { CourseModuleStore } from "./course-module-core";
import { createPrismaCourseModuleStore } from "./course-module-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaCourseModuleStore(db);
};

export const courseModuleStore: CourseModuleStore = {
  async courseExists(organizationId, courseId) {
    return (await storeForRequest()).courseExists(organizationId, courseId);
  },
  async list(organizationId, courseId) {
    return (await storeForRequest()).list(organizationId, courseId);
  },
  async get(organizationId, courseId, moduleId) {
    return (await storeForRequest()).get(organizationId, courseId, moduleId);
  },
  async create(organizationId, courseId, input) {
    return (await storeForRequest()).create(organizationId, courseId, input);
  },
  async update(organizationId, courseId, moduleId, input) {
    return (await storeForRequest()).update(organizationId, courseId, moduleId, input);
  },
  async move(organizationId, courseId, moduleId, position) {
    return (await storeForRequest()).move(organizationId, courseId, moduleId, position);
  },
  async delete(organizationId, courseId, moduleId) {
    return (await storeForRequest()).delete(organizationId, courseId, moduleId);
  },
};
