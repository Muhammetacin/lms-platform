import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import { isCourseId } from "./course-core.ts";
import { REPORT_PAGE_SIZE, type ReportFilters } from "./reporting-core.ts";

type CourseReportRow = {
  id: string;
  title: string;
  assigned: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  quizParticipants: number;
};

type LearnerReportRow = {
  membershipId: string;
  name: string;
  email: string;
  completed: number;
  total: number;
};

type LatestScore = {
  membershipId: string;
  lessonId: string;
  quizTitle: string;
  score: number;
  totalQuestions: number;
};

function reportProgress(organizationId: string, filters: ReportFilters, courseId?: string) {
  const org = Prisma.sql`${organizationId}::uuid`;
  const courseFilter = courseId
    ? Prisma.sql`AND course.id = ${courseId}::uuid`
    : Prisma.sql`AND strpos(lower(course.title), lower(${filters.course})) > 0`;
  const teamFilter = filters.team ? Prisma.sql`
    AND EXISTS (
      SELECT 1
      FROM "TeamMembership" tm
      JOIN "Team" team ON team.id = tm."teamId" AND team."organizationId" = tm."organizationId"
      WHERE tm."organizationId" = ${org} AND tm."membershipId" = member.id
        AND strpos(lower(team.name), lower(${filters.team})) > 0
    )
  ` : Prisma.empty;
  const statusFilter = filters.status ? Prisma.sql`WHERE status = ${filters.status}` : Prisma.empty;

  return Prisma.sql`
    WITH published_courses AS (
      SELECT course.id, course.title
      FROM "Course" course
      WHERE course."organizationId" = ${org} AND course.status = 'PUBLISHED'
        ${courseFilter}
    ),
    assignment_paths AS (
      SELECT direct."courseId", direct."membershipId"
      FROM "CourseMemberAssignment" direct
      JOIN published_courses course ON course.id = direct."courseId"
      WHERE direct."organizationId" = ${org}
      UNION
      SELECT assigned."courseId", tm."membershipId"
      FROM "CourseTeamAssignment" assigned
      JOIN published_courses course ON course.id = assigned."courseId"
      JOIN "TeamMembership" tm
        ON tm."teamId" = assigned."teamId" AND tm."organizationId" = assigned."organizationId"
      WHERE assigned."organizationId" = ${org}
    ),
    assignees AS (
      SELECT paths."courseId", paths."membershipId"
      FROM assignment_paths paths
      JOIN "OrganizationMembership" member ON member.id = paths."membershipId"
      WHERE member."organizationId" = ${org} AND member.active AND member.role = 'MEMBER'
        ${teamFilter}
    ),
    lessons AS (
      SELECT lesson.id, module."courseId", lesson.type
      FROM "Lesson" lesson
      JOIN "CourseModule" module
        ON module.id = lesson."moduleId" AND module."organizationId" = lesson."organizationId"
      JOIN published_courses course ON course.id = module."courseId"
      WHERE lesson."organizationId" = ${org}
    ),
    lesson_totals AS (
      SELECT "courseId", count(*)::int AS total FROM lessons GROUP BY "courseId"
    ),
    completed_lessons AS (
      SELECT assigned."courseId", assigned."membershipId", false AS quiz
      FROM "LessonCompletion" completion
      JOIN lessons lesson ON lesson.id = completion."lessonId" AND lesson.type <> 'QUIZ'
      JOIN assignees assigned ON assigned."courseId" = lesson."courseId"
        AND assigned."membershipId" = completion."membershipId"
      WHERE completion."organizationId" = ${org}
      UNION ALL
      SELECT assigned."courseId", assigned."membershipId", true AS quiz
      FROM "Quiz" quiz
      JOIN lessons lesson ON lesson.id = quiz."lessonId" AND lesson.type = 'QUIZ'
      JOIN assignees assigned ON assigned."courseId" = lesson."courseId"
      WHERE quiz."organizationId" = ${org} AND EXISTS (
        SELECT 1 FROM "QuizAttempt" attempt
        WHERE attempt."quizId" = quiz.id AND attempt."membershipId" = assigned."membershipId"
          AND attempt."organizationId" = ${org}
      )
    ),
    completion_totals AS (
      SELECT "courseId", "membershipId", count(*)::int AS completed, bool_or(quiz) AS "hasQuiz"
      FROM completed_lessons GROUP BY "courseId", "membershipId"
    ),
    progress AS (
      SELECT assigned."courseId", assigned."membershipId", coalesce(lesson_totals.total, 0) AS total,
        coalesce(completion_totals.completed, 0) AS completed,
        coalesce(completion_totals."hasQuiz", false) AS "hasQuiz",
        CASE
          WHEN coalesce(completion_totals.completed, 0) = 0 THEN 'notStarted'
          WHEN completion_totals.completed = lesson_totals.total THEN 'completed'
          ELSE 'inProgress'
        END AS status
      FROM assignees assigned
      LEFT JOIN lesson_totals USING ("courseId")
      LEFT JOIN completion_totals USING ("courseId", "membershipId")
    ),
    matching_progress AS (SELECT * FROM progress ${statusFilter})
  `;
}

