import "server-only";
import type { LessonStore } from "./lesson-core";
import { createPrismaLessonStore } from "./lesson-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaLessonStore(db);
};

export const lessonStore: LessonStore = {
  async list(organizationId, courseId, moduleId) {
    return (await storeForRequest()).list(organizationId, courseId, moduleId);
  },
  async get(organizationId, courseId, moduleId, lessonId) {
    return (await storeForRequest()).get(organizationId, courseId, moduleId, lessonId);
  },
  async create(organizationId, courseId, moduleId, input) {
    return (await storeForRequest()).create(organizationId, courseId, moduleId, input);
  },
  async update(organizationId, courseId, moduleId, lessonId, input) {
    return (await storeForRequest()).update(organizationId, courseId, moduleId, lessonId, input);
  },
  async move(organizationId, courseId, moduleId, lessonId, position) {
    return (await storeForRequest()).move(organizationId, courseId, moduleId, lessonId, position);
  },
  async delete(organizationId, courseId, moduleId, lessonId) {
    return (await storeForRequest()).delete(organizationId, courseId, moduleId, lessonId);
  },
  async updateContent(organizationId, courseId, moduleId, lessonId, body) {
    return (await storeForRequest()).updateContent(organizationId, courseId, moduleId, lessonId, body);
  },
};
