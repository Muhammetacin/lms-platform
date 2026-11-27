import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { enrollInCatalogCourse, listCourseCatalog, setCourseCatalogListing } from "../src/lib/course-catalog-prisma-store.ts";
import { createPrismaLearnerCourseStore } from "../src/lib/learner-course-prisma-store.ts";
import { readCourseReport } from "../src/lib/reporting-prisma-store.ts";

const dbUrl = process.env.TEST_DATABASE_URL;

test("catalog enrollment is tenant-scoped, idempotent and survives delisting", {
  skip: !dbUrl && process.env.CI !== "true",
}, async () => {
  if (!dbUrl) throw new Error("TEST_DATABASE_URL is required for the catalog integration test.");
  assert.equal(new URL(dbUrl).pathname, "/lms_platform_test");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
  const organizationId = crypto.randomUUID();
  const foreignOrgId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const foreignUserId = crypto.randomUUID();
  const identity = { organizationId, userId };
  const foreignIdentity = { organizationId: foreignOrgId, userId: foreignUserId };
  const learner = createPrismaLearnerCourseStore(db);
  let initialized = false;

  try {
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(database?.name, "lms_platform_test");
    initialized = true;
    await db.organization.createMany({
      data: [organizationId, foreignOrgId].map((id) => ({ id, slug: id, name: "Catalog organization" })),
    });
    await db.user.createMany({
      data: [userId, foreignUserId].map((id) => ({ id, email: `${id}@example.test` })),
    });
    const member = await db.organizationMembership.create({ data: identity });
    const foreignMember = await db.organizationMembership.create({ data: foreignIdentity });
    const { id: courseId, catalogListed } = await db.course.create({
      data: { organizationId, title: "Catalog course", status: "PUBLISHED", publishedAt: new Date() },
    });
    const draft = await db.course.create({ data: { organizationId, title: "Draft" } });
    const enrollment = { courseId, organizationId, membershipId: member.id };
    assert.equal(catalogListed, false);
    assert.deepEqual(await listCourseCatalog(db, identity), []);
    assert.equal(await enrollInCatalogCourse(db, identity, courseId), false);
    assert.equal(await setCourseCatalogListing(db, organizationId, draft.id, true), false);
    assert.equal(await setCourseCatalogListing(db, foreignOrgId, courseId, true), false);
    assert.equal(await setCourseCatalogListing(db, organizationId, courseId, true), true);
    assert.deepEqual((await listCourseCatalog(db, identity)).map((course) => [course.id, course.accessible]), [[courseId, false]]);
    assert.equal(await learner.get(identity, courseId), null);
    assert.deepEqual(await listCourseCatalog(db, foreignIdentity), []);
    assert.equal(await enrollInCatalogCourse(db, foreignIdentity, courseId), false);
    await assert.rejects(db.courseEnrollment.create({ data: { ...enrollment, membershipId: foreignMember.id } }));

    assert.deepEqual(await Promise.all([
      enrollInCatalogCourse(db, identity, courseId),
      enrollInCatalogCourse(db, identity, courseId),
    ]), [true, true]);
    assert.equal(await db.courseEnrollment.count({ where: enrollment }), 1);
    assert.deepEqual((await listCourseCatalog(db, identity)).map((course) => [course.id, course.accessible]), [[courseId, true]]);
    assert.equal((await learner.get(identity, courseId))?.id, courseId);

    await db.courseMemberAssignment.create({ data: enrollment });
    const filters = { course: "", team: "", status: "", page: 1 } as const;
    assert.equal((await readCourseReport(db, organizationId, courseId, filters))?.assigned, 1);
    await db.courseMemberAssignment.delete({ where: { courseId_membershipId: { courseId, membershipId: member.id } } });
    assert.equal((await readCourseReport(db, organizationId, courseId, filters))?.assigned, 1);
    assert.equal(await setCourseCatalogListing(db, organizationId, courseId, false), true);
    assert.deepEqual(await listCourseCatalog(db, identity), []);
    assert.equal(await enrollInCatalogCourse(db, identity, courseId), true);
    assert.equal((await learner.list(identity))[0]?.id, courseId);

    await db.organizationMembership.update({ where: { id: member.id }, data: { active: false } });
    assert.equal(await enrollInCatalogCourse(db, identity, courseId), false);
    assert.equal(await learner.get(identity, courseId), null);
    assert.equal((await readCourseReport(db, organizationId, courseId, filters))?.assigned, 0);
  } finally {
    try {
      if (initialized) {
        await db.organization.deleteMany({ where: { id: { in: [organizationId, foreignOrgId] } } });
        await db.user.deleteMany({ where: { id: { in: [userId, foreignUserId] } } });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