export async function listCourseReports(db: PrismaClient, organizationId: string, filters: ReportFilters) {
  const matchingOnly = filters.team || filters.status ? Prisma.sql`HAVING count(progress."membershipId") > 0` : Prisma.empty;
  const rows = await db.$queryRaw<CourseReportRow[]>`
    ${reportProgress(organizationId, filters)}
    SELECT course.id, course.title, count(progress."membershipId")::int AS assigned,
      (count(*) FILTER (WHERE progress.status = 'notStarted'))::int AS "notStarted",
      (count(*) FILTER (WHERE progress.status = 'inProgress'))::int AS "inProgress",
      (count(*) FILTER (WHERE progress.status = 'completed'))::int AS completed,
      (count(*) FILTER (WHERE progress."hasQuiz"))::int AS "quizParticipants"
    FROM published_courses course
    LEFT JOIN matching_progress progress ON progress."courseId" = course.id
    GROUP BY course.id, course.title
    ${matchingOnly}
    ORDER BY course.title, course.id
    LIMIT ${REPORT_PAGE_SIZE + 1}::int OFFSET ${BigInt(filters.page - 1) * BigInt(REPORT_PAGE_SIZE)}::bigint
  `;
  return { rows: rows.slice(0, REPORT_PAGE_SIZE), hasNext: rows.length > REPORT_PAGE_SIZE };
}

export async function readCourseReport(db: PrismaClient, organizationId: string, courseId: string, filters: ReportFilters) {
  if (!isCourseId(courseId)) return null;

  return db.$transaction(async (transaction) => {
    const course = await transaction.course.findFirst({
      where: { id: courseId, organizationId, status: "PUBLISHED" },
      select: { id: true, title: true },
    });
    if (!course) return null;

    const [report] = await transaction.$queryRaw<{
      assigned: number; quizParticipants: number; members: LearnerReportRow[];
    }[]>`
      ${reportProgress(organizationId, filters, course.id)}
      SELECT count(*)::int AS assigned, (count(*) FILTER (WHERE "hasQuiz"))::int AS "quizParticipants",
        coalesce((
          SELECT jsonb_agg(paged ORDER BY paged.email, paged."membershipId")
          FROM (
            SELECT progress."membershipId", coalesce(member."employeeName", account.name, account.email) AS name,
              account.email, progress.completed, progress.total
            FROM matching_progress progress
            JOIN "OrganizationMembership" member
              ON member.id = progress."membershipId" AND member."organizationId" = ${organizationId}::uuid
            JOIN "User" account ON account.id = member."userId"
            ORDER BY account.email, progress."membershipId"
            LIMIT ${REPORT_PAGE_SIZE + 1}::int OFFSET ${BigInt(filters.page - 1) * BigInt(REPORT_PAGE_SIZE)}::bigint
          ) paged
        ), '[]'::jsonb) AS members
      FROM matching_progress
    `;
    const members = report.members.slice(0, REPORT_PAGE_SIZE);
    const latestScores = members.length === 0 ? [] : await transaction.$queryRaw<LatestScore[]>`
      SELECT DISTINCT ON (attempt."membershipId", attempt."quizId")
        attempt."membershipId", lesson.id AS "lessonId", lesson.title AS "quizTitle", attempt.score, attempt."totalQuestions"
      FROM "QuizAttempt" attempt
      JOIN "Quiz" quiz ON quiz.id = attempt."quizId" AND quiz."organizationId" = attempt."organizationId"
      JOIN "Lesson" lesson ON lesson.id = quiz."lessonId" AND lesson."organizationId" = quiz."organizationId"
      JOIN "CourseModule" module ON module.id = lesson."moduleId" AND module."organizationId" = lesson."organizationId"
      WHERE attempt."organizationId" = ${organizationId}::uuid AND module."courseId" = ${course.id}::uuid
        AND lesson.type = 'QUIZ'
        AND attempt."membershipId" IN (${Prisma.join(members.map(({ membershipId }) => Prisma.sql`${membershipId}::uuid`))})
      ORDER BY attempt."membershipId", attempt."quizId", attempt."createdAt" DESC, attempt.id DESC
    `;
    const scoresByMember = new Map<string, Omit<LatestScore, "membershipId">[]>();
    for (const { membershipId, ...score } of latestScores) {
      const scores = scoresByMember.get(membershipId) ?? [];
      scores.push(score);
      scoresByMember.set(membershipId, scores);
    }
    return {
      course,
      assigned: report.assigned,
      quizParticipants: report.quizParticipants,
      hasNext: report.members.length > REPORT_PAGE_SIZE,
      members: members.map((member) => ({
        ...member,
        scores: (scoresByMember.get(member.membershipId) ?? []).sort((a, b) => a.quizTitle.localeCompare(b.quizTitle, "nl")),
      })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
