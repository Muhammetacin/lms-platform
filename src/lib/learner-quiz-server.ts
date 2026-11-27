import "server-only";
import { createPrismaLearnerQuizStore } from "@/lib/learner-quiz-prisma-store";

export async function getLearnerQuizStore() {
  const { db } = await import("@/lib/db");
  return createPrismaLearnerQuizStore(db);
}
