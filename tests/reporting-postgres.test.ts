import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { readAssignedCourseProgress } from "../src/lib/learning-progress-prisma-store.ts";
import { readReportFilters, REPORT_PAGE_SIZE } from "../src/lib/reporting-core.ts";
import { listCourseReports, readCourseReport } from "../src/lib/reporting-prisma-store.ts";

const dbUrl = process.env.TEST_DATABASE_URL;

test("course reports match current progress and show only the latest result per quiz", {
  skip: !dbUrl && process.env.CI !== "true",
}, async () => {
  if (!dbUrl) throw new Error("TEST_DATABASE_URL is required for the reporting integration test.");
  assert.equal(new URL(dbUrl).pathname, "/lms_platform_test");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
  const organizationId = crypto.randomUUID();
  const foreignOrgId = crypto.randomUUID();
  const suffix = organizationId.slice(0, 8);
  let seeded = false;
  const published = { status: "PUBLISHED" as const, publishedAt: new Date() };
  try {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(database?.name, "lms_platform_test");
    seeded = true;
    await db.organization.createMany({
      data: [organizationId, foreignOrgId].map((id) => ({ id, slug: id, name: "Reports organization" })),
    });
    const email = (name: string) => `${name}-${suffix}@report-fixtures.test`;
    const addMember = async (name: string, overrides: { active?: boolean; role?: "ADMIN" } = {}) => {
      const user = await db.user.create({ data: { email: email(name), name } });
      return db.organizationMembership.create({ data: { organizationId, userId: user.id, ...overrides } });
    };
    const completed = await addMember("a-completed");
    const partial = await addMember("b-partial");
    const idle = await addMember("c-idle");
    const inactive = await addMember("d-inactive", { active: false });
    const staff = await addMember("e-admin", { role: "ADMIN" });
    const team = await db.team.create({ data: { organizationId, name: "North % Team" } });
    await db.teamMembership.createMany({
      data: [completed, idle, inactive, staff].map(({ id }) => ({ organizationId, teamId: team.id, membershipId: id })),
    });
    const course = await db.course.create({ data: { organizationId, title: "safety Course", ...published } });
    const empty = await db.course.create({ data: { organizationId, title: "empty Course", ...published } });
    const draft = await db.course.create({ data: { organizationId, title: "Draft Course" } });
    const foreign = await db.course.create({ data: { organizationId: foreignOrgId, title: "Foreign Course", ...published } });
    const courseId = course.id;
    const direct = { organizationId, courseId, membershipId: completed.id };
    await db.courseMemberAssignment.createMany({ data: [direct, { ...direct, membershipId: partial.id }] });
    await db.courseTeamAssignment.create({ data: { organizationId, courseId, teamId: team.id } });
    const courseModule = await db.courseModule.create({ data: { organizationId, courseId, position: 1, title: "Module" } });
    const text = await db.lesson.create({
      data: { organizationId, moduleId: courseModule.id, position: 1, type: "TEXT", title: "Lesson", textContent: "Read" },
    });
    const firstQuiz = await db.lesson.create({
      data: { organizationId, moduleId: courseModule.id, position: 2, type: "QUIZ", title: "First quiz" },
    });
    const secondQuiz = await db.lesson.create({
      data: { organizationId, moduleId: courseModule.id, position: 3, type: "QUIZ", title: "Second quiz" },
    });
    const [first, second] = await Promise.all([firstQuiz, secondQuiz].map(({ id }) =>
      db.quiz.create({ data: { organizationId, lessonId: id } }),
    ));
    await db.lessonCompletion.create({ data: { organizationId, lessonId: text.id, membershipId: completed.id } });
    const addAttempt = (quizId: string, membershipId: string, score: number, day: number) => ({
      organizationId, quizId, membershipId, score, totalQuestions: 1, selections: [score],
      submissionId: crypto.randomUUID(), createdAt: new Date(Date.UTC(2026, 0, day)),
    });
    await db.quizAttempt.createMany({ data: [
      addAttempt(first.id, completed.id, 1, 1),
      addAttempt(first.id, completed.id, 0, 2),
      addAttempt(second.id, completed.id, 1, 3),
      addAttempt(first.id, partial.id, 1, 3),
      addAttempt(first.id, inactive.id, 1, 3),
    ] });

    const all = readReportFilters({});
    const { rows } = await listCourseReports(db, organizationId, all);
    assert.deepEqual(rows, [
      { id: empty.id, title: empty.title, assigned: 0, notStarted: 0, inProgress: 0, completed: 0, quizParticipants: 0 },
      { id: courseId, title: course.title, assigned: 3, notStarted: 1, inProgress: 1, completed: 1, quizParticipants: 2 },
    ]);
    const teamFiltered = readReportFilters({ course: "SAFETY", team: "North %" });
    assert.deepEqual((await listCourseReports(db, organizationId, teamFiltered)).rows, [
      { id: courseId, title: course.title, assigned: 2, notStarted: 1, inProgress: 0, completed: 1, quizParticipants: 1 },
    ]);
    assert.deepEqual((await listCourseReports(db, organizationId, readReportFilters({ team: "Team_" }))).rows, []);
    assert.deepEqual((await listCourseReports(db, organizationId, { ...teamFiltered, status: "inProgress" })).rows, []);
    assert.equal((await readCourseReport(db, organizationId, courseId, { ...teamFiltered, status: "completed" }))?.assigned, 1);
    assert.equal(await readCourseReport(db, organizationId, draft.id, all), null);
    assert.equal(await readCourseReport(db, organizationId, foreign.id, all), null);
    assert.equal(await readCourseReport(db, foreignOrgId, courseId, all), null);

    const report = await readCourseReport(db, organizationId, courseId, all);
    const progress = await readAssignedCourseProgress(db, organizationId, courseId, 1);
    assert.deepEqual(report?.members.map(({ membershipId, completed, total }) => ({
      id: membershipId, progress: { completed, total },
    })), progress?.members.map(({ id, progress }) => ({ id, progress })));
    assert.deepEqual(report?.members[0]?.scores, [
      { lessonId: firstQuiz.id, quizTitle: firstQuiz.title, score: 0, totalQuestions: 1 },
      { lessonId: secondQuiz.id, quizTitle: secondQuiz.title, score: 1, totalQuestions: 1 },
    ]);
    assert.deepEqual(report?.members[2]?.scores, []);

    await db.courseMemberAssignment.deleteMany({ where: direct });
    assert.equal((await readCourseReport(db, organizationId, courseId, all))?.assigned, 3);
    await db.teamMembership.deleteMany({ where: { teamId: team.id, membershipId: completed.id, organizationId } });
    assert.equal((await readCourseReport(db, organizationId, courseId, all))?.quizParticipants, 1);
    await db.courseMemberAssignment.create({ data: direct });
    assert.equal((await readCourseReport(db, organizationId, courseId, all))?.quizParticipants, 2);

    const slots = Array.from({ length: REPORT_PAGE_SIZE + 1 }, (_, index) => String(index).padStart(2, "0"));
    await db.course.createMany({
      data: slots.map((slot) => ({ organizationId, title: `Paged ${slot}`, ...published })),
    });
    const firstPage = await listCourseReports(db, organizationId, readReportFilters({ course: "Paged" }));
    const nextPage = await listCourseReports(db, organizationId, readReportFilters({ course: "Paged", page: "2" }));
    assert.equal(firstPage.rows.length, REPORT_PAGE_SIZE);
    assert.equal(firstPage.hasNext, true);
    assert.equal(nextPage.hasNext, false);
    assert.deepEqual(nextPage.rows.map(({ title }) => title), [`Paged ${slots.at(-1)}`]);

    const extra = await db.user.createManyAndReturn({
      data: slots.map((slot) => ({ email: email(`z-${slot}`) })), select: { id: true },
    });
    const members = await db.organizationMembership.createManyAndReturn({
      data: extra.map(({ id }) => ({ organizationId, userId: id })), select: { id: true },
    });
    await db.courseMemberAssignment.createMany({ data: members.map(({ id }) => ({ organizationId, courseId, membershipId: id })) });
    const pagedDetail = await readCourseReport(db, organizationId, courseId, { ...all, page: 2 });
    assert.equal(pagedDetail?.assigned, 3 + slots.length);
    assert.equal(pagedDetail?.quizParticipants, 2);
    assert.deepEqual(pagedDetail?.members.map(({ email: address }) => address),
      slots.slice(REPORT_PAGE_SIZE - 3).map((slot) => email(`z-${slot}`)));
    assert.deepEqual((await readCourseReport(db, organizationId, courseId, { ...all, page: 3 }))?.members, []);
  } finally {
    try {
      if (seeded) {
        await db.organization.deleteMany({ where: { id: { in: [organizationId, foreignOrgId] } } });
        await db.user.deleteMany({ where: { email: { endsWith: `-${suffix}@report-fixtures.test` } } });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
