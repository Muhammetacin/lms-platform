import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";
const lessonTypes = ["TEXT", "VIDEO", "PDF", "IMAGE", "LINK", "QUIZ"] as const;

const errorText = (error: unknown) => error instanceof Error
  ? `${error.message} ${JSON.stringify(error)}`
  : String(error);

const assertSqlFailure = async (
  operation: Promise<unknown>,
  sqlState: string,
  constraintOrColumn?: string,
) => {
  const error = await operation.then(() => null, (caught: unknown) => caught);
  assert.ok(error, `PostgreSQL must reject this write with SQLSTATE ${sqlState}`);
  const diagnostic = errorText(error);
  assert.ok(diagnostic.includes(sqlState), `expected SQLSTATE ${sqlState}, got: ${diagnostic}`);
  if (constraintOrColumn) {
    assert.ok(diagnostic.includes(constraintOrColumn),
      `expected ${constraintOrColumn} in PostgreSQL error, got: ${diagnostic}`);
  }
  return error;
};

test("PostgreSQL enforces Lesson tenant ownership, enum, ordering, candidate key, and cascades", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for Lesson model tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const cascadeOrg = crypto.randomUUID();
  const courseA = crypto.randomUUID();
  const courseB = crypto.randomUUID();
  const courseCascade = crypto.randomUUID();
  const moduleA = crypto.randomUUID();
  const moduleA2 = crypto.randomUUID();
  const moduleB = crypto.randomUUID();
  const cascadeModule = crypto.randomUUID();
  let probeTable = "";

  const insertRawLesson = (
    id: string,
    organizationId: string,
    moduleId: string,
    title: string,
    type: string,
    position: number,
  ) => db.$executeRawUnsafe(
    `INSERT INTO "Lesson" ("id", "organizationId", "moduleId", "title", "type", "position", "updatedAt")
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::"LessonType", $6, CURRENT_TIMESTAMP)`,
    id,
    organizationId,
    moduleId,
    title,
    type,
    position,
  );

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Lesson Tenant A", slug: `${orgA}-lesson-test` },
      { id: orgB, name: "Lesson Tenant B", slug: `${orgB}-lesson-test` },
      { id: cascadeOrg, name: "Lesson Cascade Tenant", slug: `${cascadeOrg}-lesson-test` },
    ] });
    await db.course.createMany({ data: [
      { id: courseA, organizationId: orgA, title: "Lesson Course A" },
      { id: courseB, organizationId: orgB, title: "Lesson Course B" },
      { id: courseCascade, organizationId: cascadeOrg, title: "Lesson Cascade Course" },
    ] });
    await db.courseModule.createMany({ data: [
      { id: moduleA, organizationId: orgA, courseId: courseA, title: "Module A", position: 1 },
      { id: moduleA2, organizationId: orgA, courseId: courseA, title: "Module A2", position: 2 },
      { id: moduleB, organizationId: orgB, courseId: courseB, title: "Module B", position: 1 },
      { id: cascadeModule, organizationId: cascadeOrg, courseId: courseCascade, title: "Cascade module", position: 1 },
    ] });

    const enumLessons = [];
    for (const [index, type] of lessonTypes.entries()) {
      enumLessons.push(await db.lesson.create({
        data: {
          organizationId: orgA,
          moduleId: moduleA,
          title: "Introduction",
          type,
          position: index + 1,
        },
      }));
    }
    const first = enumLessons[0]!;
    assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "Prisma generates a UUID for Lesson.id");
    assert.equal(first.organizationId, orgA);
    assert.equal(first.moduleId, moduleA);
    assert.equal(first.title, "Introduction");
    assert.equal(first.type, "TEXT");
    assert.equal(first.position, 1);
    assert.ok(first.createdAt instanceof Date);
    assert.ok(first.updatedAt instanceof Date);
    assert.ok(first.updatedAt.getTime() >= first.createdAt.getTime());
    assert.deepEqual(enumLessons.map(({ type }) => type), lessonTypes,
      "every LessonType value must be accepted by PostgreSQL");
    assert.equal(await db.lesson.count({ where: { moduleId: moduleA, title: "Introduction" } }), lessonTypes.length,
      "duplicate Lesson titles remain allowed inside a Module");

    const relation = await db.lesson.findUnique({
      where: { id: first.id },
      select: {
        organization: { select: { id: true } },
        module: { select: { id: true, organizationId: true } },
      },
    });
    assert.deepEqual(relation, {
      organization: { id: orgA },
      module: { id: moduleA, organizationId: orgA },
    });

    const samePositionInModuleA2 = await db.lesson.create({
      data: {
        organizationId: orgA,
        moduleId: moduleA2,
        title: "Introduction",
        type: "TEXT",
        position: 1,
      },
    });
    const samePositionInTenantB = await db.lesson.create({
      data: {
        organizationId: orgB,
        moduleId: moduleB,
        title: "Introduction",
        type: "TEXT",
        position: 1,
      },
    });
    assert.equal(samePositionInModuleA2.position, 1,
      "the same position is valid in another Module");
    assert.equal(samePositionInTenantB.position, 1,
      "the same position is valid in another organization and Module");

    await assertSqlFailure(
      insertRawLesson(crypto.randomUUID(), orgA, moduleA, "Duplicate position", "TEXT", 1),
      "23505",
      "Lesson_moduleId_position_key",
    );
    await assertSqlFailure(
      insertRawLesson(crypto.randomUUID(), orgA, moduleA, "Zero position", "TEXT", 0),
      "23514",
      "Lesson_position_check",
    );
    await assertSqlFailure(
      insertRawLesson(crypto.randomUUID(), orgA, moduleA, "Negative position", "TEXT", -1),
      "23514",
      "Lesson_position_check",
    );

    await assertSqlFailure(db.$executeRawUnsafe(
      `INSERT INTO "Lesson" ("id", "organizationId", "moduleId", "title", "position", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Missing type', 20, CURRENT_TIMESTAMP)`,
      crypto.randomUUID(), orgA, moduleA,
    ), "23502", "type");
    await assertSqlFailure(db.$executeRawUnsafe(
      `INSERT INTO "Lesson" ("id", "organizationId", "moduleId", "title", "type", "updatedAt")
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'Missing position', 'TEXT'::"LessonType", CURRENT_TIMESTAMP)`,
      crypto.randomUUID(), orgA, moduleA,
    ), "23502", "position");

    const wrongTenantId = crypto.randomUUID();
    await assertSqlFailure(
      insertRawLesson(wrongTenantId, orgB, moduleA, "Cross tenant", "TEXT", 50),
      "23503",
      "Lesson_moduleId_organizationId_fkey",
    );
    assert.equal(await db.lesson.findUnique({ where: { id: wrongTenantId } }), null,
      "a direct PostgreSQL cross-tenant insert must leave no Lesson row");
    await assertSqlFailure(
      insertRawLesson(crypto.randomUUID(), orgA, crypto.randomUUID(), "Missing Module", "TEXT", 51),
      "23503",
      "Lesson_moduleId_organizationId_fkey",
    );

    await db.$transaction(async (tx) => {
      probeTable = `LessonTenantProbe_${crypto.randomUUID().replaceAll("-", "")}`;
      const probeFk = `${probeTable}_lesson_fk`;
      await tx.$executeRawUnsafe(`CREATE TABLE "${probeTable}" (
        "lessonId" UUID NOT NULL,
        "organizationId" UUID NOT NULL,
        CONSTRAINT "${probeFk}" FOREIGN KEY ("lessonId", "organizationId")
          REFERENCES "Lesson" ("id", "organizationId") ON DELETE CASCADE
      )`);
      await tx.$executeRawUnsafe(
        `INSERT INTO "${probeTable}" ("lessonId", "organizationId") VALUES ($1::uuid, $2::uuid)`,
        first.id,
        orgA,
      );
      await tx.$executeRawUnsafe('SAVEPOINT "lesson_wrong_tenant_probe"');
      const mismatch = await tx.$executeRawUnsafe(
        `INSERT INTO "${probeTable}" ("lessonId", "organizationId") VALUES ($1::uuid, $2::uuid)`,
        first.id,
        orgB,
      ).then(() => null, (error: unknown) => error);
      assert.ok(mismatch, "the Lesson (id, organizationId) candidate key must reject a mismatched tenant");
      assert.ok(errorText(mismatch).includes("23503"),
        `expected candidate-key FK violation, got: ${errorText(mismatch)}`);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT "lesson_wrong_tenant_probe"');
      await tx.$executeRawUnsafe(`DROP TABLE "${probeTable}"`);
    });
    probeTable = "";

    const byOrganizationA = await db.lesson.findMany({
      where: { organizationId: orgA },
      select: { id: true, organizationId: true },
    });
    const byOrganizationB = await db.lesson.findMany({
      where: { organizationId: orgB },
      select: { id: true, organizationId: true },
    });
    assert.equal(byOrganizationA.length, lessonTypes.length + 1);
    assert.ok(byOrganizationA.every(({ organizationId }) => organizationId === orgA));
    assert.deepEqual(byOrganizationB, [{ id: samePositionInTenantB.id, organizationId: orgB }]);

    const cascadeLesson = await db.lesson.create({
      data: {
        organizationId: orgA,
        moduleId: moduleA2,
        title: "Module cascade",
        type: "PDF",
        position: 2,
      },
    });
    await db.courseModule.delete({ where: { id: moduleA2 } });
    assert.equal(await db.lesson.findUnique({ where: { id: samePositionInModuleA2.id } }), null,
      "deleting a Module cascades to its Lessons");
    assert.equal(await db.lesson.findUnique({ where: { id: cascadeLesson.id } }), null,
      "every Lesson owned by a deleted Module is removed");

    const courseCascadeModule = await db.courseModule.create({
      data: { organizationId: orgA, courseId: (await db.course.create({
        data: { organizationId: orgA, title: "Course cascade" },
      })).id, title: "Course cascade module", position: 1 },
    });
    const courseCascadeLesson = await db.lesson.create({
      data: {
        organizationId: orgA,
        moduleId: courseCascadeModule.id,
        title: "Course cascade lesson",
        type: "IMAGE",
        position: 1,
      },
    });
    await db.course.delete({ where: { id: courseCascadeModule.courseId } });
    assert.equal(await db.courseModule.findUnique({ where: { id: courseCascadeModule.id } }), null,
      "deleting a Course cascades to its Modules");
    assert.equal(await db.lesson.findUnique({ where: { id: courseCascadeLesson.id } }), null,
      "deleting a Course cascades through Modules to Lessons");

    const organizationCascadeLesson = await db.lesson.create({
      data: {
        organizationId: cascadeOrg,
        moduleId: cascadeModule,
        title: "Organization cascade",
        type: "LINK",
        position: 1,
      },
    });
    await db.organization.delete({ where: { id: cascadeOrg } });
    assert.equal(await db.lesson.findUnique({ where: { id: organizationCascadeLesson.id } }), null,
      "deleting an Organization cascades to its Lessons");
    assert.equal(await db.courseModule.findUnique({ where: { id: cascadeModule } }), null,
      "Organization deletion still removes existing CourseModule rows");
    assert.equal(await db.course.findUnique({ where: { id: courseCascade } }), null,
      "Organization deletion still removes its Courses");
    assert.ok(await db.courseModule.findUnique({ where: { id: moduleA } }),
      "the LMS-020 CourseModule model remains intact after the Lesson migration");

    const typeColumn = await db.$queryRaw<Array<{ isNullable: string; columnDefault: string | null }>>`
      SELECT is_nullable AS "isNullable", column_default AS "columnDefault"
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'Lesson' AND column_name = 'type'
    `;
    assert.deepEqual(typeColumn, [{ isNullable: "NO", columnDefault: null }],
      "Lesson.type is required and has no database default");
  } finally {
    if (probeTable) {
      await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${probeTable}"`).catch(() => {});
    }
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB, cascadeOrg] } } }).catch(() => {});
    await db.$disconnect();
  }
});
