import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  isTrustedAuthRequest,
  readJsonBody,
  type AuthenticatedUser,
} from "../src/lib/auth-core.ts";
import {
  requireOrganizationPermission,
  type AuthorizationStore,
  type OrganizationPermission,
} from "../src/lib/authorization-core.ts";
import { createCourseHandlers } from "../src/lib/course-core.ts";
import { createPrismaCourseStore } from "../src/lib/course-prisma-store.ts";
import { createCourseModuleHandlers } from "../src/lib/course-module-core.ts";
import { createPrismaCourseModuleStore } from "../src/lib/course-module-prisma-store.ts";
import { createLessonHandlers } from "../src/lib/lesson-core.ts";
import { createPrismaLessonStore } from "../src/lib/lesson-prisma-store.ts";
import { createCoursePublishingHandlers } from "../src/lib/course-publishing-core.ts";
import { createPrismaCoursePublishingStore } from "../src/lib/course-publishing-prisma-store.ts";
import { createPrismaCoursePreviewStore } from "../src/lib/course-preview-prisma-store.ts";
import { createCoursePreviewHandlers } from "../src/lib/course-preview-core.ts";
import { loadManagedCourseBuilder } from "../src/lib/course-builder-core.ts";
import {
  createLessonRequest,
  createModuleRequest,
  deleteLessonRequest,
  deleteModuleRequest,
  moveLessonRequest,
  moveModuleRequest,
  publishCourseRequest,
  updateLessonContentRequest,
  updateLessonRequest,
  updateModuleRequest,
} from "../src/lib/course-builder-ui-core.ts";
import { createCourseRequest, deleteCourseRequest } from "../src/lib/course-management-core.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";
const appUrl = "https://lms.example.test";

