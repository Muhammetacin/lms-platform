import "server-only";
import type { CoursePublishingStore } from "./course-publishing-core";
import { createPrismaCoursePublishingStore } from "./course-publishing-prisma-store";

const storeForRequest = async () => {
  const { db } = await import("@/lib/db");
  return createPrismaCoursePublishingStore(db);
};

export const coursePublishingStore: CoursePublishingStore = {
  async publish(organizationId, courseId) {
    return (await storeForRequest()).publish(organizationId, courseId);
  },
};
