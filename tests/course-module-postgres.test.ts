import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { requireOrganizationPermission, type AuthorizationStore } from "../src/lib/authorization-core.ts";
import { isTrustedAuthRequest, readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  createCourseModuleHandlers,
  type CourseModule,
  type CourseModuleStore,
} from "../src/lib/course-module-core.ts";
import { createPrismaCourseModuleStore } from "../src/lib/course-module-prisma-store.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL Course Modules enforce authorization, tenant integrity, ordering, and DRAFT-only writes", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL Course Module tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const store = createPrismaCourseModuleStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
  };
  const courseIds = {
    main: crypto.randomUUID(),
    other: crypto.randomUUID(),
    empty: crypto.randomUUID(),
    published: crypto.randomUUID(),
    foreign: crypto.randomUUID(),
    concurrentCreate: crypto.randomUUID(),
    concurrentMove: crypto.randomUUID(),
    concurrentMoveCreate: crypto.randomUUID(),
    rollback: crypto.randomUUID(),
    publishRace: crypto.randomUUID(),
  };
  const priorAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://lms.example.test";

  const membershipStore: TenantMembershipStore & AuthorizationStore = {
    async findOrganizationRole(userId, organizationId) {
      const membership = await db.organizationMembership.findFirst({
        where: { userId, organizationId, active: true },
        select: { role: true },
      });
      return membership?.role ?? null;
    },
    async findDefaultOrganizationMembership(userId) {
      return db.organizationMembership.findFirst({
        where: { userId, active: true },
        orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
        select: { organizationId: true, role: true },
      });
    },
  };
  const asUser = (record: { id: string; email: string }): AuthenticatedUser => ({
    id: record.id,
    email: record.email,
    name: null,
  });
  const makeHandlers = (identity: AuthenticatedUser | null, moduleStore: CourseModuleStore = store) =>
    createCourseModuleHandlers({
      async requireTenantContext() {
        return resolveTenantContext(identity, undefined, membershipStore);
      },
      async requirePermission(organizationId, permission) {
        return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
      },
      store: moduleStore,
      isTrustedRequest: isTrustedAuthRequest,
      readBody: (request) => readJsonBody(request, 20 * 1024),
      logError: () => {},
    });
  const ownerA = makeHandlers(asUser(users.ownerA));
  const adminA = makeHandlers(asUser(users.adminA));
  const memberA = makeHandlers(asUser(users.memberA));
  const ownerB = makeHandlers(asUser(users.ownerB));
  const anonymous = makeHandlers(null);
  const moduleUrl = (courseId: string, moduleId?: string) =>
    `https://lms.example.test/api/organizations/courses/${courseId}/modules${moduleId ? `/${moduleId}` : ""}`;
  const request = (method: string, value?: unknown, url = moduleUrl(courseIds.main)) => new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "https://lms.example.test" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const json = async <T>(response: Response) => await response.json() as T;
  const assertNoStore = (response: Response) => assert.equal(response.headers.get("cache-control"), "no-store");
  const createCourse = async (id: string, organizationId = orgA, status: "DRAFT" | "PUBLISHED" = "DRAFT") =>
    db.course.create({ data: { id, organizationId, title: `Course ${id}`, status } });
  const createViaApi = async (
    handlers: ReturnType<typeof makeHandlers>,
    courseId: string,
    title: string,
    description?: string | null,
  ): Promise<CourseModule> => {
    const response = await handlers.POST(request("POST", { title, ...(description === undefined ? {} : { description }) }, moduleUrl(courseId)) , courseId);
    assert.equal(response.status, 201, await response.clone().text());
    assertNoStore(response);
    return (await json<{ module: CourseModule }>(response)).module;
  };
  const assertContiguous = async (courseId: string, organizationId = orgA) => {
    const modules = await db.courseModule.findMany({
      where: { organizationId, courseId },
      orderBy: { position: "asc" },
      select: { id: true, position: true, createdAt: true, updatedAt: true },
    });
    assert.deepEqual(modules.map(({ position }) => position), modules.map((_module, index) => index + 1));
    assert.equal(new Set(modules.map(({ position }) => position)).size, modules.length);
    return modules;
  };
  let rollbackFunction = "";
  let rollbackTrigger = "";

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Course Module Tenant A", slug: `${orgA}-course-module-test` },
      { id: orgB, name: "Course Module Tenant B", slug: `${orgB}-course-module-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
    ] });
    await Promise.all([
      createCourse(courseIds.main), createCourse(courseIds.other), createCourse(courseIds.empty),
      createCourse(courseIds.published, orgA, "PUBLISHED"), createCourse(courseIds.foreign, orgB),
      createCourse(courseIds.concurrentCreate), createCourse(courseIds.concurrentMove),
      createCourse(courseIds.concurrentMoveCreate), createCourse(courseIds.rollback), createCourse(courseIds.publishRace),
    ]);

    const emptyList = await ownerA.GET_LIST(courseIds.main);
    assert.equal(emptyList.status, 200);
    assertNoStore(emptyList);
    assert.deepEqual((await json<{ modules: CourseModule[] }>(emptyList)).modules, []);
    assert.equal((await adminA.GET_LIST(courseIds.main)).status, 200);
    assert.equal((await memberA.GET_LIST(courseIds.main)).status, 403);
    assert.equal((await anonymous.GET_LIST(courseIds.main)).status, 401);
    for (const handlers of [memberA, anonymous]) {
      const deniedStatus = handlers === memberA ? 403 : 401;
      assert.equal((await handlers.GET_ONE(courseIds.main, crypto.randomUUID())).status, deniedStatus);
      assert.equal((await handlers.POST(request("POST", { title: "Denied" }, moduleUrl(courseIds.main)), courseIds.main)).status, deniedStatus);
    }

    const first = await createViaApi(ownerA, courseIds.main, "Introduction", "  First notes  ");
    const second = await createViaApi(adminA, courseIds.main, "Introduction");
    assert.equal(first.position, 1);
    assert.equal(first.description, "First notes");
    assert.equal(second.position, 2);
    assert.equal(second.title, first.title, "duplicate titles remain allowed");
    assert.equal("organizationId" in first, false);
    assert.equal("courseId" in first, false);
    assert.deepEqual((await assertContiguous(courseIds.main)).map(({ id }) => id), [first.id, second.id]);

    for (const body of [
      { title: "x" }, { title: "  " }, { title: `a${"😀".repeat(160)}` },
      { title: "A\u0000B" }, { title: "A\ud800B" }, { title: "Valid", description: "bad\u007ftext" },
      { title: "Valid", description: "d".repeat(4001) }, { title: "Valid", position: 1 },
      { title: "Valid", organizationId: orgB }, { title: "Valid", tenantId: orgB },
      { title: "Valid", courseId: courseIds.foreign }, { title: "Valid", moduleId: first.id },
      { title: "Valid", id: crypto.randomUUID() }, { title: "Valid", createdAt: new Date().toISOString() },
      { title: "Valid", updatedAt: new Date().toISOString() }, { title: "Valid", status: "PUBLISHED" },
    ]) {
      assert.equal((await ownerA.POST(request("POST", body, moduleUrl(courseIds.main)), courseIds.main)).status, 400);
    }
    const forgedPatch = await ownerA.PATCH(request("PATCH", { title: "Stolen", organizationId: orgB }, moduleUrl(courseIds.main, first.id)), courseIds.main, first.id);
    assert.equal(forgedPatch.status, 400);
    assert.equal((await ownerA.PATCH(request("PATCH", { position: 2 }, moduleUrl(courseIds.main, first.id)), courseIds.main, first.id)).status, 400);
    assert.equal((await ownerA.PATCH(request("PATCH", { courseId: courseIds.foreign }, moduleUrl(courseIds.main, first.id)), courseIds.main, first.id)).status, 400);
    assert.equal((await ownerA.MOVE(request("POST", { position: 2, tenantId: orgB }, moduleUrl(courseIds.main, first.id)), courseIds.main, first.id)).status, 400);
    assert.equal((await ownerA.MOVE(request("POST", { position: 0 }, moduleUrl(courseIds.main, first.id)), courseIds.main, first.id)).status, 400);
    assert.equal((await ownerA.MOVE(request("POST", { position: 1.5 }, moduleUrl(courseIds.main, first.id)), courseIds.main, first.id)).status, 400);

    const forgedListRequest = new Request(`${moduleUrl(courseIds.main)}?organizationId=${orgB}&tenantId=${orgB}`, {
      headers: { "x-organization-id": orgB, "x-tenant-id": orgB },
    });
    const forgedList = await ownerA.GET_LIST(courseIds.main, forgedListRequest);
    assert.equal(forgedList.status, 200);
    assert.deepEqual(
      (await json<{ modules: CourseModule[] }>(forgedList)).modules.map(({ id }) => id),
      [first.id, second.id],
      "forged tenant query/header values do not replace the trusted organization",
    );
    assert.equal((await ownerA.GET_LIST(courseIds.foreign)).status, 404);
    assert.deepEqual(await (await ownerA.GET_LIST("malformed-course-id")).json(), { error: "course_not_found" });
    const foreignCourseResponse = await ownerA.GET_LIST(courseIds.foreign);
    assert.deepEqual(await foreignCourseResponse.json(), { error: "course_not_found" });
    const foreignModule = await createViaApi(ownerB, courseIds.foreign, "Tenant B module");
    const foreignTenantModuleRead = await ownerA.GET_ONE(courseIds.main, foreignModule.id);
    assert.deepEqual(await foreignTenantModuleRead.json(), { error: "module_not_found" });
    assert.deepEqual(await (await ownerA.GET_ONE(courseIds.other, first.id)).json(), { error: "module_not_found" });
    assert.deepEqual(await (await ownerA.GET_ONE(courseIds.main, "malformed-module-id")).json(), { error: "module_not_found" });
    assert.deepEqual(await (await ownerA.GET_ONE(courseIds.main, crypto.randomUUID())).json(), { error: "module_not_found" });

    const detailResponse = await ownerA.GET_ONE(courseIds.main, first.id);
    assert.equal(detailResponse.status, 200);
    assertNoStore(detailResponse);
    const detail = (await json<{ module: CourseModule }>(detailResponse)).module;
    assert.equal(detail.id, first.id);
    assert.equal("organizationId" in detail, false);
    assert.equal("courseId" in detail, false);
    const updatedResponse = await adminA.PATCH(request("PATCH", {
      title: "  Updated introduction  ", description: "  Revised notes  ",
    }, moduleUrl(courseIds.main, first.id)), courseIds.main, first.id);
    assert.equal(updatedResponse.status, 200);
    assertNoStore(updatedResponse);
    const updated = (await json<{ module: CourseModule }>(updatedResponse)).module;
    assert.equal(updated.title, "Updated introduction");
    assert.equal(updated.description, "Revised notes");
    const cleared = await ownerA.PATCH(request("PATCH", { description: "   " }, moduleUrl(courseIds.main, first.id)), courseIds.main, first.id);
    assert.equal((await json<{ module: CourseModule }>(cleared)).module.description, null);

    const samePosition = await ownerA.MOVE(request("POST", { position: 2 }, moduleUrl(courseIds.main, second.id)), courseIds.main, second.id);
    assert.equal(samePosition.status, 200);
    assert.deepEqual((await assertContiguous(courseIds.main)).map(({ id }) => id), [first.id, second.id]);
    await assert.rejects(db.courseModule.create({
      data: { organizationId: orgA, courseId: courseIds.main, title: "Invalid duplicate", position: 1 },
    }));
    await assert.rejects(db.courseModule.create({
      data: { organizationId: orgA, courseId: courseIds.main, title: "Invalid position", position: 0 },
    }));
    const forgedTenantId = crypto.randomUUID();
    await assert.rejects(db.courseModule.create({
      data: { id: forgedTenantId, organizationId: orgB, courseId: courseIds.empty, title: "Cross tenant", position: 1 },
    }));
    assert.equal(await db.courseModule.findUnique({ where: { id: forgedTenantId } }), null);

    const publishedModule = await db.courseModule.create({
      data: { organizationId: orgA, courseId: courseIds.published, title: "Published structure", position: 1 },
    });
    const publishedList = await ownerA.GET_LIST(courseIds.published);
    assert.equal(publishedList.status, 200);
    assert.equal((await json<{ modules: CourseModule[] }>(publishedList)).modules.length, 1);
    assert.equal((await ownerA.GET_ONE(courseIds.published, publishedModule.id)).status, 200);
    for (const response of [
      await ownerA.POST(request("POST", { title: "Blocked" }, moduleUrl(courseIds.published)), courseIds.published),
      await ownerA.PATCH(request("PATCH", { title: "Blocked" }, moduleUrl(courseIds.published, publishedModule.id)), courseIds.published, publishedModule.id),
      await ownerA.MOVE(request("POST", { position: 1 }, moduleUrl(courseIds.published, publishedModule.id)), courseIds.published, publishedModule.id),
      await ownerA.DELETE(request("DELETE", undefined, moduleUrl(courseIds.published, publishedModule.id)), courseIds.published, publishedModule.id),
    ]) {
      assert.equal(response.status, 409);
      assertNoStore(response);
      assert.deepEqual(await response.json(), { error: "published_course_structure_locked" });
    }
    for (const response of [
      await memberA.GET_LIST(courseIds.main),
      await memberA.GET_ONE(courseIds.main, first.id),
      await memberA.POST(request("POST", { title: "Denied" }), courseIds.main),
      await memberA.PATCH(request("PATCH", { title: "Denied" }), courseIds.main, first.id),
      await memberA.MOVE(request("POST", { position: 1 }), courseIds.main, first.id),
      await memberA.DELETE(request("DELETE"), courseIds.main, first.id),
      await anonymous.GET_LIST(courseIds.main),
      await anonymous.GET_ONE(courseIds.main, first.id),
      await anonymous.POST(request("POST", { title: "Denied" }), courseIds.main),
      await anonymous.PATCH(request("PATCH", { title: "Denied" }), courseIds.main, first.id),
      await anonymous.MOVE(request("POST", { position: 1 }), courseIds.main, first.id),
      await anonymous.DELETE(request("DELETE"), courseIds.main, first.id),
    ]) {
      assert.ok([401, 403].includes(response.status));
      assertNoStore(response);
    }
    const untrusted = makeHandlers(asUser(users.ownerA), store);
    const noOriginRequest = new Request(moduleUrl(courseIds.main), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Blocked" }),
    });
    assert.equal((await untrusted.POST(noOriginRequest, courseIds.main)).status, 403);

    const third = await createViaApi(ownerA, courseIds.main, "Practice");
    const fourth = await createViaApi(ownerA, courseIds.main, "Review");
    const beforeMove = await db.courseModule.findMany({
      where: { courseId: courseIds.main }, select: { id: true, createdAt: true, updatedAt: true },
    });
    assert.equal((await ownerA.MOVE(request("POST", { position: 2 }), courseIds.main, fourth.id)).status, 200);
    assert.deepEqual((await assertContiguous(courseIds.main)).map(({ id }) => id), [first.id, fourth.id, second.id, third.id]);
    assert.equal((await ownerA.MOVE(request("POST", { position: 4 }), courseIds.main, first.id)).status, 200);
    assert.deepEqual((await assertContiguous(courseIds.main)).map(({ id }) => id), [fourth.id, second.id, third.id, first.id]);
    const noOp = await ownerA.MOVE(request("POST", { position: 2 }), courseIds.main, second.id);
    assert.equal(noOp.status, 200);
    const invalidRange = await ownerA.MOVE(request("POST", { position: 5 }), courseIds.main, second.id);
    assert.equal(invalidRange.status, 400);
    assert.deepEqual((await assertContiguous(courseIds.main)).map(({ id }) => id), [fourth.id, second.id, third.id, first.id]);
    const afterMove = await db.courseModule.findMany({
      where: { courseId: courseIds.main }, select: { id: true, createdAt: true, updatedAt: true },
    });
    for (const before of beforeMove) {
      const after = afterMove.find(({ id }) => id === before.id);
      assert.ok(after);
      assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "position-only changes preserve timestamps");
    }

    const deleteMiddle = await ownerA.DELETE(request("DELETE"), courseIds.main, third.id);
    assert.equal(deleteMiddle.status, 200);
    assert.deepEqual((await assertContiguous(courseIds.main)).map(({ id }) => id), [fourth.id, second.id, first.id]);
    assert.equal((await ownerA.DELETE(request("DELETE"), courseIds.main, fourth.id)).status, 200);
    assert.deepEqual((await assertContiguous(courseIds.main)).map(({ id }) => id), [second.id, first.id]);
    assert.equal((await ownerA.DELETE(request("DELETE"), courseIds.main, first.id)).status, 200);
    assert.deepEqual((await assertContiguous(courseIds.main)).map(({ id }) => id), [second.id]);
    assert.equal((await ownerA.DELETE(request("DELETE"), courseIds.main, second.id)).status, 200);
    assert.deepEqual(await assertContiguous(courseIds.main), []);

    const concurrentCreates = await Promise.all([
      ownerA.POST(request("POST", { title: "Concurrent one" }, moduleUrl(courseIds.concurrentCreate)), courseIds.concurrentCreate),
      ownerA.POST(request("POST", { title: "Concurrent two" }, moduleUrl(courseIds.concurrentCreate)), courseIds.concurrentCreate),
    ]);
    assert.ok(concurrentCreates.every(({ status }) => status === 201));
    const concurrentCreatedRows = await assertContiguous(courseIds.concurrentCreate);
    assert.equal(concurrentCreatedRows.length, 2);

    const moveFixtures: CourseModule[] = [];
    for (let index = 1; index <= 5; index += 1) {
      moveFixtures.push(await createViaApi(ownerA, courseIds.concurrentMove, `Move ${index}`));
    }
    const concurrentMoves = await Promise.all([
      ownerA.MOVE(request("POST", { position: 5 }, moduleUrl(courseIds.concurrentMove, moveFixtures[0]!.id)), courseIds.concurrentMove, moveFixtures[0]!.id),
      ownerA.MOVE(request("POST", { position: 1 }, moduleUrl(courseIds.concurrentMove, moveFixtures[4]!.id)), courseIds.concurrentMove, moveFixtures[4]!.id),
    ]);
    assert.ok(concurrentMoves.every(({ status }) => status === 200));
    const afterConcurrentMoves = await assertContiguous(courseIds.concurrentMove);
    assert.equal(afterConcurrentMoves.length, 5);
    assert.deepEqual(new Set(afterConcurrentMoves.map(({ id }) => id)), new Set(moveFixtures.map(({ id }) => id)));

    const mixedMove = await createViaApi(ownerA, courseIds.concurrentMoveCreate, "Original one");
    await createViaApi(ownerA, courseIds.concurrentMoveCreate, "Original two");
    const mixedMoveCreate = await Promise.all([
      ownerA.MOVE(request("POST", { position: 2 }, moduleUrl(courseIds.concurrentMoveCreate, mixedMove.id)), courseIds.concurrentMoveCreate, mixedMove.id),
      ownerA.POST(request("POST", { title: "Racing create" }, moduleUrl(courseIds.concurrentMoveCreate)), courseIds.concurrentMoveCreate),
    ]);
    assert.deepEqual(mixedMoveCreate.map(({ status }) => status).sort(), [200, 201]);
    assert.equal((await assertContiguous(courseIds.concurrentMoveCreate)).length, 3);

    const rollbackModules = [
      await createViaApi(ownerA, courseIds.rollback, "Rollback 1"),
      await createViaApi(ownerA, courseIds.rollback, "Rollback 2"),
      await createViaApi(ownerA, courseIds.rollback, "Rollback 3"),
    ];
    const rollbackBefore = await assertContiguous(courseIds.rollback);
    const suffix = crypto.randomUUID().replaceAll("-", "");
    rollbackFunction = `lms020_fail_move_${suffix}`;
    rollbackTrigger = `lms020_fail_move_trigger_${suffix}`;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${rollbackFunction}"() RETURNS trigger AS $fn$
      BEGIN
        IF NEW."courseId" = '${courseIds.rollback}'::uuid AND NEW."position" = 2 THEN
          RAISE EXCEPTION 'forced LMS-020 reorder failure';
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${rollbackTrigger}" BEFORE UPDATE OF "position" ON "CourseModule"
      FOR EACH ROW EXECUTE FUNCTION "${rollbackFunction}"()
    `);
    const failedMove = await ownerA.MOVE(
      request("POST", { position: 2 }, moduleUrl(courseIds.rollback, rollbackModules[2]!.id)),
      courseIds.rollback,
      rollbackModules[2]!.id,
    );
    assert.equal(failedMove.status, 503);
    assertNoStore(failedMove);
    assert.deepEqual(await failedMove.json(), { error: "course_module_management_unavailable" });
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${rollbackTrigger}" ON "CourseModule"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${rollbackFunction}"()`);
    rollbackFunction = "";
    rollbackTrigger = "";
    assert.deepEqual(await assertContiguous(courseIds.rollback), rollbackBefore);
    assert.deepEqual((await assertContiguous(courseIds.rollback)).map(({ id }) => id), rollbackModules.map(({ id }) => id));

    const raceModule = await createViaApi(ownerA, courseIds.publishRace, "Race module");
    let waitingMutation: Promise<Response> | undefined;
    await db.$transaction(async (transaction) => {
      await transaction.course.update({ where: { id: courseIds.publishRace }, data: { status: "PUBLISHED" } });
      waitingMutation = ownerA.POST(
        request("POST", { title: "Must wait for publication" }, moduleUrl(courseIds.publishRace)),
        courseIds.publishRace,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.ok(waitingMutation);
    const publicationRaceResult = await waitingMutation;
    assert.equal(publicationRaceResult.status, 409);
    assert.equal(await db.courseModule.count({ where: { courseId: courseIds.publishRace } }), 1);
    assert.ok(await db.courseModule.findUnique({ where: { id: raceModule.id } }));

    const cascadeCourse = await createCourse(crypto.randomUUID());
    const cascadeModule = await db.courseModule.create({
      data: { organizationId: orgA, courseId: cascadeCourse.id, title: "Organization cascade", position: 1 },
    });
    const orgCascadeCourse = await db.course.create({
      data: { organizationId: orgA, title: "Organization deleted module" },
    });
    const orgCascadeModule = await db.courseModule.create({
      data: { organizationId: orgA, courseId: orgCascadeCourse.id, title: "Organization-owned child", position: 1 },
    });
    await db.organization.delete({ where: { id: orgA } });
    assert.equal(await db.courseModule.findUnique({ where: { id: cascadeModule.id } }), null);
    assert.equal(await db.courseModule.findUnique({ where: { id: orgCascadeModule.id } }), null);
    assert.equal(await db.course.findUnique({ where: { id: orgCascadeCourse.id } }), null);
    assert.ok(await db.courseModule.findUnique({ where: { id: foreignModule.id } }));
    void cascadeCourse;
  } finally {
    if (rollbackTrigger) {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${rollbackTrigger}" ON "CourseModule"`).catch(() => {});
    }
    if (rollbackFunction) {
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${rollbackFunction}"()`).catch(() => {});
    }
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } }).catch(() => {});
    if (priorAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = priorAppUrl;
    await db.$disconnect();
  }
});