test("Course Builder request contracts run the production Course, Module, Lesson, Preview and Publishing stores", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL Course Builder UI tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const courseStore = createPrismaCourseStore(db);
  const moduleStore = createPrismaCourseModuleStore(db);
  const lessonStore = createPrismaLessonStore(db);
  const publishingStore = createPrismaCoursePublishingStore(db);
  const previewStore = createPrismaCoursePreviewStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
  };
  const priorAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = appUrl;

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
  const asUser = (user: { id: string; email: string }): AuthenticatedUser => ({ ...user, name: null });
  const dependencies = (identity: AuthenticatedUser | null) => ({
    requireTenantContext() {
      return resolveTenantContext(identity, undefined, membershipStore);
    },
    requirePermission(organizationId: string, permission: OrganizationPermission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    isTrustedRequest: isTrustedAuthRequest,
    readBody: (request: Request) => readJsonBody(request, 128 * 1024),
    logError: () => {},
  });
  const coursesFor = (identity: AuthenticatedUser | null) => createCourseHandlers({ ...dependencies(identity), store: courseStore });
  const modulesFor = (identity: AuthenticatedUser | null) => createCourseModuleHandlers({ ...dependencies(identity), store: moduleStore });
  const lessonsFor = (identity: AuthenticatedUser | null) => createLessonHandlers({ ...dependencies(identity), store: lessonStore });
  const publishingFor = (identity: AuthenticatedUser | null) => createCoursePublishingHandlers({ ...dependencies(identity), store: publishingStore });
  const previewFor = (identity: AuthenticatedUser | null) => createCoursePreviewHandlers({
    requireTenantContext: dependencies(identity).requireTenantContext,
    requirePermission: dependencies(identity).requirePermission,
    store: previewStore,
    logError: () => {},
  });
  const request = (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set("origin", appUrl);
    return new Request(new URL(path, appUrl), { ...options, headers });
  };
  const withJson = (path: string, options: { method: string; credentials: "same-origin"; headers: { "Content-Type": "application/json" }; body: string }) =>
    request(path, options);
  const readCourse = async (response: Response) => (await response.json() as { course: { id: string; status: string; title: string } }).course;
  const coursePath = (id: string) => `/api/organizations/courses/${id}`;
  const modulePath = (courseId: string, moduleId: string) => `${coursePath(courseId)}/modules/${moduleId}`;
  const lessonPath = (courseId: string, moduleId: string, lessonId: string) => `${modulePath(courseId, moduleId)}/lessons/${lessonId}`;
  const createCourse = async (handler: ReturnType<typeof coursesFor>, title: string) => {
    const response = await handler.POST(withJson("/api/organizations/courses", createCourseRequest({ title, description: null })));
    assert.equal(response.status, 201, await response.clone().text());
    return readCourse(response);
  };
  const createModule = async (handler: ReturnType<typeof modulesFor>, courseId: string, title: string) => {
    const response = await handler.POST(withJson(`${coursePath(courseId)}/modules`, createModuleRequest({ title, description: null })), courseId);
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json() as { module: { id: string; position: number } }).module;
  };
  const createLesson = async (
    handler: ReturnType<typeof lessonsFor>, courseId: string, moduleId: string, title: string, type: "TEXT" | "VIDEO" | "QUIZ",
  ) => {
    const response = await handler.POST(withJson(`${modulePath(courseId, moduleId)}/lessons`, createLessonRequest(title, type)), courseId, moduleId);
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json() as { lesson: { id: string; position: number; title: string; type: string } }).lesson;
  };
  const saveContent = (handler: ReturnType<typeof lessonsFor>, courseId: string, moduleId: string, lessonId: string, body: { type: "TEXT"; text: string | null } | { type: "VIDEO"; url: string | null }) =>
    handler.PUT_CONTENT(withJson(`${lessonPath(courseId, moduleId, lessonId)}/content`, updateLessonContentRequest(body)), courseId, moduleId, lessonId);
  const publish = (handler: ReturnType<typeof publishingFor>, courseId: string) =>
    handler.POST(withJson(`${coursePath(courseId)}/publish`, publishCourseRequest()), courseId);
  const assertNoStore = (response: Response) => assert.equal(response.headers.get("cache-control"), "no-store");

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Builder Tenant A", slug: `${orgA}-builder-test` },
      { id: orgB, name: "Builder Tenant B", slug: `${orgB}-builder-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
    ] });

    const ownerIdentity = asUser(users.ownerA);
    const adminIdentity = asUser(users.adminA);
    const memberIdentity = asUser(users.memberA);
    const ownerBIdentity = asUser(users.ownerB);
    const ownerCourses = coursesFor(ownerIdentity);
    const ownerModules = modulesFor(ownerIdentity);
    const adminModules = modulesFor(adminIdentity);
    const memberModules = modulesFor(memberIdentity);
    const anonymousModules = modulesFor(null);
    const ownerLessons = lessonsFor(ownerIdentity);
    const adminLessons = lessonsFor(adminIdentity);
    const memberLessons = lessonsFor(memberIdentity);
    const ownerPublish = publishingFor(ownerIdentity);
    const adminPublish = publishingFor(adminIdentity);
    const memberPublish = publishingFor(memberIdentity);
    const ownerPreview = previewFor(ownerIdentity);
    const memberPreview = previewFor(memberIdentity);
    const anonymousPublish = publishingFor(null);

    const course = await createCourse(ownerCourses, "Course Builder vertical flow");
    assert.equal(course.status, "DRAFT");
    const moduleA = await createModule(ownerModules, course.id, "Module A");
    const moduleB = await createModule(ownerModules, course.id, "Module B");

    const editModule = await adminModules.PATCH(
      withJson(modulePath(course.id, moduleA.id), updateModuleRequest({ title: "Module A updated", description: "Edited through the Builder." })),
      course.id,
      moduleA.id,
    );
    assert.equal(editModule.status, 200, await editModule.clone().text());
    assert.equal((await editModule.json() as { module: { title: string } }).module.title, "Module A updated");
    const reorderModules = await ownerModules.MOVE(
      withJson(`${modulePath(course.id, moduleB.id)}/move`, moveModuleRequest(1)), course.id, moduleB.id,
    );
    assert.equal(reorderModules.status, 200, await reorderModules.clone().text());
    assert.equal((await reorderModules.json() as { module: { position: number } }).module.position, 1);
    const orderedModules = await ownerModules.GET_LIST(course.id);
    const orderIds = (await orderedModules.json() as { modules: Array<{ id: string; title: string; position: number }> }).modules;
    assert.deepEqual(orderIds.map(({ position }) => position), [1, 2]);
    assert.equal(orderIds[0]?.id, moduleB.id);
    assert.equal(orderIds[1]?.title, "Module A updated");

    const textLesson = await createLesson(ownerLessons, course.id, moduleA.id, "Read this", "TEXT");
    const videoLesson = await createLesson(ownerLessons, course.id, moduleA.id, "Watch this", "VIDEO");
    const otherLesson = await createLesson(ownerLessons, course.id, moduleB.id, "Module B lesson", "TEXT");
    assert.equal(textLesson.position, 1);
    assert.equal(videoLesson.position, 2);
    const textSaved = await saveContent(ownerLessons, course.id, moduleA.id, textLesson.id, { type: "TEXT", text: "First line\nSecond line" });
    assert.equal(textSaved.status, 200, await textSaved.clone().text());
    const videoSaved = await saveContent(ownerLessons, course.id, moduleA.id, videoLesson.id, { type: "VIDEO", url: "https://video.example.test/watch/1" });
    assert.equal(videoSaved.status, 200, await videoSaved.clone().text());
    const otherLessonSaved = await saveContent(ownerLessons, course.id, moduleB.id, otherLesson.id, { type: "TEXT", text: "Module B content" });
    assert.equal(otherLessonSaved.status, 200, await otherLessonSaved.clone().text());
    const titleEdited = await adminLessons.PATCH(
      withJson(lessonPath(course.id, moduleA.id, videoLesson.id), updateLessonRequest({ title: "Video lesson updated" })),
      course.id,
      moduleA.id,
      videoLesson.id,
    );
    assert.equal(titleEdited.status, 200, await titleEdited.clone().text());
    const movedLesson = await ownerLessons.MOVE(
      withJson(`${lessonPath(course.id, moduleA.id, videoLesson.id)}/move`, moveLessonRequest(1)),
      course.id,
      moduleA.id,
      videoLesson.id,
    );
    assert.equal(movedLesson.status, 200, await movedLesson.clone().text());

    const removedLesson = await createLesson(ownerLessons, course.id, moduleA.id, "Temporary lesson", "TEXT");
    const lessonDelete = await ownerLessons.DELETE(
      withJson(lessonPath(course.id, moduleA.id, removedLesson.id), deleteLessonRequest()),
      course.id,
      moduleA.id,
      removedLesson.id,
    );
    assert.equal(lessonDelete.status, 200, await lessonDelete.clone().text());
    assert.deepEqual(await lessonDelete.json(), { deleted: true });

    const temporaryModule = await createModule(ownerModules, course.id, "Temporary module");
    const temporaryModuleDelete = await ownerModules.DELETE(
      withJson(modulePath(course.id, temporaryModule.id), deleteModuleRequest()),
      course.id,
      temporaryModule.id,
    );
    assert.equal(temporaryModuleDelete.status, 200, await temporaryModuleDelete.clone().text());
    assert.deepEqual(await temporaryModuleDelete.json(), { deleted: true });

    const builderRead = await loadManagedCourseBuilder(course.id, {
      async requireTenantContext() { return resolveTenantContext(ownerIdentity, undefined, membershipStore); },
      async requirePermission(organizationId, permission) {
        return requireOrganizationPermission(ownerIdentity, organizationId, permission, membershipStore);
      },
      store: previewStore,
    });
    assert.equal(builderRead.kind, "ok");
    if (builderRead.kind !== "ok") throw new Error("Expected authorized Builder data");
    assert.equal(builderRead.course.status, "DRAFT");
    assert.deepEqual(builderRead.builder.modules.map(({ title }) => title), ["Module B", "Module A updated"]);
    assert.deepEqual(builderRead.builder.modules[1]?.lessons.map(({ title, position }) => ({ title, position })), [
      { title: "Video lesson updated", position: 1 },
      { title: "Read this", position: 2 },
    ]);
    assert.deepEqual(builderRead.builder.modules[1]?.lessons[1]?.content, { text: "First line\nSecond line" });
    assert.deepEqual(builderRead.builder.modules[0]?.lessons[0]?.content, { text: null });
    assertNoStore(await ownerPreview.GET(request(`${coursePath(course.id)}/preview`), course.id));

    const published = await publish(adminPublish, course.id);
    assert.equal(published.status, 200, await published.clone().text());
    assert.equal((await readCourse(published)).status, "PUBLISHED");
    const currentCourse = await db.course.findFirstOrThrow({ where: { id: course.id, organizationId: orgA } });
    assert.ok(currentCourse.publishedAt);
    const afterPublish = await loadManagedCourseBuilder(course.id, {
      async requireTenantContext() { return resolveTenantContext(ownerIdentity, undefined, membershipStore); },
      async requirePermission(organizationId, permission) {
        return requireOrganizationPermission(ownerIdentity, organizationId, permission, membershipStore);
      },
      store: previewStore,
    });
    assert.equal(afterPublish.kind, "ok");
    if (afterPublish.kind === "ok") assert.equal(afterPublish.builder.status, "PUBLISHED");
    const lockedModule = await ownerModules.POST(
      withJson(`${coursePath(course.id)}/modules`, createModuleRequest({ title: "Too late", description: null })), course.id,
    );
    assert.equal(lockedModule.status, 409);
    assert.deepEqual(await lockedModule.json(), { error: "published_course_structure_locked" });
    const lockedContent = await saveContent(ownerLessons, course.id, moduleA.id, textLesson.id, { type: "TEXT", text: "Attempt after publish" });
    assert.equal(lockedContent.status, 409);
    assert.deepEqual(await lockedContent.json(), { error: "published_course_structure_locked" });

    const noModules = await createCourse(ownerCourses, "No modules");
    const noModulesPublish = await publish(ownerPublish, noModules.id);
    assert.equal(noModulesPublish.status, 409);
    assert.equal((await noModulesPublish.json() as { issues: Array<{ code: string }> }).issues[0]?.code, "course_requires_module");

    const emptyModuleCourse = await createCourse(ownerCourses, "Empty module");
    const emptyModule = await createModule(ownerModules, emptyModuleCourse.id, "Empty module");
    const emptyModulePublish = await publish(ownerPublish, emptyModuleCourse.id);
    assert.equal(emptyModulePublish.status, 409);
    assert.equal((await emptyModulePublish.json() as { issues: Array<{ code: string; moduleId: string }> }).issues[0]?.code, "module_requires_lesson");

    const emptyTextCourse = await createCourse(ownerCourses, "Missing text");
    const emptyTextModule = await createModule(ownerModules, emptyTextCourse.id, "Text module");
    await createLesson(ownerLessons, emptyTextCourse.id, emptyTextModule.id, "Empty text", "TEXT");
    const emptyTextPublish = await publish(ownerPublish, emptyTextCourse.id);
    assert.equal(emptyTextPublish.status, 409);
    assert.ok((await emptyTextPublish.json() as { issues: Array<{ code: string }> }).issues.some(({ code }) => code === "lesson_content_missing"));

    const quizCourse = await createCourse(ownerCourses, "Quiz boundary");
    const quizModule = await createModule(ownerModules, quizCourse.id, "Quiz module");
    await createLesson(ownerLessons, quizCourse.id, quizModule.id, "Quiz lesson", "QUIZ");
    const quizPublish = await publish(ownerPublish, quizCourse.id);
    assert.equal(quizPublish.status, 409);
    assert.ok((await quizPublish.json() as { issues: Array<{ code: string }> }).issues.some(({ code }) => code === "quiz_not_configured"));

    const foreignCourse = await createCourse(coursesFor(ownerBIdentity), "Tenant B course");
    const foreignModule = await createModule(modulesFor(ownerBIdentity), foreignCourse.id, "Tenant B module");
    const foreignLesson = await createLesson(lessonsFor(ownerBIdentity), foreignCourse.id, foreignModule.id, "Tenant B lesson", "TEXT");
    assert.equal((await ownerCourses.GET_ONE(foreignCourse.id)).status, 404);
    const foreignCourseResponse = await ownerModules.GET_LIST(foreignCourse.id, request(`${coursePath(foreignCourse.id)}/modules?organizationId=${orgB}`, { headers: { "x-organization-id": orgB } }));
    assert.equal(foreignCourseResponse.status, 404);
    assert.equal((await ownerModules.GET_ONE(course.id, foreignModule.id)).status, 404);
    assert.equal((await ownerLessons.GET_ONE(course.id, moduleA.id, foreignLesson.id)).status, 404);
    const ignoredTenantOverride = await ownerModules.GET_LIST(course.id, request(`${coursePath(course.id)}/modules?organizationId=${orgB}`, { headers: { "x-organization-id": orgB } }));
    assert.equal(ignoredTenantOverride.status, 200);

    const memberCourse = await createCourse(ownerCourses, "Member access checks");
    const memberModule = await createModule(ownerModules, memberCourse.id, "Member module");
    const memberLesson = await createLesson(ownerLessons, memberCourse.id, memberModule.id, "Member lesson", "TEXT");
    assert.equal((await memberModules.POST(
      withJson(`${coursePath(memberCourse.id)}/modules`, createModuleRequest({ title: "Denied module", description: null })), memberCourse.id,
    )).status, 403);
    assert.equal((await anonymousModules.POST(
      withJson(`${coursePath(memberCourse.id)}/modules`, createModuleRequest({ title: "Anonymous module", description: null })), memberCourse.id,
    )).status, 401);
    assert.equal((await memberLessons.POST(
      withJson(`${modulePath(memberCourse.id, memberModule.id)}/lessons`, createLessonRequest("Denied lesson", "TEXT")), memberCourse.id, memberModule.id,
    )).status, 403);
    assert.equal((await lessonsFor(null).POST(
      withJson(`${modulePath(memberCourse.id, memberModule.id)}/lessons`, createLessonRequest("Anonymous lesson", "TEXT")), memberCourse.id, memberModule.id,
    )).status, 401);
    assert.equal((await memberLessons.PUT_CONTENT(
      withJson(`${lessonPath(memberCourse.id, memberModule.id, memberLesson.id)}/content`, updateLessonContentRequest({ type: "TEXT", text: "Denied" })), memberCourse.id, memberModule.id, memberLesson.id,
    )).status, 403);
    assert.equal((await memberPublish.POST(
      withJson(`${coursePath(memberCourse.id)}/publish`, publishCourseRequest()), memberCourse.id,
    )).status, 403);
    assert.equal((await memberPreview.GET(request(`${coursePath(memberCourse.id)}/preview`), memberCourse.id)).status, 403);
    assert.equal((await anonymousPublish.POST(
      withJson(`${coursePath(memberCourse.id)}/publish`, publishCourseRequest()), memberCourse.id,
    )).status, 401);

    const forgedModule = createModuleRequest({ title: "Only content fields", description: null });
    const forgedLesson = createLessonRequest("Only lesson fields", "TEXT");
    assert.doesNotMatch(forgedModule.body, /organizationId|tenantId/);
    assert.doesNotMatch(forgedLesson.body, /organizationId|tenantId|position|content/);
    assert.deepEqual(JSON.parse(deleteCourseRequest().body), {});
    assert.equal(await db.lesson.count({ where: { id: otherLesson.id, organizationId: orgA } }), 1);
    assert.equal(await db.courseModule.count({ where: { id: emptyModule.id, courseId: emptyModuleCourse.id, organizationId: orgA } }), 1);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    if (priorAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = priorAppUrl;
    await db.$disconnect();
  }
});
