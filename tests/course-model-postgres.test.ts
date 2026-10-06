import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL enforces Course ownership, lifecycle defaults, tenant keys, and cascades", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for Course model tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const cascadeOrg = crypto.randomUUID();
  let probeTable: string | null = null;
  const hasPrismaCode = (error: unknown, code: string) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code;

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Course Tenant A", slug: `${orgA}-course-model-test` },
      { id: orgB, name: "Course Tenant B", slug: `${orgB}-course-model-test` },
      { id: cascadeOrg, name: "Course Cascade Tenant", slug: `${cascadeOrg}-course-model-test` },
    ] });

    const draft = await db.course.create({ data: {
      organizationId: orgA,
      title: "Safety Training",
    } });
    const published = await db.course.create({ data: {
      organizationId: orgA,
      title: "Published Foundation",
      description: null,
      status: "PUBLISHED",
    } });
    const duplicateTitle = await db.course.create({ data: {
      organizationId: orgA,
      title: "Safety Training",
      description: "A second course may use the same title.",
    } });
    const sameTitleInB = await db.course.create({ data: {
      organizationId: orgB,
      title: "Safety Training",
    } });

    assert.match(draft.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(draft.organizationId, orgA);
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.description, null);
    assert.ok(draft.createdAt instanceof Date);
    assert.ok(draft.updatedAt instanceof Date);
    assert.ok(draft.updatedAt.getTime() >= draft.createdAt.getTime());
    assert.equal(published.status, "PUBLISHED");
    assert.equal(published.description, null);
    assert.equal(duplicateTitle.title, draft.title);
    assert.equal(sameTitleInB.title, draft.title);

    const coursesA = await db.course.findMany({
      where: { organizationId: orgA },
      select: { id: true, organizationId: true },
    });
    const coursesB = await db.course.findMany({
      where: { organizationId: orgB },
      select: { id: true, organizationId: true },
    });
    assert.deepEqual(coursesA.map(({ id }) => id).sort(), [draft.id, published.id, duplicateTitle.id].sort());
    assert.deepEqual(coursesB, [{ id: sameTitleInB.id, organizationId: orgB }]);
    assert.ok(coursesA.every(({ organizationId }) => organizationId === orgA));

    const invalidOrganization = await db.course.create({ data: {
      organizationId: crypto.randomUUID(),
      title: "Invalid owner",
    } }).then(() => null, (error: unknown) => error);
    assert.ok(hasPrismaCode(invalidOrganization, "P2003"),
      "PostgreSQL must reject Course.organizationId values without an Organization");

    const probeTableName = `CourseTenantProbe_${crypto.randomUUID().replaceAll("-", "")}`;
    probeTable = probeTableName;
    const probeForeignKey = `${probeTableName}_fk`;
    await db.$executeRawUnsafe(`CREATE TABLE "${probeTableName}" (
      "courseId" UUID NOT NULL,
      "organizationId" UUID NOT NULL,
      CONSTRAINT "${probeForeignKey}" FOREIGN KEY ("courseId", "organizationId")
        REFERENCES "Course" ("id", "organizationId") ON DELETE CASCADE
    )`);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "${probeTableName}" ("courseId", "organizationId") VALUES ($1::uuid, $2::uuid)`,
        draft.id,
        orgA,
      );
      await tx.$executeRawUnsafe('SAVEPOINT "course_wrong_tenant_probe"');
      const mismatch = await tx.$executeRawUnsafe(
        `INSERT INTO "${probeTableName}" ("courseId", "organizationId") VALUES ($1::uuid, $2::uuid)`,
        draft.id,
        orgB,
      ).then(() => null, (error: unknown) => error);
      assert.ok(mismatch, "a child reference pairing Course A with Organization B must fail");
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT "course_wrong_tenant_probe"');
    });
    await db.$executeRawUnsafe(`DROP TABLE "${probeTableName}"`);
    probeTable = null;

    const cascadeCourse = await db.course.create({ data: {
      organizationId: cascadeOrg,
      title: "Cascade with organization",
    } });
    await db.organization.delete({ where: { id: cascadeOrg } });
    assert.equal(await db.course.findUnique({ where: { id: cascadeCourse.id } }), null,
      "hard-deleting an Organization must cascade to its Courses");
  } finally {
    if (probeTable) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${probeTable}"`).catch(() => {});
    }
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB, cascadeOrg] } } });
    await db.$disconnect();
  }
});
