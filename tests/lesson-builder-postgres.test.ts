import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { requireOrganizationPermission, type AuthorizationStore } from "../src/lib/authorization-core.ts";
import { isTrustedAuthRequest, readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import { createCourseModuleHandlers } from "../src/lib/course-module-core.ts";
import { createPrismaCourseModuleStore } from "../src/lib/course-module-prisma-store.ts";
import { createLessonHandlers, type LessonDetail } from "../src/lib/lesson-core.ts";
import { createPrismaLessonStore } from "../src/lib/lesson-prisma-store.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL Lesson Builder covers scoped CRUD, content constraints, serialization, and published locking", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL Lesson Builder tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const lessonStore = createPrismaLessonStore(db);
  const moduleStore = createPrismaCourseModuleStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
  };
  const courseIds = {
    main: crypto.randomUUID(), other: crypto.randomUUID(), published: crypto.randomUUID(), foreign: crypto.randomUUID(),
    concurrentCreate: crypto.randomUUID(), concurrentMove: crypto.randomUUID(), concurrentMoveCreate: crypto.randomUUID(),
    concurrentDeleteMove: crypto.randomUUID(), rollback: crypto.randomUUID(), publishRace: crypto.randomUUID(),
    moduleDeleteRace: crypto.randomUUID(),
  };
  const moduleIds = {
    main: crypto.randomUUID(), other: crypto.randomUUID(), foreign: crypto.randomUUID(), ordering: crypto.randomUUID(),
    types: crypto.randomUUID(), concurrentCreate: crypto.randomUUID(), concurrentMove: crypto.randomUUID(),
    concurrentMoveCreate: crypto.randomUUID(), concurrentDeleteMove: crypto.randomUUID(), rollback: crypto.randomUUID(),
    publishRace: crypto.randomUUID(), moduleDeleteRace: crypto.randomUUID(), published: crypto.randomUUID(),
  };
  const priorAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://lms.example.test";

  const membershipStore: TenantMembershipStore & AuthorizationStore = {
    async findOrganizationRole(userId, organizationId) {
      const membership = await db.organizationMembership.findFirst({
        where: { userId, organizationId, active: true }, select: { role: true },
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
  const asUser = (record: { id: string; email: string }): AuthenticatedUser => ({ id: record.id, email: record.email, name: null });
  const makeHandlers = (identity: AuthenticatedUser | null) => createLessonHandlers({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, membershipStore);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    store: lessonStore,
    isTrustedRequest: isTrustedAuthRequest,
    readBody: (request) => readJsonBody(request, 512 * 1024),
    logError: () => {},
  });
  const ownerA = makeHandlers(asUser(users.ownerA));
  const adminA = makeHandlers(asUser(users.adminA));
  const memberA = makeHandlers(asUser(users.memberA));
  const ownerB = makeHandlers(asUser(users.ownerB));
  const anonymous = makeHandlers(null);
  const moduleHandlers = createCourseModuleHandlers({
    async requireTenantContext() { return resolveTenantContext(asUser(users.ownerA), undefined, membershipStore); },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(asUser(users.ownerA), organizationId, permission, membershipStore);
    },
    store: moduleStore,
    isTrustedRequest: isTrustedAuthRequest,
    readBody: (request) => readJsonBody(request, 20 * 1024),
    logError: () => {},
  });
  const lessonsUrl = (courseId: string, moduleId: string, lessonId?: string, suffix = "") =>
    `https://lms.example.test/api/organizations/courses/${courseId}/modules/${moduleId}/lessons${lessonId ? `/${lessonId}` : ""}${suffix}`;
  const moduleUrl = (courseId: string, moduleId: string) =>
    `https://lms.example.test/api/organizations/courses/${courseId}/modules/${moduleId}`;
  const request = (method: string, value?: unknown, url = lessonsUrl(courseIds.main, moduleIds.main)) => new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "https://lms.example.test" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const json = async <T>(response: Response) => await response.json() as T;
  const assertNoStore = (response: Response) => assert.equal(response.headers.get("cache-control"), "no-store");
  const createCourse = (id: string, organizationId = orgA, status: "DRAFT" | "PUBLISHED" = "DRAFT") =>
    db.course.create({ data: { id, organizationId, title: `Course ${id}`, status } });
  const modulePositions = new Map<string, number>();
  const createModule = (id: string, courseId: string, organizationId = orgA) => {
    const position = (modulePositions.get(courseId) ?? 0) + 1;
    modulePositions.set(courseId, position);
    return db.courseModule.create({ data: { id, organizationId, courseId, title: `Module ${id}`, position } });
  };
  const createViaApi = async (
    handlers: ReturnType<typeof makeHandlers>,
    courseId: string,
    moduleId: string,
    title: string,
    type: string,
  ): Promise<LessonDetail> => {
    const response = await handlers.POST(request("POST", { title, type }, lessonsUrl(courseId, moduleId)), courseId, moduleId);
    assert.equal(response.status, 201, await response.clone().text());
    assertNoStore(response);
    return (await json<{ lesson: LessonDetail }>(response)).lesson;
  };
  const assertContiguous = async (moduleId: string, organizationId = orgA) => {
    const rows = await db.lesson.findMany({
      where: { organizationId, moduleId }, orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, position: true, createdAt: true, updatedAt: true },
    });
    assert.deepEqual(rows.map(({ position }) => position), rows.map((_row, index) => index + 1));
    assert.equal(new Set(rows.map(({ position }) => position)).size, rows.length);
    return rows;
  };
  let rollbackFunction = "";
  let rollbackTrigger = "";
  let errorFunction = "";
  let errorTrigger = "";

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Lesson Builder Tenant A", slug: `${orgA}-lesson-builder-test` },
      { id: orgB, name: "Lesson Builder Tenant B", slug: `${orgB}-lesson-builder-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
    ] });
    await Promise.all([
      createCourse(courseIds.main), createCourse(courseIds.other), createCourse(courseIds.published, orgA, "PUBLISHED"),
      createCourse(courseIds.foreign, orgB), createCourse(courseIds.concurrentCreate), createCourse(courseIds.concurrentMove),
      createCourse(courseIds.concurrentMoveCreate), createCourse(courseIds.concurrentDeleteMove), createCourse(courseIds.rollback),
      createCourse(courseIds.publishRace), createCourse(courseIds.moduleDeleteRace),
    ]);
    await Promise.all([
      createModule(moduleIds.main, courseIds.main), createModule(moduleIds.other, courseIds.other),
      createModule(moduleIds.foreign, courseIds.foreign, orgB), createModule(moduleIds.ordering, courseIds.main),
      createModule(moduleIds.types, courseIds.main), createModule(moduleIds.concurrentCreate, courseIds.concurrentCreate),
      createModule(moduleIds.concurrentMove, courseIds.concurrentMove), createModule(moduleIds.concurrentMoveCreate, courseIds.concurrentMoveCreate),
      createModule(moduleIds.concurrentDeleteMove, courseIds.concurrentDeleteMove), createModule(moduleIds.rollback, courseIds.rollback),
      createModule(moduleIds.publishRace, courseIds.publishRace), createModule(moduleIds.moduleDeleteRace, courseIds.moduleDeleteRace),
      createModule(moduleIds.published, courseIds.published),
    ]);

    const emptyList = await ownerA.GET_LIST(courseIds.main, moduleIds.main);
    assert.equal(emptyList.status, 200);
    assertNoStore(emptyList);
    assert.deepEqual(await json(emptyList), { lessons: [] });
    assert.equal((await adminA.GET_LIST(courseIds.main, moduleIds.main)).status, 200);
    assert.equal((await memberA.GET_LIST(courseIds.main, moduleIds.main)).status, 403);
    assert.equal((await anonymous.GET_LIST(courseIds.main, moduleIds.main)).status, 401);

    const first = await createViaApi(ownerA, courseIds.main, moduleIds.main, "Introduction", "TEXT");
    const second = await createViaApi(adminA, courseIds.main, moduleIds.main, "Introduction", "TEXT");
    assert.equal(first.position, 1);
    assert.equal(second.position, 2);
    assert.equal(first.title, second.title, "duplicate titles are allowed");
    assert.equal("organizationId" in first, false);
    assert.equal("moduleId" in first, false);
    assert.equal("courseId" in first, false);
    assert.deepEqual((await assertContiguous(moduleIds.main)).map(({ id }) => id), [first.id, second.id]);

    for (const type of ["TEXT", "VIDEO", "PDF", "IMAGE", "LINK", "QUIZ"]) {
      const created = await createViaApi(ownerA, courseIds.main, moduleIds.types, `Type ${type}`, type);
      assert.equal(created.type, type);
      assert.equal(created.position, ["TEXT", "VIDEO", "PDF", "IMAGE", "LINK", "QUIZ"].indexOf(type) + 1);
      const detail = await ownerA.GET_ONE(courseIds.main, moduleIds.types, created.id);
      assert.equal(detail.status, 200);
      const content = (await json<{ lesson: { content: unknown } }>(detail)).lesson.content;
      if (type === "QUIZ") assert.equal(content, null);
      else if (type === "TEXT") assert.deepEqual(content, { text: null });
      else assert.deepEqual(content, { url: null });
    }

    for (const body of [
      { title: "Missing type" }, { title: "x", type: "TEXT" }, { title: " ", type: "TEXT" },
      { title: `a${"b".repeat(160)}`, type: "TEXT" }, { title: "A\u0000B", type: "TEXT" },
      { title: "A\ud800B", type: "TEXT" }, { title: "Bad\nTitle", type: "TEXT" },
      { title: "Valid", type: "TEXT", position: 1 }, { title: "Valid", type: "TEXT", organizationId: orgB },
      { title: "Valid", type: "TEXT", tenantId: orgB }, { title: "Valid", type: "TEXT", courseId: courseIds.foreign },
      { title: "Valid", type: "TEXT", moduleId: moduleIds.foreign }, { title: "Valid", type: "TEXT", id: crypto.randomUUID() },
      { title: "Valid", type: "TEXT", textContent: "injected" }, { title: "Valid", type: "TEXT", contentUrl: "https://example.test" },
      { title: "Valid", type: "TEXT", createdAt: new Date().toISOString() },
      { title: "Valid", type: "TEXT", updatedAt: new Date().toISOString() }, { title: "Valid", type: "TEXT", status: "PUBLISHED" },
    ]) {
      const response = await ownerA.POST(request("POST", body), courseIds.main, moduleIds.main);
      assert.equal(response.status, 400, await response.clone().text());
      assertNoStore(response);
    }
    const noType = await ownerA.POST(request("POST", { title: "No implicit type" }), courseIds.main, moduleIds.main);
    assert.deepEqual(await noType.json(), { error: "invalid_request" });

    const titlePatch = await ownerA.PATCH(
      request("PATCH", { title: "  Updated introduction  " }, lessonsUrl(courseIds.main, moduleIds.main, first.id)),
      courseIds.main, moduleIds.main, first.id,
    );
    assert.equal(titlePatch.status, 200);
    assert.equal((await json<{ lesson: LessonDetail }>(titlePatch)).lesson.title, "Updated introduction");
    assertNoStore(titlePatch);
    for (const body of [
      {}, { position: 2 }, { moduleId: moduleIds.other }, { courseId: courseIds.other },
      { organizationId: orgB }, { tenantId: orgB }, { status: "PUBLISHED" }, { type: "TEXT", textContent: "forged" },
    ]) {
      const response = await ownerA.PATCH(request("PATCH", body), courseIds.main, moduleIds.main, first.id);
      assert.equal(response.status, 400);
      assertNoStore(response);
    }
    const setText = await ownerA.PUT_CONTENT(
      request("PUT", { text: "  First line\r\nSecond line  " }, lessonsUrl(courseIds.main, moduleIds.main, first.id, "/content")),
      courseIds.main, moduleIds.main, first.id,
    );
    assert.equal(setText.status, 200);
    assert.deepEqual((await json<{ lesson: { content: unknown } }>(setText)).lesson.content, { text: "  First line\nSecond line  " });
    assertNoStore(setText);
    const sameTypePatch = await ownerA.PATCH(request("PATCH", { type: "TEXT" }), courseIds.main, moduleIds.main, first.id);
    assert.deepEqual((await json<{ lesson: { content: unknown } }>(sameTypePatch)).lesson.content, { text: "  First line\nSecond line  " });
    const clearedText = await ownerA.PUT_CONTENT(request("PUT", { text: " \n\t " }), courseIds.main, moduleIds.main, first.id);
    assert.deepEqual((await json<{ lesson: { content: unknown } }>(clearedText)).lesson.content, { text: null });
    const explicitNullText = await ownerA.PUT_CONTENT(request("PUT", { text: null }), courseIds.main, moduleIds.main, first.id);
    assert.deepEqual((await json<{ lesson: { content: unknown } }>(explicitNullText)).lesson.content, { text: null });
    for (const invalidText of [
      { text: "x".repeat(100_001) }, { text: "a\u0000b" }, { text: "a\u000bb" }, { text: "\ud800" },
      { text: "valid", url: "https://example.test" }, { content: "generic" },
    ]) {
      const response = await ownerA.PUT_CONTENT(request("PUT", invalidText), courseIds.main, moduleIds.main, first.id);
      assert.equal(response.status, 400);
      assertNoStore(response);
    }

    const typeChange = await ownerA.PATCH(request("PATCH", { type: "VIDEO" }), courseIds.main, moduleIds.main, first.id);
    assert.equal(typeChange.status, 200);
    assert.deepEqual((await json<{ lesson: { content: unknown } }>(typeChange)).lesson.content, { url: null });
    const setVideo = await ownerA.PUT_CONTENT(request("PUT", { url: "  https://video.example.test/watch?v=1  " }), courseIds.main, moduleIds.main, first.id);
    assert.equal((await json<{ lesson: { content: { url: string } } }>(setVideo)).lesson.content.url, "https://video.example.test/watch?v=1");
    for (const [index, type] of ["PDF", "IMAGE", "LINK"].entries()) {
      const resourceLesson = await createViaApi(ownerA, courseIds.main, moduleIds.main, `${type} resource`, type);
      const setUrl = await ownerA.PUT_CONTENT(request("PUT", { url: `https://${type.toLowerCase()}.example.test/${index}` }), courseIds.main, moduleIds.main, resourceLesson.id);
      assert.equal(setUrl.status, 200);
      assert.deepEqual((await json<{ lesson: { content: unknown } }>(setUrl)).lesson.content, { url: `https://${type.toLowerCase()}.example.test/${index}` });
      const clearUrl = await ownerA.PUT_CONTENT(request("PUT", { url: null }), courseIds.main, moduleIds.main, resourceLesson.id);
      assert.deepEqual((await json<{ lesson: { content: unknown } }>(clearUrl)).lesson.content, { url: null });
    }
    for (const invalidUrl of [
      { url: "/relative" }, { url: "http://example.test" }, { url: "javascript:alert(1)" },
      { url: "data:text/plain,x" }, { url: "file:///tmp/a" }, { url: "ftp://example.test" },
      { url: "https://user:pass@example.test/resource" }, { url: "https://user@example.test/resource" },
      { url: `https://example.test/${"x".repeat(2048)}` }, { text: "wrong type payload" },
      { url: "https://example.test", organizationId: orgB },
    ]) {
      const response = await ownerA.PUT_CONTENT(request("PUT", invalidUrl), courseIds.main, moduleIds.main, first.id);
      assert.equal(response.status, 400);
      assertNoStore(response);
    }
    const quizLesson = await db.lesson.findFirstOrThrow({ where: { moduleId: moduleIds.types, type: "QUIZ" } });
    const quizContent = await ownerA.PUT_CONTENT(request("PUT", { text: "unavailable" }), courseIds.main, moduleIds.types, quizLesson.id);
    assert.equal(quizContent.status, 409);
    assert.deepEqual(await quizContent.json(), { error: "quiz_content_not_available" });
    assertNoStore(quizContent);
    const switchedToQuiz = await ownerA.PATCH(request("PATCH", { type: "QUIZ" }), courseIds.main, moduleIds.main, first.id);
    assert.equal(switchedToQuiz.status, 200);
    assert.deepEqual((await json<{ lesson: { content: unknown } }>(switchedToQuiz)).lesson.content, null);
    assert.equal(await db.lesson.findFirstOrThrow({ where: { id: first.id } }).then(({ textContent, contentUrl }) => textContent === null && contentUrl === null), true);
    assert.equal((await ownerA.PUT_CONTENT(request("PUT", {}), courseIds.main, moduleIds.main, first.id)).status, 409);

    const detail = await ownerA.GET_ONE(courseIds.main, moduleIds.main, first.id);
    assert.equal(detail.status, 200);
    assertNoStore(detail);
    assert.equal((await json<{ lesson: Record<string, unknown> }>(detail)).lesson["textContent"], undefined);
    const list = await ownerA.GET_LIST(courseIds.main, moduleIds.main);
    assertNoStore(list);
    const listLesson = (await json<{ lessons: Array<Record<string, unknown>> }>(list)).lessons[0]!;
    assert.deepEqual(Object.keys(listLesson).sort(), ["createdAt", "id", "position", "title", "type", "updatedAt"].sort());
    assert.equal("textContent" in listLesson, false);
    assert.equal("contentUrl" in listLesson, false);

    const foreignCourse = await ownerA.GET_LIST(courseIds.foreign, moduleIds.foreign);
    assert.equal(foreignCourse.status, 404);
    assert.deepEqual(await foreignCourse.json(), { error: "course_not_found" });
    assert.deepEqual(await (await ownerA.GET_LIST("malformed-course", moduleIds.main)).json(), { error: "course_not_found" });
    assert.deepEqual(await (await ownerA.GET_LIST(courseIds.main, moduleIds.foreign)).json(), { error: "module_not_found" });
    assert.deepEqual(await (await ownerA.GET_LIST(courseIds.main, "malformed-module")).json(), { error: "module_not_found" });
    assert.deepEqual(await (await ownerA.GET_ONE(courseIds.other, moduleIds.main, first.id)).json(), { error: "module_not_found" });
    assert.deepEqual(await (await ownerA.GET_ONE(courseIds.main, moduleIds.main, "malformed-lesson")).json(), { error: "lesson_not_found" });
    assert.deepEqual(await (await ownerA.GET_ONE(courseIds.main, moduleIds.other, first.id)).json(), { error: "module_not_found" });
    assert.deepEqual(await (await ownerA.GET_ONE(courseIds.main, moduleIds.types, first.id)).json(), { error: "lesson_not_found" });
    const foreignLesson = await createViaApi(ownerB, courseIds.foreign, moduleIds.foreign, "Tenant B only", "TEXT");
    assert.deepEqual(await (await ownerA.GET_ONE(courseIds.main, moduleIds.main, foreignLesson.id)).json(), { error: "lesson_not_found" });
    for (const result of [
      await ownerA.PATCH(request("PATCH", { title: "No access" }), courseIds.main, moduleIds.main, foreignLesson.id),
      await ownerA.DELETE(request("DELETE"), courseIds.main, moduleIds.main, foreignLesson.id),
    ]) {
      assert.equal(result.status, 404);
      assertNoStore(result);
    }
    assert.ok(await db.lesson.findUnique({ where: { id: foreignLesson.id } }), "foreign lesson remains unchanged");
    const forgedTenant = await ownerA.GET_LIST(courseIds.main, moduleIds.main);
    const forgedUrlRequest = new Request(`${lessonsUrl(courseIds.main, moduleIds.main)}?organizationId=${orgB}&tenantId=${orgB}`, {
      headers: { "x-organization-id": orgB, "x-tenant-id": orgB },
    });
    const forgedTenantList = await ownerA.GET_LIST(courseIds.main, moduleIds.main, forgedUrlRequest);
    assert.equal(forgedTenant.status, 200);
    assert.deepEqual((await json<{ lessons: LessonDetail[] }>(forgedTenantList)).lessons.map(({ id }) => id), [first.id, second.id],
      "forged tenant query/header values cannot replace trusted tenant context");
    for (const denied of [
      await memberA.POST(request("POST", { title: "No", type: "TEXT" }), courseIds.main, moduleIds.main),
      await memberA.PATCH(request("PATCH", { title: "No" }), courseIds.main, moduleIds.main, first.id),
      await memberA.PUT_CONTENT(request("PUT", { text: "No" }), courseIds.main, moduleIds.main, first.id),
      await memberA.MOVE(request("POST", { position: 1 }), courseIds.main, moduleIds.main, first.id),
      await memberA.DELETE(request("DELETE"), courseIds.main, moduleIds.main, first.id),
      await memberA.GET_ONE(courseIds.main, moduleIds.main, first.id),
      await anonymous.POST(request("POST", { title: "No", type: "TEXT" }), courseIds.main, moduleIds.main),
      await anonymous.GET_ONE(courseIds.main, moduleIds.main, first.id),
    ]) {
      assert.ok([401, 403].includes(denied.status));
      assertNoStore(denied);
    }
    const untrusted = new Request(lessonsUrl(courseIds.main, moduleIds.main), {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Blocked", type: "TEXT" }),
    });
    const untrustedResponse = await ownerA.POST(untrusted, courseIds.main, moduleIds.main);
    assert.equal(untrustedResponse.status, 403);
    assert.deepEqual(await untrustedResponse.json(), { error: "invalid_request" });
    assertNoStore(untrustedResponse);

    const publishedLesson = await db.lesson.create({
      data: { organizationId: orgA, moduleId: moduleIds.published, title: "Published lesson", type: "TEXT", position: 1 },
    });
    const publishedCourseList = await ownerA.GET_LIST(courseIds.published, moduleIds.published);
    assert.equal(publishedCourseList.status, 200);
    assert.equal((await json<{ lessons: unknown[] }>(publishedCourseList)).lessons.length, 1);
    assert.equal((await ownerA.GET_LIST(courseIds.published, moduleIds.published)).status, 200);
    const publishedDetailId = publishedLesson.id;
    assert.equal((await ownerA.GET_ONE(courseIds.published, moduleIds.published, publishedDetailId)).status, 200);
    for (const response of [
      await ownerA.POST(request("POST", { title: "Blocked", type: "TEXT" }), courseIds.published, moduleIds.published),
      await ownerA.PATCH(request("PATCH", { title: "Blocked" }), courseIds.published, moduleIds.published, publishedDetailId),
      await ownerA.PUT_CONTENT(request("PUT", { text: "Blocked" }), courseIds.published, moduleIds.published, publishedDetailId),
      await ownerA.MOVE(request("POST", { position: 1 }), courseIds.published, moduleIds.published, publishedDetailId),
      await ownerA.DELETE(request("DELETE"), courseIds.published, moduleIds.published, publishedDetailId),
    ]) {
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "published_course_structure_locked" });
      assertNoStore(response);
    }

    const ordering = [
      await createViaApi(ownerA, courseIds.main, moduleIds.ordering, "A", "TEXT"),
      await createViaApi(ownerA, courseIds.main, moduleIds.ordering, "B", "TEXT"),
      await createViaApi(ownerA, courseIds.main, moduleIds.ordering, "C", "TEXT"),
      await createViaApi(ownerA, courseIds.main, moduleIds.ordering, "D", "TEXT"),
    ];
    const beforeMove = await assertContiguous(moduleIds.ordering);
    const moveDown = await ownerA.MOVE(request("POST", { position: 2 }), courseIds.main, moduleIds.ordering, ordering[3]!.id);
    assert.equal(moveDown.status, 200);
    assert.deepEqual((await assertContiguous(moduleIds.ordering)).map(({ id }) => id), [ordering[0]!.id, ordering[3]!.id, ordering[1]!.id, ordering[2]!.id]);
    const moveUp = await ownerA.MOVE(request("POST", { position: 4 }), courseIds.main, moduleIds.ordering, ordering[0]!.id);
    assert.equal(moveUp.status, 200);
    assert.deepEqual((await assertContiguous(moduleIds.ordering)).map(({ id }) => id), [ordering[3]!.id, ordering[1]!.id, ordering[2]!.id, ordering[0]!.id]);
    const noOp = await ownerA.MOVE(request("POST", { position: 2 }), courseIds.main, moduleIds.ordering, ordering[1]!.id);
    assert.equal(noOp.status, 200);
    const invalidRange = await ownerA.MOVE(request("POST", { position: 5 }), courseIds.main, moduleIds.ordering, ordering[1]!.id);
    assert.equal(invalidRange.status, 400);
    assert.deepEqual((await assertContiguous(moduleIds.ordering)).map(({ id }) => id), [ordering[3]!.id, ordering[1]!.id, ordering[2]!.id, ordering[0]!.id]);
    const afterMove = await db.lesson.findMany({ where: { id: { in: ordering.map(({ id }) => id) } }, select: { id: true, createdAt: true, updatedAt: true } });
    for (const before of beforeMove) {
      const after = afterMove.find(({ id }) => id === before.id);
      assert.ok(after);
      assert.equal(after.createdAt.getTime(), before.createdAt.getTime());
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime(), "position-only changes preserve updatedAt");
    }
    const deleteMiddle = await ownerA.DELETE(request("DELETE"), courseIds.main, moduleIds.ordering, ordering[2]!.id);
    assert.equal(deleteMiddle.status, 200);
    assert.deepEqual((await assertContiguous(moduleIds.ordering)).map(({ id }) => id), [ordering[3]!.id, ordering[1]!.id, ordering[0]!.id]);
    assert.equal((await ownerA.DELETE(request("DELETE"), courseIds.main, moduleIds.ordering, ordering[3]!.id)).status, 200);
    assert.deepEqual((await assertContiguous(moduleIds.ordering)).map(({ id }) => id), [ordering[1]!.id, ordering[0]!.id]);
    assert.equal((await ownerA.DELETE(request("DELETE"), courseIds.main, moduleIds.ordering, ordering[0]!.id)).status, 200);
    assert.deepEqual((await assertContiguous(moduleIds.ordering)).map(({ id }) => id), [ordering[1]!.id]);
    assert.equal((await ownerA.DELETE(request("DELETE"), courseIds.main, moduleIds.ordering, ordering[1]!.id)).status, 200);
    assert.deepEqual(await assertContiguous(moduleIds.ordering), []);

    const concurrentCreates = await Promise.all([
      ownerA.POST(request("POST", { title: "Concurrent A", type: "TEXT" }), courseIds.concurrentCreate, moduleIds.concurrentCreate),
      ownerA.POST(request("POST", { title: "Concurrent B", type: "TEXT" }), courseIds.concurrentCreate, moduleIds.concurrentCreate),
    ]);
    assert.ok(concurrentCreates.every(({ status }) => status === 201));
    assert.equal((await assertContiguous(moduleIds.concurrentCreate)).length, 2);

    const concurrentMoveLessons: LessonDetail[] = [];
    for (let index = 1; index <= 5; index += 1) {
      concurrentMoveLessons.push(await createViaApi(ownerA, courseIds.concurrentMove, moduleIds.concurrentMove, `Move ${index}`, "TEXT"));
    }
    const concurrentMoves = await Promise.all([
      ownerA.MOVE(request("POST", { position: 5 }), courseIds.concurrentMove, moduleIds.concurrentMove, concurrentMoveLessons[0]!.id),
      ownerA.MOVE(request("POST", { position: 1 }), courseIds.concurrentMove, moduleIds.concurrentMove, concurrentMoveLessons[4]!.id),
    ]);
    assert.ok(concurrentMoves.every(({ status }) => status === 200));
    const afterConcurrentMoves = await assertContiguous(moduleIds.concurrentMove);
    assert.equal(afterConcurrentMoves.length, 5);
    assert.deepEqual(new Set(afterConcurrentMoves.map(({ id }) => id)), new Set(concurrentMoveLessons.map(({ id }) => id)));

    const mixedMove = await createViaApi(ownerA, courseIds.concurrentMoveCreate, moduleIds.concurrentMoveCreate, "Existing A", "TEXT");
    await createViaApi(ownerA, courseIds.concurrentMoveCreate, moduleIds.concurrentMoveCreate, "Existing B", "TEXT");
    const mixed = await Promise.all([
      ownerA.MOVE(request("POST", { position: 2 }), courseIds.concurrentMoveCreate, moduleIds.concurrentMoveCreate, mixedMove.id),
      ownerA.POST(request("POST", { title: "Racing create", type: "TEXT" }), courseIds.concurrentMoveCreate, moduleIds.concurrentMoveCreate),
    ]);
    assert.deepEqual(mixed.map(({ status }) => status).sort(), [200, 201]);
    assert.equal((await assertContiguous(moduleIds.concurrentMoveCreate)).length, 3);

    const deleteMoveA = await createViaApi(ownerA, courseIds.concurrentDeleteMove, moduleIds.concurrentDeleteMove, "Delete move A", "TEXT");
    const deleteMoveB = await createViaApi(ownerA, courseIds.concurrentDeleteMove, moduleIds.concurrentDeleteMove, "Delete move B", "TEXT");
    await createViaApi(ownerA, courseIds.concurrentDeleteMove, moduleIds.concurrentDeleteMove, "Delete move C", "TEXT");
    const deleteMoveRace = await Promise.all([
      ownerA.DELETE(request("DELETE"), courseIds.concurrentDeleteMove, moduleIds.concurrentDeleteMove, deleteMoveB.id),
      ownerA.MOVE(request("POST", { position: 1 }), courseIds.concurrentDeleteMove, moduleIds.concurrentDeleteMove, deleteMoveB.id),
    ]);
    assert.equal(deleteMoveRace[0]!.status, 200);
    assert.ok([200, 404].includes(deleteMoveRace[1]!.status));
    assert.equal(await db.lesson.findUnique({ where: { id: deleteMoveA.id } }).then(Boolean), true);
    assert.equal((await assertContiguous(moduleIds.concurrentDeleteMove)).length, 2);

    const rollbackRows = [
      await createViaApi(ownerA, courseIds.rollback, moduleIds.rollback, "Rollback A", "TEXT"),
      await createViaApi(ownerA, courseIds.rollback, moduleIds.rollback, "Rollback B", "TEXT"),
      await createViaApi(ownerA, courseIds.rollback, moduleIds.rollback, "Rollback C", "TEXT"),
    ];
    const rollbackBefore = await assertContiguous(moduleIds.rollback);
    const rollbackSuffix = crypto.randomUUID().replaceAll("-", "");
    rollbackFunction = `lms022_fail_move_${rollbackSuffix}`;
    rollbackTrigger = `lms022_fail_move_trigger_${rollbackSuffix}`;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${rollbackFunction}"() RETURNS trigger AS $fn$
      BEGIN
        IF NEW."moduleId" = '${moduleIds.rollback}'::uuid AND NEW."position" = 2 THEN
          RAISE EXCEPTION 'forced LMS-022 reorder failure';
        END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${rollbackTrigger}" BEFORE UPDATE OF "position" ON "Lesson" FOR EACH ROW EXECUTE FUNCTION "${rollbackFunction}"()`);
    const failedMove = await ownerA.MOVE(request("POST", { position: 2 }), courseIds.rollback, moduleIds.rollback, rollbackRows[2]!.id);
    assert.equal(failedMove.status, 503);
    assert.deepEqual(await failedMove.json(), { error: "lesson_builder_unavailable" });
    assertNoStore(failedMove);
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${rollbackTrigger}" ON "Lesson"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${rollbackFunction}"()`);
    rollbackFunction = "";
    rollbackTrigger = "";
    assert.deepEqual(await assertContiguous(moduleIds.rollback), rollbackBefore);

    const raceLesson = await createViaApi(ownerA, courseIds.publishRace, moduleIds.publishRace, "Publish race", "TEXT");
    let waitingMutation: Promise<Response> | undefined;
    await db.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "status" FROM "Course" WHERE "id" = ${courseIds.publishRace}::uuid AND "organizationId" = ${orgA}::uuid FOR UPDATE`;
      await transaction.course.update({ where: { id: courseIds.publishRace }, data: { status: "PUBLISHED" } });
      waitingMutation = ownerA.POST(request("POST", { title: "Must wait", type: "TEXT" }), courseIds.publishRace, moduleIds.publishRace);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.ok(waitingMutation);
    const publishRaceResult = await waitingMutation;
    assert.equal(publishRaceResult.status, 409);
    assert.equal(await db.lesson.count({ where: { moduleId: moduleIds.publishRace } }), 1);
    assert.ok(await db.lesson.findUnique({ where: { id: raceLesson.id } }));

    const moduleDeleteLesson = await createViaApi(ownerA, courseIds.moduleDeleteRace, moduleIds.moduleDeleteRace, "Delete interaction", "TEXT");
    const moduleDeleteRace = await Promise.all([
      moduleHandlers.DELETE(request("DELETE", undefined, moduleUrl(courseIds.moduleDeleteRace, moduleIds.moduleDeleteRace)), courseIds.moduleDeleteRace, moduleIds.moduleDeleteRace),
      ownerA.PUT_CONTENT(request("PUT", { text: "racing content" }), courseIds.moduleDeleteRace, moduleIds.moduleDeleteRace, moduleDeleteLesson.id),
    ]);
    assert.equal(moduleDeleteRace[0]!.status, 200);
    assert.ok([200, 404].includes(moduleDeleteRace[1]!.status));
    assert.equal(await db.courseModule.findUnique({ where: { id: moduleIds.moduleDeleteRace } }), null);
    assert.equal(await db.lesson.findUnique({ where: { id: moduleDeleteLesson.id } }), null, "Module delete cascade leaves no orphan Lesson");

    const constraintLessons = await db.lesson.findMany({ where: { moduleId: moduleIds.types }, orderBy: { position: "asc" } });
    const byType = new Map(constraintLessons.map((record) => [record.type, record]));
    const invalidPairs: Array<{ type: string; textContent: string | null; contentUrl: string | null }> = [
      { type: "TEXT", textContent: null, contentUrl: "https://example.test" },
      { type: "VIDEO", textContent: "bad", contentUrl: null },
      { type: "QUIZ", textContent: "bad", contentUrl: null },
      { type: "QUIZ", textContent: null, contentUrl: "https://example.test" },
    ];
    for (const [index, invalid] of invalidPairs.entries()) {
      const record = invalid.type === "TEXT" ? byType.get("TEXT") : invalid.type === "VIDEO" ? byType.get("VIDEO") : byType.get("QUIZ");
      assert.ok(record);
      const invalidText = invalid.textContent;
      const invalidUrl = invalid.contentUrl;
      await assert.rejects(db.$executeRaw`
        UPDATE "Lesson" SET "textContent" = ${invalidText}, "contentUrl" = ${invalidUrl}
        WHERE "id" = ${record.id}::uuid
      `, `DB CHECK case ${index} must reject inconsistent content`);
      const stillValid = await db.lesson.findUniqueOrThrow({ where: { id: record.id } });
      assert.equal(stillValid.textContent, null);
      assert.equal(stillValid.contentUrl, null);
    }
    const nullableDraftStates = await db.lesson.findMany({ where: { moduleId: moduleIds.types }, select: { textContent: true, contentUrl: true } });
    assert.ok(nullableDraftStates.every(({ textContent, contentUrl }) => textContent === null && contentUrl === null));

    const errorSuffix = crypto.randomUUID().replaceAll("-", "");
    errorFunction = `lms022_fail_update_${errorSuffix}`;
    errorTrigger = `lms022_fail_update_trigger_${errorSuffix}`;
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${errorFunction}"() RETURNS trigger AS $fn$
      BEGIN
        IF NEW."id" = '${second.id}'::uuid THEN RAISE EXCEPTION 'forced internal SQL detail'; END IF;
        RETURN NEW;
      END;
      $fn$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${errorTrigger}" BEFORE UPDATE OF "title" ON "Lesson" FOR EACH ROW EXECUTE FUNCTION "${errorFunction}"()`);
    const genericFailure = await ownerA.PATCH(request("PATCH", { title: "triggered failure" }), courseIds.main, moduleIds.main, second.id);
    assert.equal(genericFailure.status, 503);
    const genericFailureBody = await genericFailure.text();
    assert.equal(genericFailureBody, JSON.stringify({ error: "lesson_builder_unavailable" }));
    assert.equal(genericFailureBody.includes("SQL"), false);
    assert.equal(genericFailureBody.includes("forced internal"), false);
    assertNoStore(genericFailure);
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${errorTrigger}" ON "Lesson"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${errorFunction}"()`);
    errorFunction = "";
    errorTrigger = "";

    const cascadeCourse = await createCourse(crypto.randomUUID());
    const cascadeModule = await db.courseModule.create({
      data: { organizationId: orgA, courseId: cascadeCourse.id, title: "Cascade module", position: 1 },
    });
    const cascadeLesson = await db.lesson.create({
      data: { organizationId: orgA, moduleId: cascadeModule.id, title: "Cascade lesson", type: "PDF", position: 1 },
    });
    await db.course.delete({ where: { id: cascadeCourse.id } });
    assert.equal(await db.lesson.findUnique({ where: { id: cascadeLesson.id } }), null, "Course cascade still removes Lessons through Modules");
  } finally {
    if (rollbackTrigger) await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${rollbackTrigger}" ON "Lesson"`).catch(() => {});
    if (rollbackFunction) await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${rollbackFunction}"()`).catch(() => {});
    if (errorTrigger) await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${errorTrigger}" ON "Lesson"`).catch(() => {});
    if (errorFunction) await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${errorFunction}"()`).catch(() => {});
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } }).catch(() => {});
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } }).catch(() => {});
    if (priorAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = priorAppUrl;
    await db.$disconnect();
  }
});
