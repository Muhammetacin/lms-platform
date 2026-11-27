import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { createPrismaCoursePublishingStore } from "../src/lib/course-publishing-prisma-store.ts";
import { createPrismaLearnerQuizStore } from "../src/lib/learner-quiz-prisma-store.ts";
import { createPrismaLessonStore } from "../src/lib/lesson-prisma-store.ts";
import { createPrismaQuizAuthorStore } from "../src/lib/quiz-author-prisma-store.ts";

const dbUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL protects quiz authoring, publishing and scored attempts", {
  skip: !dbUrl && process.env.CI !== "true",
}, async () => {
  if (!dbUrl) throw new Error("TEST_DATABASE_URL is required for the quiz integration test.");
  assert.equal(new URL(dbUrl).pathname, "/lms_platform_test");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const userForeign = crypto.randomUUID();
  const learnerA = { organizationId: orgA, userId: userA };
  const learnerB = { organizationId: orgA, userId: userB };
  const author = createPrismaQuizAuthorStore(db);
  const publishing = createPrismaCoursePublishingStore(db);
  const learner = createPrismaLearnerQuizStore(db);
  const lessons = createPrismaLessonStore(db);
  const correct = { score: 2, totalQuestions: 2 };
  const questions = [
    { prompt: "Choose two", options: ["One", "Two"], correctIndex: 1 },
    { prompt: "Choose yes", options: ["Yes", "No"], correctIndex: 0 },
  ];
  let seeded = false;

  try {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(database?.name, "lms_platform_test");
    seeded = true;
    await db.organization.createMany({ data: [
      { id: orgA, slug: orgA, name: "Quiz organization" },
      { id: orgB, slug: orgB, name: "Foreign quiz organization" },
    ] });
    await db.user.createMany({
      data: [userA, userB, userForeign].map((id) => ({ id, email: `${id}@example.test` })),
    });
    const memberA = await db.organizationMembership.create({ data: { organizationId: orgA, userId: userA } });
    const memberB = await db.organizationMembership.create({ data: { organizationId: orgA, userId: userB } });
    const foreignMember = await db.organizationMembership.create({ data: { organizationId: orgB, userId: userForeign } });
    const course = await db.course.create({ data: { title: "Quiz course", organizationId: orgA } });
    const courseModule = await db.courseModule.create({
      data: { title: "Module", organizationId: orgA, courseId: course.id, position: 1 },
    });
    const lesson = await db.lesson.create({
      data: { title: "Quiz lesson", organizationId: orgA, moduleId: courseModule.id, position: 1, type: "QUIZ" },
    });
    const address = { courseId: course.id, lessonId: lesson.id };
    const direct = { organizationId: orgA, courseId: course.id, membershipId: memberA.id };
    const submission = { submissionId: crypto.randomUUID(), selections: [1, 0] };

    const blocked = await publishing.publish(orgA, course.id);
    assert.equal(blocked.kind, "not_publishable");
    if (blocked.kind === "not_publishable") assert.equal(blocked.issues[0]?.code, "quiz_not_configured");
    assert.equal(await author.get(orgB, address), null);
    assert.equal(await author.replace(orgB, address, questions), "missing");
    assert.equal(await author.replace(orgA, address, questions), "saved");
    assert.deepEqual((await author.get(orgA, address))?.questions, questions);
    assert.equal(await learner.get(learnerA, address), null);

    assert.equal((await lessons.update(orgA, course.id, courseModule.id, lesson.id, { title: "New quiz title" })).kind, "ok");
    assert.deepEqual((await author.get(orgA, address))?.questions, questions);
    assert.equal((await lessons.update(orgA, course.id, courseModule.id, lesson.id, { type: "TEXT" })).kind, "ok");
    assert.equal(await db.quiz.count({ where: { lessonId: lesson.id } }), 0);
    assert.equal((await lessons.update(orgA, course.id, courseModule.id, lesson.id, { type: "QUIZ" })).kind, "ok");
    assert.equal(await author.replace(orgA, address, questions), "saved");
    const quiz = await db.quiz.findFirstOrThrow({ where: { lessonId: lesson.id, organizationId: orgA } });
    await assert.rejects(db.quizQuestion.create({
      data: { organizationId: orgA, quizId: quiz.id, position: 3, prompt: "Invalid key", options: ["A", "B"], correctIndex: 2 },
    }));
    await assert.rejects(db.quizAttempt.create({
      data: { organizationId: orgA, quizId: quiz.id, membershipId: foreignMember.id, ...submission, ...correct },
    }));
    assert.equal((await publishing.publish(orgA, course.id)).kind, "published");
    assert.equal(await author.replace(orgA, address, questions), "locked");
    assert.deepEqual(await learner.submit(learnerA, address, submission), { kind: "missing" });

    const team = await db.team.create({ data: { organizationId: orgA, name: "Quiz learning team" } });
    await db.courseMemberAssignment.create({ data: direct });
    await db.courseTeamAssignment.create({ data: { organizationId: orgA, courseId: course.id, teamId: team.id } });
    await db.teamMembership.create({ data: { organizationId: orgA, membershipId: memberB.id, teamId: team.id } });
    assert.deepEqual(await learner.get(learnerA, address), {
      title: "New quiz title",
      questions: questions.map(({ prompt, options }) => ({ prompt, options })),
      latestResult: null,
    });
    assert.equal(await learner.get({ organizationId: orgB, userId: userForeign }, address), null);
    assert.deepEqual(await learner.submit(learnerA, address, { ...submission, selections: [5, 0] }), { kind: "invalid" });
    assert.deepEqual(await Promise.all([
      learner.submit(learnerA, address, submission),
      learner.submit(learnerA, address, submission),
    ]), [{ kind: "scored", result: correct }, { kind: "scored", result: correct }]);
    assert.equal(await db.quizAttempt.count({ where: { quizId: quiz.id, membershipId: memberA.id } }), 1);
    assert.deepEqual(await learner.submit(learnerA, address, { ...submission, selections: [0, 0] }), { kind: "conflict" });
    assert.equal((await learner.get(learnerB, address))?.latestResult, null);
    assert.deepEqual(await learner.submit(learnerB, address, { ...submission, selections: [0, 1] }),
      { kind: "scored", result: { score: 0, totalQuestions: 2 } });
    assert.deepEqual((await learner.get(learnerA, address))?.latestResult, correct);
    assert.deepEqual((await learner.get(learnerB, address))?.latestResult, { score: 0, totalQuestions: 2 });
    await db.courseMemberAssignment.deleteMany({ where: direct });
    assert.equal(await learner.get(learnerA, address), null);
    assert.deepEqual(await learner.submit(learnerA, address, submission), { kind: "missing" });
  } finally {
    try {
      if (seeded) {
        await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
        await db.user.deleteMany({ where: { id: { in: [userA, userB, userForeign] } } });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
