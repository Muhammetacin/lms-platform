import "server-only";
import { requireOrganizationPermission } from "@/lib/authorization";
import { loadAuthorQuiz, type QuizAddress } from "@/lib/quiz-author-core";
import { createPrismaQuizAuthorStore } from "@/lib/quiz-author-prisma-store";
import { requireTenantContext } from "@/lib/tenant-context";

export const quizAuthorDependencies = {
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  async getStore() {
    const { db } = await import("@/lib/db");
    return createPrismaQuizAuthorStore(db);
  },
};

export function getAuthorQuiz(address: QuizAddress) {
  return loadAuthorQuiz(quizAuthorDependencies, address);
}
