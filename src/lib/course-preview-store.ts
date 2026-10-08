import "server-only";
import type { CoursePreviewStore } from "./course-preview-core.ts";
import { createPrismaCoursePreviewStore } from "./course-preview-prisma-store.ts";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaCoursePreviewStore(db);
};

export const coursePreviewStore: CoursePreviewStore = {
  async get(organizationId, courseId) {
    return (await storeForRequest()).get(organizationId, courseId);
  },
};
