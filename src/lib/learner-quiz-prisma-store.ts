import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { activeLearnerMembership, assignedCourseWhere, type LearnerIdentity } from "./learner-course-prisma-store.ts";
import { scoreQuiz, validQuizAddress, type LearnerQuizStore } from "./learner-quiz-core.ts";
import { sameQuizSelections } from "./quiz-core.ts";
import type { QuizAddress } from "./quiz-author-core.ts";

function availableQuiz(identity: LearnerIdentity, address: QuizAddress): Prisma.QuizWhereInput {
  return {
    organizationId: identity.organizationId,
    lessonId: address.lessonId,
    questions: { some: {} },
    lesson: {
      type: "QUIZ",
      module: { course: { id: address.courseId, AND: assignedCourseWhere(identity) } },
    },
  };
}

export function createPrismaLearnerQuizStore(db: PrismaClient): LearnerQuizStore {
  return {
    async get(identity, address) {
      if (!validQuizAddress(address)) return null;
      return db.$transaction(async (transaction) => {
        const member = await activeLearnerMembership(transaction, identity);
        if (!member) return null;
        const quiz = await transaction.quiz.findFirst({
          where: availableQuiz(identity, address),
          select: {
            lesson: { select: { title: true } },
            questions: { orderBy: { position: "asc" }, select: { prompt: true, options: true } },
            attempts: {
              where: { organizationId: identity.organizationId, membershipId: member.id },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 1,
              select: { score: true, totalQuestions: true },
            },
          },
        });
        return quiz ? {
          title: quiz.lesson.title,
          questions: quiz.questions,
          latestResult: quiz.attempts[0] ?? null,
        } : null;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
    async submit(identity, address, submission) {
      if (!validQuizAddress(address)) return { kind: "missing" };
      return db.$transaction(async (transaction) => {
        const member = await activeLearnerMembership(transaction, identity);
        if (!member) return { kind: "missing" };
        const quiz = await transaction.quiz.findFirst({
          where: availableQuiz(identity, address),
          select: {
            id: true,
            questions: {
              orderBy: { position: "asc" },
              select: { prompt: true, options: true, correctIndex: true },
            },
          },
        });
        if (!quiz) return { kind: "missing" };
        const result = scoreQuiz(quiz.questions, submission.selections);
        if (!result) return { kind: "invalid" };

        const identityKey = { quizId: quiz.id, membershipId: member.id, submissionId: submission.submissionId };
        await transaction.quizAttempt.createMany({
          data: { ...identityKey, organizationId: identity.organizationId, selections: submission.selections, ...result },
          skipDuplicates: true,
        });
        // READ COMMITTED makes a concurrent submission with the same key visible after the insert settles.
        const saved = await transaction.quizAttempt.findUniqueOrThrow({
          where: { quizId_membershipId_submissionId: identityKey, organizationId: identity.organizationId },
          select: { score: true, totalQuestions: true, selections: true },
        });
        if (!sameQuizSelections(saved.selections, submission.selections)) return { kind: "conflict" };
        return { kind: "scored", result: { score: saved.score, totalQuestions: saved.totalQuestions } };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    },
  };
}
