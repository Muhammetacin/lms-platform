import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { createPrismaLearnerCourseStore } from "../src/lib/learner-course-prisma-store.ts";
import { createPrismaLearnerQuizStore } from "../src/lib/learner-quiz-prisma-store.ts";
import { readAssignedCourseProgress } from "../src/lib/learning-progress-prisma-store.ts";

const dbUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL calculates progress for current assignees and retains activity after revocation", {
  skip: !dbUrl && process.env.CI !== "true",
}, async () => {
  if (!dbUrl) throw new Error("TEST_DATABASE_URL is required for the learning progress integration test.");
  assert.equal(new URL(dbUrl).pathname, "/lms_platform_test");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
  const organizationId = crypto.randomUUID();
  const foreignOrgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const teamUserId = crypto.randomUUID();
  const foreignUserId = crypto.randomUUID();
  const learner = createPrismaLearnerCourseStore(db);
  const learnerQuiz = createPrismaLearnerQuizStore(db);
  const identity = { organizationId, userId };
  const foreignIdentity = { organizationId: foreignOrgId, userId: foreignUserId };
  let seeded = false;

  try {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(database?.name, "lms_platform_test");
    seeded = true;
    await db.organization.createMany({
      data: [organizationId, foreignOrgId].map((id) => ({ id, slug: id, name: "Progress organization" })),
    });
    await db.user.createMany({
      data: [userId, teamUserId, foreignUserId].map((id) => ({ id, email: `${id}@example.test` })),
    });
    const member = await db.organizationMembership.create({ data: identity });
    const teamMember = await db.organizationMembership.create({ data: { organizationId, userId: teamUserId } });
    const foreignMember = await db.organizationMembership.create({ data: foreignIdentity });
    const course = await db.course.create({
      data: { organizationId, title: "Published course", status: "PUBLISHED", publishedAt: new Date() },
    });
    const courseId = course.id;
    const courseModule = await db.courseModule.create({ data: { organizationId, courseId, position: 1, title: "Module" } });
    const text = await db.lesson.create({
      data: { organizationId, moduleId: courseModule.id, position: 1, type: "TEXT", title: "Text", textContent: "Hello" },
    });
    const quizLesson = await db.lesson.create({
      data: { organizationId, moduleId: courseModule.id, position: 2, type: "QUIZ", title: "Quiz" },
    });
    const quiz = await db.quiz.create({ data: { organizationId, lessonId: quizLesson.id } });
    await db.quizQuestion.create({
      data: { organizationId, quizId: quiz.id, position: 1, prompt: "One or two?", options: ["One", "Two"], correctIndex: 0 },
    });
    assert.equal(await learner.completeLesson(identity, courseId, text.id), false);
    assert.equal(await learner.completeLesson(foreignIdentity, courseId, text.id), false);
    assert.equal(await readAssignedCourseProgress(db, foreignOrgId, courseId, 1), null);
    assert.deepEqual((await readAssignedCourseProgress(db, organizationId, courseId, 1))?.members, []);
    await assert.rejects(db.lessonCompletion.create({
      data: { organizationId, lessonId: text.id, membershipId: foreignMember.id },
    }));
    await assert.rejects(db.lessonCompletion.create({
      data: { organizationId: foreignOrgId, lessonId: text.id, membershipId: foreignMember.id },
    }));

    const team = await db.team.create({ data: { organizationId, name: "Progress team" } });
    const direct = { organizationId, courseId, membershipId: member.id };
    const teamAssignment = { organizationId, courseId, teamId: team.id };
    const memberInTeam = { organizationId, teamId: team.id, membershipId: member.id };
    await db.courseMemberAssignment.create({ data: direct });
    await db.courseTeamAssignment.create({ data: teamAssignment });
    await db.teamMembership.createMany({ data: [memberInTeam, { ...memberInTeam, membershipId: teamMember.id }] });
    assert.deepEqual((await learner.list(identity))[0]?.progress, { completed: 0, total: 2 });
    assert.equal(await learner.completeLesson(identity, courseId, quizLesson.id), false);
    assert.equal(await learner.completeLesson(identity, crypto.randomUUID(), text.id), false);

    assert.deepEqual(await Promise.all([
      learner.completeLesson(identity, courseId, text.id),
      learner.completeLesson(identity, courseId, text.id),
    ]), [true, true]);
    assert.equal(await db.lessonCompletion.count({ where: { lessonId: text.id, membershipId: member.id } }), 1);
    assert.deepEqual((await learner.list(identity))[0]?.progress, { completed: 1, total: 2 });
    assert.deepEqual((await learner.get(identity, courseId))?.completedLessons, new Set([text.id]));

    const address = { courseId, lessonId: quizLesson.id };
    assert.deepEqual(await learnerQuiz.submit(identity, address, { submissionId: crypto.randomUUID(), selections: [3] }),
      { kind: "invalid" });
    assert.deepEqual((await learner.get(identity, courseId))?.progress, { completed: 1, total: 2 });
    for (const choice of [1, 0]) {
      const result = await learnerQuiz.submit(identity, address, { submissionId: crypto.randomUUID(), selections: [choice] });
      assert.deepEqual(result, { kind: "scored", result: { score: choice === 0 ? 1 : 0, totalQuestions: 1 } });
      assert.deepEqual((await learner.get(identity, courseId))?.progress, { completed: 2, total: 2 });
    }
    assert.equal(await db.quizAttempt.count({ where: { quizId: quiz.id, membershipId: member.id } }), 2);
    const progress = await readAssignedCourseProgress(db, organizationId, courseId, 20);
    assert.equal(progress?.page, 1);
    assert.equal(progress?.members.length, 2);
    assert.deepEqual(progress?.members.find(({ id }) => id === member.id)?.progress, { completed: 2, total: 2 });
    assert.deepEqual(progress?.members.find(({ id }) => id === teamMember.id)?.progress, { completed: 0, total: 2 });

    await db.courseMemberAssignment.deleteMany({ where: direct });
    assert.deepEqual((await learner.get(identity, courseId))?.progress, { completed: 2, total: 2 });
    await db.teamMembership.deleteMany({ where: memberInTeam });
    assert.equal(await learner.get(identity, courseId), null);
    assert.deepEqual(await learner.list(identity), []);
    assert.equal(await learner.completeLesson(identity, courseId, text.id), false);
    assert.deepEqual((await readAssignedCourseProgress(db, organizationId, courseId, 1))?.members.map(({ id }) => id), [teamMember.id]);

    await db.organizationMembership.update({ where: { id: teamMember.id }, data: { active: false } });
    assert.deepEqual((await readAssignedCourseProgress(db, organizationId, courseId, 1))?.members, []);
    await db.courseMemberAssignment.create({ data: direct });
    assert.deepEqual((await learner.get(identity, courseId))?.progress, { completed: 2, total: 2 });
  } finally {
    try {
      if (seeded) {
        await db.organization.deleteMany({ where: { id: { in: [organizationId, foreignOrgId] } } });
        await db.user.deleteMany({ where: { id: { in: [userId, teamUserId, foreignUserId] } } });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
