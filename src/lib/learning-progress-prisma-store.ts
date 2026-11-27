import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { isCourseId } from "./course-core.ts";

type CourseActivity = {
  total: number;
  completedByMember: Map<string, Set<string>>;
};

export async function readLessonActivity(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  courseIds: string[],
  membershipIds: string[],
) {
  const activity = new Map<string, CourseActivity>(
    courseIds.map((courseId) => [courseId, { total: 0, completedByMember: new Map() }]),
  );
  const lessonScope = { organizationId, module: { courseId: { in: courseIds } } };
  const memberScope = { organizationId, membershipId: { in: membershipIds } };
  const [lessons, completions, attempts] = await Promise.all([
    transaction.lesson.findMany({
      where: lessonScope,
      select: { id: true, module: { select: { courseId: true } }, quiz: { select: { id: true } } },
    }),
    transaction.lessonCompletion.findMany({
      where: { ...memberScope, lesson: { ...lessonScope, type: { not: "QUIZ" } } },
      select: { lessonId: true, membershipId: true },
    }),
    transaction.quizAttempt.groupBy({
      by: ["quizId", "membershipId"],
      where: { ...memberScope, quiz: { lesson: { ...lessonScope, type: "QUIZ" } } },
    }),
  ]);

  const courseByLesson = new Map<string, CourseActivity>();
  const lessonByQuiz = new Map<string, string>();
  for (const lesson of lessons) {
    const course = activity.get(lesson.module.courseId)!;
    course.total += 1;
    courseByLesson.set(lesson.id, course);
    if (lesson.quiz) lessonByQuiz.set(lesson.quiz.id, lesson.id);
  }

  function addCompletion(lessonId: string, membershipId: string) {
    const course = courseByLesson.get(lessonId)!;
    const completed = course.completedByMember.get(membershipId) ?? new Set<string>();
    completed.add(lessonId);
    course.completedByMember.set(membershipId, completed);
  }

  for (const row of completions) addCompletion(row.lessonId, row.membershipId);
  for (const row of attempts) addCompletion(lessonByQuiz.get(row.quizId)!, row.membershipId);
  return activity;
}

export const PROGRESS_PAGE_SIZE = 25;

export function readAssignedCourseProgress(db: PrismaClient, organizationId: string, courseId: string, requestedPage: number) {
  if (!isCourseId(courseId)) return Promise.resolve(null);

  return db.$transaction(async (transaction) => {
    const course = await transaction.course.findFirst({
      where: { id: courseId, organizationId, status: "PUBLISHED" },
      select: { id: true, title: true },
    });
    if (!course) return null;

    const assignment = { courseId, organizationId };
    const where: Prisma.OrganizationMembershipWhereInput = {
      organizationId,
      active: true,
      role: "MEMBER",
      OR: [
        { courseAssignments: { some: assignment } },
        { teamMemberships: { some: { team: { courseAssignments: { some: assignment } } } } },
        { courseEnrollments: { some: assignment } },
      ],
    };
    const totalMembers = await transaction.organizationMembership.count({ where });
    const pageCount = Math.max(1, Math.ceil(totalMembers / PROGRESS_PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const members = await transaction.organizationMembership.findMany({
      where,
      orderBy: [{ user: { email: "asc" } }, { id: "asc" }],
      skip: (page - 1) * PROGRESS_PAGE_SIZE,
      take: PROGRESS_PAGE_SIZE,
      select: { id: true, employeeName: true, user: { select: { email: true, name: true } } },
    });
    const activity = await readLessonActivity(transaction, organizationId, [courseId], members.map(({ id }) => id));
    const { total, completedByMember } = activity.get(courseId)!;
    return {
      course,
      page,
      pageCount,
      members: members.map(({ id, employeeName, user }) => ({
        id,
        name: employeeName ?? user.name ?? user.email,
        email: user.email,
        progress: { completed: completedByMember.get(id)?.size ?? 0, total },
      })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
