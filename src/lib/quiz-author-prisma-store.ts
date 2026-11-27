import type { PrismaClient, Prisma } from "../generated/prisma/client.ts";
import { lockCourseStructure } from "./course-structure-lock.ts";
import type { QuizAddress, QuizAuthorStore } from "./quiz-author-core.ts";

function lessonWhere(organizationId: string, { courseId, lessonId }: QuizAddress): Prisma.LessonWhereInput {
  return { id: lessonId, organizationId, type: "QUIZ", module: { courseId, organizationId } };
}

export function createPrismaQuizAuthorStore(db: PrismaClient): QuizAuthorStore {
  return {
    async get(organizationId, address) {
      const lesson = await db.lesson.findFirst({
        where: lessonWhere(organizationId, address),
        select: {
          title: true,
          module: { select: { course: { select: { status: true } } } },
          quiz: {
            select: {
              questions: { orderBy: { position: "asc" }, select: { prompt: true, options: true, correctIndex: true } },
            },
          },
        },
      });
      return lesson ? {
        title: lesson.title,
        editable: lesson.module.course.status === "DRAFT",
        questions: lesson.quiz?.questions ?? [],
      } : null;
    },
    replace(organizationId, address, questions) {
      return db.$transaction(async (transaction) => {
        const course = await lockCourseStructure(transaction, organizationId, address.courseId);
        if (!course) return "missing";
        const lesson = await transaction.lesson.findFirst({
          where: lessonWhere(organizationId, address),
          select: { id: true },
        });
        if (!lesson) return "missing";
        if (course.status === "PUBLISHED") return "locked";
        const quiz = await transaction.quiz.upsert({
          where: { lessonId_organizationId: { lessonId: lesson.id, organizationId } },
          create: { organizationId, lessonId: lesson.id },
          update: {},
          select: { id: true },
        });
        await transaction.quizQuestion.deleteMany({ where: { organizationId, quizId: quiz.id } });
        await transaction.quizQuestion.createMany({
          data: questions.map((question, index) => ({
            ...question, position: index + 1, organizationId, quizId: quiz.id,
          })),
        });
        return "saved";
      });
    },
  };
}
