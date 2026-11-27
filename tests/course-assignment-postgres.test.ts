import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client.ts";
import { createPrismaCourseAssignmentStore } from "../src/lib/course-assignment-prisma-store.ts";
import { createPrismaLearnerCourseStore } from "../src/lib/learner-course-prisma-store.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;

test("PostgreSQL enforces assignment scope, uniqueness and current learner access", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for assignment integration tests.");
  assert.equal(new URL(databaseUrl).pathname, "/lms_platform_test");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const userA = crypto.randomUUID();
  const userB = crypto.randomUUID();
  const identity = { organizationId: orgA, userId: userA };
  const assignments = createPrismaCourseAssignmentStore(db);
  const learner = createPrismaLearnerCourseStore(db);
  const foreignKeyError = (error: unknown) =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
  let seeded = false;

  try {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(database?.name, "lms_platform_test");
    seeded = true;
    await db.organization.createMany({ data: [
      { id: orgA, slug: orgA, name: "Assignment organization A" },
      { id: orgB, slug: orgB, name: "Assignment organization B" },
    ] });
    await db.user.createMany({ data: [
      { id: userA, email: `${userA}@example.test`, name: "Matching learner A" },
      { id: userB, email: `${userB}@example.test`, name: "Matching learner B" },
    ] });
    const memberA = await db.organizationMembership.create({ data: { organizationId: orgA, userId: userA } });
    const memberB = await db.organizationMembership.create({ data: { organizationId: orgB, userId: userB } });
    const teamA = await db.team.create({ data: { organizationId: orgA, name: "Matching team A" } });
    const teamB = await db.team.create({ data: { organizationId: orgB, name: "Matching team B" } });
    const publish = (organizationId: string, title: string) => db.course.create({
      data: { organizationId, title, status: "PUBLISHED", publishedAt: new Date() },
    });
    const course = await publish(orgA, "Assigned course");
    const foreign = await publish(orgB, "Foreign course");
    const draft = await db.course.create({ data: { organizationId: orgA, title: "Draft course" } });
    const courseModule = await db.courseModule.create({ data: { organizationId: orgA, courseId: course.id, position: 1, title: "Module" } });
    await db.lesson.create({ data: {
      organizationId: orgA, moduleId: courseModule.id, position: 1, type: "TEXT", title: "Lesson", textContent: "Assigned content",
    } });

    const member = { type: "member", targetId: memberA.id } as const;
    const team = { type: "team", targetId: teamA.id } as const;
    assert.equal(await assignments.courseStatus(orgA, foreign.id), null);
    assert.equal(await assignments.courseStatus(orgA, draft.id), "DRAFT");
    assert.deepEqual((await assignments.search(orgA, "member", "matching")).map((item) => item.targetId), [memberA.id]);
    assert.deepEqual((await assignments.search(orgA, "team", "matching")).map((item) => item.targetId), [teamA.id]);
    assert.equal(await assignments.grant(orgA, course.id, { type: "member", targetId: memberB.id }), false);
    assert.equal(await assignments.grant(orgA, course.id, { type: "team", targetId: teamB.id }), false);

    await assert.rejects(
      db.courseMemberAssignment.create({ data: { organizationId: orgA, courseId: course.id, membershipId: memberB.id } }),
      foreignKeyError,
    );
    await assert.rejects(
      db.courseTeamAssignment.create({ data: { organizationId: orgA, courseId: foreign.id, teamId: teamA.id } }),
      foreignKeyError,
    );
    assert.deepEqual(await learner.list(identity), []);
    assert.equal(await learner.get(identity, course.id), null);

    assert.deepEqual(await Promise.all([
      assignments.grant(orgA, course.id, member),
      assignments.grant(orgA, course.id, member),
    ]), [true, true]);
    assert.equal(await assignments.grant(orgA, course.id, team), true);
    assert.equal(await assignments.grant(orgA, course.id, team), true);
    assert.equal((await assignments.list(orgA, course.id)).length, 2);
    const teamMembership = await db.teamMembership.create({
      data: { organizationId: orgA, teamId: teamA.id, membershipId: memberA.id },
    });
    await db.courseMemberAssignment.create({ data: { organizationId: orgA, courseId: draft.id, membershipId: memberA.id } });
    await assignments.grant(orgB, foreign.id, { type: "member", targetId: memberB.id });

    assert.deepEqual((await learner.list(identity)).map((item) => item.id), [course.id]);
    assert.deepEqual((await learner.get(identity, course.id))?.modules[0]?.lessons[0]?.content, { text: "Assigned content" });
    assert.equal(await learner.get(identity, draft.id), null);
    assert.equal(await learner.get(identity, foreign.id), null);
    await assignments.revoke(orgA, course.id, member);
    await assignments.revoke(orgA, course.id, member);
    assert.equal((await learner.get(identity, course.id))?.id, course.id);
    await db.teamMembership.delete({ where: { id: teamMembership.id } });
    assert.equal(await learner.get(identity, course.id), null);

    await db.teamMembership.create({ data: { organizationId: orgA, teamId: teamA.id, membershipId: memberA.id } });
    await db.organizationMembership.update({ where: { id: memberA.id }, data: { active: false } });
    assert.deepEqual(await learner.list(identity), []);
    assert.equal(await learner.get(identity, course.id), null);
    assert.equal(await assignments.grant(orgA, course.id, member), false);
    await db.team.delete({ where: { id: teamA.id } });
    assert.deepEqual(await assignments.list(orgA, course.id), []);
  } finally {
    try {
      if (seeded) {
        await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
        await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
