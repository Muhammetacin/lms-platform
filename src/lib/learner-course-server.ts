import "server-only";
import { createPrismaLearnerCourseStore } from "@/lib/learner-course-prisma-store";

export type LearnerCourseStore = ReturnType<typeof createPrismaLearnerCourseStore>;

export async function getLearnerCourseStore() {
  const { db } = await import("@/lib/db");
  return createPrismaLearnerCourseStore(db);
}
