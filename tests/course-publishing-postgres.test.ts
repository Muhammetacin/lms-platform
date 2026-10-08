import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { requireOrganizationPermission, type AuthorizationStore, type OrganizationPermission } from "../src/lib/authorization-core.ts";
import { isTrustedAuthRequest, readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import { createCourseHandlers } from "../src/lib/course-core.ts";
import { createPrismaCourseStore } from "../src/lib/course-prisma-store.ts";
import { createCourseModuleHandlers } from "../src/lib/course-module-core.ts";
import { createPrismaCourseModuleStore } from "../src/lib/course-module-prisma-store.ts";
import { createCoursePublishingHandlers } from "../src/lib/course-publishing-core.ts";
import { createPrismaCoursePublishingStore } from "../src/lib/course-publishing-prisma-store.ts";
import { createLessonHandlers } from "../src/lib/lesson-core.ts";
import { createPrismaLessonStore } from "../src/lib/lesson-prisma-store.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL Course Publishing validates completeness, lifecycle, tenant isolation, and shared locks", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for Course Publishing tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const publishingStore = createPrismaCoursePublishingStore(db);
  const courseStore = createPrismaCourseStore(db);
  const moduleStore = createPrismaCourseModuleStore(db);
  const lessonStore = createPrismaLessonStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
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
  const asUser = (record: { id: string; email: string }): AuthenticatedUser => ({
    id: record.id, email: record.email, name: null,
  });
  const dependencies = (identity: AuthenticatedUser | null) => ({
    async requireTenantContext() { return resolveTenantContext(identity, undefined, membershipStore); },
    async requirePermission(organizationId: string, permission: OrganizationPermission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    isTrustedRequest: isTrustedAuthRequest,
    readBody: (request: Request) => readJsonBody(request, 1024),
    logError: () => {},
  });
  const makePublishingHandlers = (identity: AuthenticatedUser | null) => createCoursePublishingHandlers({
    ...dependencies(identity), store: publishingStore,
  });
  const ownerPublish = makePublishingHandlers(asUser(users.ownerA));
  const adminPublish = makePublishingHandlers(asUser(users.adminA));
  const memberPublish = makePublishingHandlers(asUser(users.memberA));
  const anonymousPublish = makePublishingHandlers(null);
  const ownerCourses = createCourseHandlers({ ...dependencies(asUser(users.ownerA)), store: courseStore });
  const ownerModules = createCourseModuleHandlers({ ...dependencies(asUser(users.ownerA)), store: moduleStore });
  const ownerLessons = createLessonHandlers({ ...dependencies(asUser(users.ownerA)), store: lessonStore,
    readBody: (request: Request) => readJsonBody(request, 512 * 1024),
  });

  const courseUrl = (id?: string) => `https://lms.example.test/api/organizations/courses${id ? `/${id}` : ""}`;
  const moduleUrl = (courseId: string, moduleId?: string) =>
    `${courseUrl(courseId)}/modules${moduleId ? `/${moduleId}` : ""}`;
  const lessonUrl = (courseId: string, moduleId: string, lessonId?: string, suffix = "") =>
    `${moduleUrl(courseId, moduleId)}/lessons${lessonId ? `/${lessonId}` : ""}${suffix}`;
  const request = (method: string, body: string | null = "{}", url = courseUrl(), headers: Record<string, string> = {}) =>
    new Request(url, {
      method,
      headers: { "content-type": "application/json", origin: "https://lms.example.test", ...headers },
      ...(body === null ? {} : { body }),
    });
  const json = async <T>(response: Response) => await response.json() as T;
  const assertNoStore = (response: Response) => assert.equal(response.headers.get("cache-control"), "no-store");
  const createCourse = (organizationId = orgA, title = "Publication fixture") =>
    db.course.create({ data: { organizationId, title } });
  const createModule = (courseId: string, position = 1, organizationId = orgA) =>
    db.courseModule.create({ data: { organizationId, courseId, title: `Module ${position}`, position } });
  const createLesson = (
    moduleId: string,
    type: "TEXT" | "VIDEO" | "PDF" | "IMAGE" | "LINK" | "QUIZ",
    position = 1,
    textContent: string | null = null,
    contentUrl: string | null = null,
  ) => db.lesson.create({ data: { organizationId: orgA, moduleId, title: `${type} ${position}`, type, position, textContent, contentUrl } });
  const publish = (handlers: typeof ownerPublish, id: string, body: string | null = "{}", url = `${courseUrl(id)}/publish`, headers: Record<string, string> = {}) =>
    handlers.POST(request("POST", body, url, headers), id);
  const expectBlocked = async (courseId: string, expectedCode: string) => {
    const response = await publish(ownerPublish, courseId);
    assert.equal(response.status, 409, await response.clone().text());
    assertNoStore(response);
    const body = await json<{
      error: string;
      issues: Array<{ code: string; moduleId?: string; lessonId?: string; type?: string }>;
      truncated: boolean;
    }>(response);
    assert.equal(body.error, "course_not_publishable");
    assert.ok(body.issues.some(({ code }) => code === expectedCode), JSON.stringify(body.issues));
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: courseId } })).status, "DRAFT");
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: courseId } })).publishedAt, null);
    return body;
  };

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Publishing Tenant A", slug: `${orgA}-publishing-test` },
      { id: orgB, name: "Publishing Tenant B", slug: `${orgB}-publishing-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER" },
    ] });

    const authCourse = await createCourse(orgA, "Authorization course");
    const authModule = await createModule(authCourse.id);
    await createLesson(authModule.id, "TEXT", 1, "Complete text");
    for (const handlers of [ownerPublish, adminPublish]) {
      const response = await publish(handlers, authCourse.id);
      assert.equal(response.status, 200);
      assertNoStore(response);
    }
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: authCourse.id } })).status, "PUBLISHED");
    assert.ok((await db.course.findUniqueOrThrow({ where: { id: authCourse.id } })).publishedAt);

    const memberDenied = await publish(memberPublish, authCourse.id);
    assert.equal(memberDenied.status, 403);
    assert.deepEqual(await memberDenied.json(), { error: "forbidden" });
    assertNoStore(memberDenied);
    const anonymousDenied = await publish(anonymousPublish, authCourse.id);
    assert.equal(anonymousDenied.status, 401);
    assert.deepEqual(await anonymousDenied.json(), { error: "unauthenticated" });
    assertNoStore(anonymousDenied);

    for (const body of ["null", "[]", '{"status":"PUBLISHED"}', '{"organizationId":"' + orgB + '"}', " ".repeat(1100)]) {
      const response = await publish(ownerPublish, authCourse.id, body);
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "invalid_request" });
      assertNoStore(response);
    }
    const emptyBody = await publish(ownerPublish, authCourse.id, null);
    assert.equal(emptyBody.status, 400);
    assertNoStore(emptyBody);

    const malformed = await publish(ownerPublish, "malformed-id");
    assert.equal(malformed.status, 404);
    assert.deepEqual(await malformed.json(), { error: "course_not_found" });
    assertNoStore(malformed);

    const noModules = await createCourse(orgA, "No Modules");
    const noModulesResult = await expectBlocked(noModules.id, "course_requires_module");
    assert.deepEqual(noModulesResult.issues, [{ code: "course_requires_module" }]);

    const emptyModuleCourse = await createCourse(orgA, "Empty Module");
    const emptyModule = await createModule(emptyModuleCourse.id);
    const emptyModuleResult = await expectBlocked(emptyModuleCourse.id, "module_requires_lesson");
    assert.deepEqual(emptyModuleResult.issues, [{ code: "module_requires_lesson", moduleId: emptyModule.id }]);

    for (const [label, value] of [["missing", null], ["blank", " \n\t "], ["invalid", "x".repeat(100_001)]] as const) {
      const invalidTextCourse = await createCourse(orgA, `TEXT ${label}`);
      const invalidTextModule = await createModule(invalidTextCourse.id);
      await createLesson(invalidTextModule.id, "TEXT", 1, value);
      await expectBlocked(invalidTextCourse.id, "lesson_content_missing");
    }

    const missingVideo = await createCourse(orgA, "Missing VIDEO URL");
    const missingVideoModule = await createModule(missingVideo.id);
    const missingVideoLesson = await createLesson(missingVideoModule.id, "VIDEO");
    const missingVideoResult = await expectBlocked(missingVideo.id, "lesson_content_missing");
    assert.ok(missingVideoResult.issues.some((issue) => issue.code === "lesson_content_missing" && issue.lessonId === missingVideoLesson.id && issue.type === "VIDEO"));

    for (const [index, url] of ["http://example.test/video", "javascript:alert(1)", "not a URL", "   "].entries()) {
      const invalidVideo = await createCourse(orgA, `Invalid VIDEO URL ${index + 1}`);
      const invalidVideoModule = await createModule(invalidVideo.id);
      await createLesson(invalidVideoModule.id, "VIDEO", 1, null, url);
      await expectBlocked(invalidVideo.id, "lesson_content_missing");
    }

    for (const type of ["PDF", "IMAGE", "LINK"] as const) {
      const validUrlCourse = await createCourse(orgA, `Valid ${type} URL`);
      const validUrlModule = await createModule(validUrlCourse.id);
      await createLesson(validUrlModule.id, type, 1, null, `https://${type.toLowerCase()}.example.invalid/resource`);
      const response = await publish(ownerPublish, validUrlCourse.id);
      assert.equal(response.status, 200, `${type}: ${await response.clone().text()}`);
      assertNoStore(response);
    }

    const quizCourse = await createCourse(orgA, "Quiz is not configured");
    const quizModule = await createModule(quizCourse.id);
    const quizLesson = await createLesson(quizModule.id, "QUIZ");
    const quizResult = await expectBlocked(quizCourse.id, "quiz_not_configured");
    assert.deepEqual(quizResult.issues, [{ code: "quiz_not_configured", moduleId: quizModule.id, lessonId: quizLesson.id }]);

    const moduleGapCourse = await createCourse(orgA, "Module ordering gap");
    const moduleGapFirst = await createModule(moduleGapCourse.id, 1);
    const moduleGapThird = await createModule(moduleGapCourse.id, 3);
    await createLesson(moduleGapFirst.id, "TEXT", 1, "First module text");
    await createLesson(moduleGapThird.id, "TEXT", 1, "Third module text");
    const moduleGapResult = await expectBlocked(moduleGapCourse.id, "module_order_invalid");
    assert.ok(moduleGapResult.issues.some((issue) => issue.code === "module_order_invalid" && issue.moduleId === moduleGapThird.id));

    const lessonGapCourse = await createCourse(orgA, "Lesson ordering gap");
    const lessonGapModule = await createModule(lessonGapCourse.id);
    await createLesson(lessonGapModule.id, "TEXT", 1, "First lesson");
    const gapLesson = await createLesson(lessonGapModule.id, "TEXT", 4, "Fourth lesson");
    const lessonGapResult = await expectBlocked(lessonGapCourse.id, "lesson_order_invalid");
    assert.ok(lessonGapResult.issues.some((issue) => issue.code === "lesson_order_invalid" && issue.moduleId === lessonGapModule.id && issue.lessonId === gapLesson.id));

    const multipleIssuesCourse = await createCourse(orgA, "Deterministic issues");
    const firstEmptyModule = await createModule(multipleIssuesCourse.id, 1);
    const thirdModule = await createModule(multipleIssuesCourse.id, 3);
    await createLesson(thirdModule.id, "TEXT", 1, " \n ");
    const thirdLesson = await createLesson(thirdModule.id, "TEXT", 3, "Valid at a gap");
    const multiple = await expectBlocked(multipleIssuesCourse.id, "lesson_order_invalid");
    assert.deepEqual(multiple.issues, [
      { code: "module_requires_lesson", moduleId: firstEmptyModule.id },
      { code: "module_order_invalid", moduleId: thirdModule.id },
      { code: "lesson_content_missing", moduleId: thirdModule.id, lessonId: (await db.lesson.findFirstOrThrow({ where: { moduleId: thirdModule.id, position: 1 } })).id, type: "TEXT" },
      { code: "lesson_order_invalid", moduleId: thirdModule.id, lessonId: thirdLesson.id },
    ]);

    const tooManyIssues = await createCourse(orgA, "More than one hundred issues");
    const tooManyModule = await createModule(tooManyIssues.id);
    await db.lesson.createMany({ data: Array.from({ length: 105 }, (_, index) => ({
      organizationId: orgA,
      moduleId: tooManyModule.id,
      title: `Missing text ${index + 1}`,
      type: "TEXT" as const,
      position: index + 1,
    })) });
    const truncated = await expectBlocked(tooManyIssues.id, "lesson_content_missing");
    assert.equal(truncated.issues.length, 100);
    assert.equal(truncated.truncated, true);

    const fullyComplete = await createCourse(orgA, "Complete multi-module course");
    const fullModuleOne = await createModule(fullyComplete.id, 1);
    const fullModuleTwo = await createModule(fullyComplete.id, 2);
    await createLesson(fullModuleOne.id, "TEXT", 1, "Introduction text");
    await createLesson(fullModuleOne.id, "VIDEO", 2, null, "https://video.example.invalid/watch");
    await createLesson(fullModuleTwo.id, "PDF", 1, null, "https://docs.example.invalid/handbook.pdf");
    await createLesson(fullModuleTwo.id, "IMAGE", 2, null, "https://images.example.invalid/course.png");
    await createLesson(fullModuleTwo.id, "LINK", 3, null, "https://links.example.invalid/course");
    const success = await publish(ownerPublish, fullyComplete.id);
    assert.equal(success.status, 200, await success.clone().text());
    assertNoStore(success);
    const publishedResponse = await json<{ course: { status: string; publishedAt: string; id: string } }>(success);
    assert.equal(publishedResponse.course.status, "PUBLISHED");
    assert.ok(publishedResponse.course.publishedAt);
    const publishedAt = publishedResponse.course.publishedAt;
    const publishedBeforeRetry = await db.course.findUniqueOrThrow({ where: { id: fullyComplete.id } });
    const lessonsBeforeRetry = await db.lesson.findMany({
      where: { organizationId: orgA, moduleId: { in: [fullModuleOne.id, fullModuleTwo.id] } },
      orderBy: [{ moduleId: "asc" }, { position: "asc" }, { id: "asc" }],
      select: { id: true, moduleId: true, position: true, type: true, textContent: true, contentUrl: true },
    });
    const retry = await publish(ownerPublish, fullyComplete.id);
    assert.equal(retry.status, 200);
    assertNoStore(retry);
    const retried = await json<{ course: { status: string; publishedAt: string } }>(retry);
    assert.equal(retried.course.publishedAt, publishedAt);
    const publishedAfterRetry = await db.course.findUniqueOrThrow({ where: { id: fullyComplete.id } });
    assert.equal(publishedAfterRetry.publishedAt?.toISOString(), publishedBeforeRetry.publishedAt?.toISOString());
    assert.equal(publishedAfterRetry.updatedAt.toISOString(), publishedBeforeRetry.updatedAt.toISOString());
    assert.deepEqual(await db.lesson.findMany({
      where: { organizationId: orgA, moduleId: { in: [fullModuleOne.id, fullModuleTwo.id] } },
      orderBy: [{ moduleId: "asc" }, { position: "asc" }, { id: "asc" }],
      select: { id: true, moduleId: true, position: true, type: true, textContent: true, contentUrl: true },
    }), lessonsBeforeRetry);

    const readModules = await ownerModules.GET_LIST(fullyComplete.id, request("GET", null, moduleUrl(fullyComplete.id)));
    const readLessons = await ownerLessons.GET_LIST(fullyComplete.id, fullModuleOne.id, request("GET", null, lessonUrl(fullyComplete.id, fullModuleOne.id)));
    assert.equal(readModules.status, 200);
    assert.equal(readLessons.status, 200);
    assertNoStore(readModules);
    assertNoStore(readLessons);
    const moduleWrite = await ownerModules.POST(request("POST", JSON.stringify({ title: "No mutation" }), moduleUrl(fullyComplete.id)), fullyComplete.id);
    assert.equal(moduleWrite.status, 409);
    assert.deepEqual(await moduleWrite.json(), { error: "published_course_structure_locked" });
    assertNoStore(moduleWrite);
    const publishedTextLesson = await db.lesson.findFirstOrThrow({ where: { moduleId: fullModuleOne.id, type: "TEXT" } });
    const publishedModulePatch = await ownerModules.PATCH(
      request("PATCH", JSON.stringify({ title: "No mutation" }), moduleUrl(fullyComplete.id, fullModuleOne.id)),
      fullyComplete.id, fullModuleOne.id,
    );
    const publishedModuleMove = await ownerModules.MOVE(
      request("POST", JSON.stringify({ position: 2 }), `${moduleUrl(fullyComplete.id, fullModuleOne.id)}/move`),
      fullyComplete.id, fullModuleOne.id,
    );
    const publishedModuleDelete = await ownerModules.DELETE(
      request("DELETE", null, moduleUrl(fullyComplete.id, fullModuleOne.id)), fullyComplete.id, fullModuleOne.id,
    );
    const lessonWrite = await ownerLessons.PUT_CONTENT(
      request("PUT", JSON.stringify({ text: "Changed text" }), lessonUrl(fullyComplete.id, fullModuleOne.id, publishedTextLesson.id, "/content")),
      fullyComplete.id, fullModuleOne.id, publishedTextLesson.id,
    );
    const publishedLessonCreate = await ownerLessons.POST(
      request("POST", JSON.stringify({ title: "No mutation", type: "TEXT" }), lessonUrl(fullyComplete.id, fullModuleOne.id)),
      fullyComplete.id, fullModuleOne.id,
    );
    const publishedLessonPatch = await ownerLessons.PATCH(
      request("PATCH", JSON.stringify({ title: "No mutation" }), lessonUrl(fullyComplete.id, fullModuleOne.id, publishedTextLesson.id)),
      fullyComplete.id, fullModuleOne.id, publishedTextLesson.id,
    );
    const publishedLessonMove = await ownerLessons.MOVE(
      request("POST", JSON.stringify({ position: 2 }), lessonUrl(fullyComplete.id, fullModuleOne.id, publishedTextLesson.id, "/move")),
      fullyComplete.id, fullModuleOne.id, publishedTextLesson.id,
    );
    const publishedLessonDelete = await ownerLessons.DELETE(
      request("DELETE", null, lessonUrl(fullyComplete.id, fullModuleOne.id, publishedTextLesson.id)),
      fullyComplete.id, fullModuleOne.id, publishedTextLesson.id,
    );
    for (const response of [publishedModulePatch, publishedModuleMove, publishedModuleDelete, lessonWrite, publishedLessonCreate, publishedLessonPatch, publishedLessonMove, publishedLessonDelete]) {
      assert.equal(response.status, 409, await response.clone().text());
      assert.deepEqual(await response.json(), { error: "published_course_structure_locked" });
      assertNoStore(response);
    }
    const deletePublished = await ownerCourses.DELETE(request("DELETE", null, courseUrl(fullyComplete.id)), fullyComplete.id);
    assert.equal(deletePublished.status, 409);
    assert.deepEqual(await deletePublished.json(), { error: "published_course_delete_forbidden" });
    assertNoStore(deletePublished);
    const editPublishedMetadata = await ownerCourses.PATCH(
      request("PATCH", JSON.stringify({ title: "Published metadata remains editable" }), courseUrl(fullyComplete.id)),
      fullyComplete.id,
    );
    assert.equal(editPublishedMetadata.status, 200);
    assert.equal((await json<{ course: { publishedAt: string } }>(editPublishedMetadata)).course.publishedAt, publishedAt);
    assertNoStore(editPublishedMetadata);

    const foreignComplete = await createCourse(orgB, "Tenant B complete course");
    const foreignModule = await createModule(foreignComplete.id, 1, orgB);
    await db.lesson.create({ data: { organizationId: orgB, moduleId: foreignModule.id, title: "Tenant B content", type: "TEXT", position: 1, textContent: "private" } });
    const foreignAttempt = await publish(ownerPublish, foreignComplete.id);
    const randomMissingAttempt = await publish(ownerPublish, crypto.randomUUID());
    assert.equal(foreignAttempt.status, 404);
    assert.deepEqual(await foreignAttempt.json(), await randomMissingAttempt.json());
    assertNoStore(foreignAttempt);
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: foreignComplete.id } })).status, "DRAFT");
    const forgedRequest = await publish(ownerPublish, noModules.id, "{}",
      `${courseUrl(noModules.id)}/publish?organizationId=${orgB}&tenantId=${orgB}`,
      { "x-organization-id": orgB, "x-tenant-id": orgB });
    assert.equal(forgedRequest.status, 409);
    assert.deepEqual((await json<{ issues: Array<{ code: string }> }>(forgedRequest)).issues, [{ code: "course_requires_module" }]);
    assertNoStore(forgedRequest);

    const constraintDraft = await createCourse(orgA, "Lifecycle constraint draft");
    await assert.rejects(db.$executeRaw`
      UPDATE "Course" SET "publishedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${constraintDraft.id}::uuid
    `, "PostgreSQL must reject DRAFT with publishedAt");
    const stillDraft = await db.course.findUniqueOrThrow({ where: { id: constraintDraft.id } });
    assert.equal(stillDraft.status, "DRAFT");
    assert.equal(stillDraft.publishedAt, null);
    await assert.rejects(db.$executeRaw`
      UPDATE "Course" SET "status" = 'PUBLISHED'
      WHERE "id" = ${constraintDraft.id}::uuid
    `, "PostgreSQL must reject PUBLISHED without publishedAt");
    const validPublishedAt = new Date();
    await db.$executeRaw`
      UPDATE "Course" SET "status" = 'PUBLISHED', "publishedAt" = ${validPublishedAt}
      WHERE "id" = ${constraintDraft.id}::uuid
    `;
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: constraintDraft.id } })).status, "PUBLISHED");
    const validDraft = await createCourse(orgA, "Valid lifecycle draft");
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: validDraft.id } })).publishedAt, null);

    const publishRace = await createCourse(orgA, "Concurrent publish requests");
    const publishRaceModule = await createModule(publishRace.id);
    await createLesson(publishRaceModule.id, "TEXT", 1, "Ready for publication");
    const parallelPublishes = await Promise.all([
      publish(ownerPublish, publishRace.id),
      publish(adminPublish, publishRace.id),
    ]);
    assert.deepEqual(parallelPublishes.map(({ status }) => status), [200, 200]);
    for (const response of parallelPublishes) assertNoStore(response);
    const raceTimestamp = (await db.course.findUniqueOrThrow({ where: { id: publishRace.id } })).publishedAt?.toISOString();
    assert.ok(raceTimestamp);
    const raceBodies = await Promise.all(parallelPublishes.map((response) => json<{ course: { publishedAt: string } }>(response)));
    assert.ok(raceBodies.every(({ course }) => course.publishedAt === raceTimestamp));

    const moduleLockRace = await createCourse(orgA, "Publish versus Module mutation");
    const existingRaceModule = await createModule(moduleLockRace.id);
    await createLesson(existingRaceModule.id, "TEXT", 1, "Existing complete content");
    let waitingModule: Promise<Response> | undefined;
    let waitingModulePublish: Promise<Response> | undefined;
    await db.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "status", "publishedAt" FROM "Course" WHERE "id" = ${moduleLockRace.id}::uuid AND "organizationId" = ${orgA}::uuid FOR UPDATE`;
      waitingModule = ownerModules.POST(
        request("POST", JSON.stringify({ title: "Race-created Module" }), moduleUrl(moduleLockRace.id)), moduleLockRace.id,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      waitingModulePublish = publish(ownerPublish, moduleLockRace.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.ok(waitingModule && waitingModulePublish);
    const moduleRaceResults = await Promise.all([waitingModule, waitingModulePublish]);
    assertNoStore(moduleRaceResults[0]);
    assertNoStore(moduleRaceResults[1]);
    const moduleRaceCourse = await db.course.findUniqueOrThrow({ where: { id: moduleLockRace.id } });
    if (moduleRaceResults[1].status === 200) {
      assert.equal(moduleRaceResults[0].status, 409);
      assert.equal(moduleRaceCourse.status, "PUBLISHED");
    } else {
      assert.equal(moduleRaceResults[1].status, 409);
      assert.equal(moduleRaceResults[0].status, 201);
      assert.equal(moduleRaceCourse.status, "DRAFT");
      assert.deepEqual((await json<{ issues: Array<{ code: string }> }>(moduleRaceResults[1])).issues.map(({ code }) => code), ["module_requires_lesson"]);
    }

    const lessonLockRace = await createCourse(orgA, "Publish versus Lesson mutation");
    const lessonLockModule = await createModule(lessonLockRace.id);
    const lessonLockLesson = await createLesson(lessonLockModule.id, "TEXT", 1, "Original valid content");
    let waitingLesson: Promise<Response> | undefined;
    let waitingLessonPublish: Promise<Response> | undefined;
    await db.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "status", "publishedAt" FROM "Course" WHERE "id" = ${lessonLockRace.id}::uuid AND "organizationId" = ${orgA}::uuid FOR UPDATE`;
      waitingLesson = ownerLessons.PUT_CONTENT(
        request("PUT", JSON.stringify({ text: "Written before publication" }), lessonUrl(lessonLockRace.id, lessonLockModule.id, lessonLockLesson.id, "/content")),
        lessonLockRace.id, lessonLockModule.id, lessonLockLesson.id,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      waitingLessonPublish = publish(ownerPublish, lessonLockRace.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.ok(waitingLesson && waitingLessonPublish);
    const lessonRaceResults = await Promise.all([waitingLesson, waitingLessonPublish]);
    assertNoStore(lessonRaceResults[0]);
    assertNoStore(lessonRaceResults[1]);
    assert.equal(lessonRaceResults[1].status, 200, await lessonRaceResults[1].clone().text());
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: lessonLockRace.id } })).status, "PUBLISHED");
    const contentAfterRace = (await db.lesson.findUniqueOrThrow({ where: { id: lessonLockLesson.id } })).textContent;
    if (lessonRaceResults[0].status === 200) {
      assert.equal(contentAfterRace, "Written before publication");
    } else {
      assert.equal(lessonRaceResults[0].status, 409);
      assert.equal(contentAfterRace, "Original valid content");
    }

    const deleteRaceCourse = await createCourse(orgA, "Publish versus Course deletion");
    const deleteRaceModule = await createModule(deleteRaceCourse.id);
    await createLesson(deleteRaceModule.id, "TEXT", 1, "Delete race content");
    const deleteAndPublish = await Promise.all([
      ownerCourses.DELETE(request("DELETE", null, courseUrl(deleteRaceCourse.id)), deleteRaceCourse.id),
      publish(ownerPublish, deleteRaceCourse.id),
    ]);
    for (const response of deleteAndPublish) assertNoStore(response);
    const afterDeleteRace = await db.course.findUnique({ where: { id: deleteRaceCourse.id } });
    if (deleteAndPublish[0].status === 200) {
      assert.equal(deleteAndPublish[1].status, 404);
      assert.equal(afterDeleteRace, null);
    } else {
      assert.equal(deleteAndPublish[0].status, 409);
      assert.equal(deleteAndPublish[1].status, 200);
      assert.equal(afterDeleteRace?.status, "PUBLISHED");
      assert.ok(afterDeleteRace?.publishedAt);
    }
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
    if (priorAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = priorAppUrl;
  }
});
