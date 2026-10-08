import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client.ts";
import { requireOrganizationPermission, type AuthorizationStore, type OrganizationPermission } from "../src/lib/authorization-core.ts";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";
import { createCoursePreviewHandlers } from "../src/lib/course-preview-core.ts";
import { createPrismaCoursePreviewStore } from "../src/lib/course-preview-prisma-store.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL Course Preview enforces hierarchy, permissions, tenant scope, and a consistent snapshot", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for Course Preview tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const store = createPrismaCoursePreviewStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
  };

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
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, membershipStore);
    },
    async requirePermission(organizationId: string, permission: OrganizationPermission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    store,
    logError: () => {},
  });
  const owner = createCoursePreviewHandlers(dependencies(asUser(users.ownerA)));
  const admin = createCoursePreviewHandlers(dependencies(asUser(users.adminA)));
  const member = createCoursePreviewHandlers(dependencies(asUser(users.memberA)));
  const ownerB = createCoursePreviewHandlers(dependencies(asUser(users.ownerB)));
  const anonymous = createCoursePreviewHandlers(dependencies(null));

  const courseUrl = (id: string) => `https://lms.example.test/api/organizations/courses/${id}/preview`;
  const request = (id: string, query = "", headers: Record<string, string> = {}) => new Request(
    `${courseUrl(id)}${query}`,
    { headers: { ...headers } },
  );
  const preview = (handlers: typeof owner, id: string, query = "", headers: Record<string, string> = {}) =>
    handlers.GET(request(id, query, headers), id);
  const assertNoStore = (response: Response) => assert.equal(response.headers.get("cache-control"), "no-store");
  const createCourse = (organizationId: string, title: string, status: "DRAFT" | "PUBLISHED" = "DRAFT") =>
    db.course.create({ data: {
      organizationId,
      title,
      status,
      publishedAt: status === "PUBLISHED" ? new Date("2026-10-01T12:30:00.000Z") : null,
    } });
  const createModule = (organizationId: string, courseId: string, position: number, title = `Module ${position}`) =>
    db.courseModule.create({ data: { organizationId, courseId, title, position } });
  const createLesson = (
    organizationId: string,
    moduleId: string,
    title: string,
    type: "TEXT" | "VIDEO" | "PDF" | "IMAGE" | "LINK" | "QUIZ",
    position: number,
    textContent: string | null = null,
    contentUrl: string | null = null,
  ) => db.lesson.create({ data: { organizationId, moduleId, title, type, position, textContent, contentUrl } });

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Course Preview Tenant A", slug: `${orgA}-preview-test` },
      { id: orgB, name: "Course Preview Tenant B", slug: `${orgB}-preview-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER" },
    ] });

    const draft = await createCourse(orgA, "Draft preview");
    const laterModule = await createModule(orgA, draft.id, 2, "Second module");
    const firstModule = await createModule(orgA, draft.id, 1, "First module");
    const secondText = await createLesson(orgA, firstModule.id, "Second text", "TEXT", 2, "Second line");
    const firstText = await createLesson(orgA, firstModule.id, "First text", "TEXT", 1, "First line\nSecond line");
    const video = await createLesson(orgA, firstModule.id, "Video resource", "VIDEO", 3, null, "https://video.example.test/watch");
    const pdf = await createLesson(orgA, laterModule.id, "PDF resource", "PDF", 1, null, "https://docs.example.test/guide.pdf");
    const image = await createLesson(orgA, laterModule.id, "Image resource", "IMAGE", 2, null, "https://images.example.test/diagram.png");
    const link = await createLesson(orgA, laterModule.id, "Link resource", "LINK", 3, null, "https://links.example.test/guide");
    const quiz = await createLesson(orgA, laterModule.id, "Quiz placeholder", "QUIZ", 4);

    for (const handlers of [owner, admin]) {
      const response = await preview(handlers, draft.id);
      assert.equal(response.status, 200, await response.clone().text());
      assertNoStore(response);
      const body = await response.json() as { course: {
        id: string;
        title: string;
        status: string;
        publishedAt: string | null;
        modules: Array<{ id: string; position: number; lessons: Array<Record<string, unknown>> }>;
      } };
      assert.equal(body.course.id, draft.id);
      assert.equal(body.course.title, "Draft preview");
      assert.equal(body.course.status, "DRAFT");
      assert.equal(body.course.publishedAt, null);
      assert.deepEqual(body.course.modules.map(({ id, position }) => [position, id]), [
        [1, firstModule.id], [2, laterModule.id],
      ]);
      const lessons = body.course.modules.flatMap(({ lessons }) => lessons);
      assert.deepEqual(lessons.map(({ id }) => id), [
        firstText.id, secondText.id, video.id, pdf.id, image.id, link.id, quiz.id,
      ]);
      assert.deepEqual(lessons.map(({ content }) => content), [
        { text: "First line\nSecond line" },
        { text: "Second line" },
        { url: "https://video.example.test/watch" },
        { url: "https://docs.example.test/guide.pdf" },
        { url: "https://images.example.test/diagram.png" },
        { url: "https://links.example.test/guide" },
        null,
      ]);
      assert.doesNotMatch(JSON.stringify(body), /organizationId|courseId|moduleId|textContent|contentUrl|createdAt|updatedAt/);
    }
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: draft.id } })).status, "DRAFT");

    const published = await createCourse(orgA, "Published preview", "PUBLISHED");
    const publishedResponse = await preview(owner, published.id);
    assert.equal(publishedResponse.status, 200);
    assertNoStore(publishedResponse);
    const publishedBody = await publishedResponse.json() as { course: { status: string; publishedAt: string | null } };
    assert.equal(publishedBody.course.status, "PUBLISHED");
    assert.equal(publishedBody.course.publishedAt, "2026-10-01T12:30:00.000Z");

    const emptyCourse = await createCourse(orgA, "No modules yet");
    const emptyModuleCourse = await createCourse(orgA, "Empty module");
    const emptyModule = await createModule(orgA, emptyModuleCourse.id, 1);
    const emptyCourseBody = await (await preview(owner, emptyCourse.id)).json() as { course: { modules: unknown[] } };
    assert.deepEqual(emptyCourseBody.course.modules, []);
    const emptyModuleBody = await (await preview(owner, emptyModuleCourse.id)).json() as {
      course: { modules: Array<{ id: string; lessons: unknown[] }> };
    };
    assert.deepEqual(emptyModuleBody.course.modules, [{
      id: emptyModule.id,
      title: "Module 1",
      description: null,
      position: 1,
      lessons: [],
    }]);

    const foreign = await createCourse(orgB, "Tenant B secret");
    const foreignAsA = await preview(owner, foreign.id, "?organizationId=" + orgB, { "x-organization-id": orgB, "x-tenant-id": orgB });
    const missing = await preview(owner, crypto.randomUUID());
    const malformed = await preview(owner, "malformed-id");
    for (const response of [foreignAsA, missing, malformed]) {
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "course_not_found" });
      assertNoStore(response);
    }
    const ownerBResponse = await preview(ownerB, foreign.id);
    assert.equal(ownerBResponse.status, 200);
    assertNoStore(ownerBResponse);

    const memberDenied = await preview(member, draft.id);
    assert.equal(memberDenied.status, 403);
    assert.deepEqual(await memberDenied.json(), { error: "forbidden" });
    assertNoStore(memberDenied);
    const anonymousDenied = await preview(anonymous, draft.id);
    assert.equal(anonymousDenied.status, 401);
    assert.deepEqual(await anonymousDenied.json(), { error: "unauthenticated" });
    assertNoStore(anonymousDenied);

    const snapshotCourse = await createCourse(orgA, "Before module");
    const snapshotModule = await createModule(orgA, snapshotCourse.id, 1, "Before module");
    const snapshotLesson = await createLesson(orgA, snapshotModule.id, "Before lesson", "TEXT", 1, "Before content");
    let announceSnapshot!: () => void;
    let continueRead!: () => void;
    const snapshotEstablished = new Promise<void>((resolve) => { announceSnapshot = resolve; });
    const continueSnapshotRead = new Promise<void>((resolve) => { continueRead = resolve; });
    const interceptingClient = {
      $transaction: (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>, options: unknown) =>
        db.$transaction(async (transaction) => {
          const findFirst = transaction.course.findFirst.bind(transaction.course);
          const intercepted = {
            course: {
              findFirst: async (...args: Parameters<typeof transaction.course.findFirst>) => {
                const result = await findFirst(...args);
                announceSnapshot();
                await continueSnapshotRead;
                return result;
              },
            },
            courseModule: transaction.courseModule,
            lesson: transaction.lesson,
          } as unknown as Prisma.TransactionClient;
          return callback(intercepted);
        }, options as { isolationLevel: Prisma.TransactionIsolationLevel }),
    } as unknown as PrismaClient;
    const snapshotStore = createPrismaCoursePreviewStore(interceptingClient);
    try {
      const previewBefore = snapshotStore.get(orgA, snapshotCourse.id);
      await snapshotEstablished;
      await db.$transaction(async (transaction) => {
        await transaction.courseModule.update({ where: { id: snapshotModule.id }, data: { title: "After module" } });
        await transaction.lesson.update({
          where: { id: snapshotLesson.id },
          data: { title: "After lesson", textContent: "After content" },
        });
      });
      continueRead();
      const snapshot = await previewBefore;
      assert.equal(snapshot?.modules[0]?.title, "Before module");
      assert.equal(snapshot?.modules[0]?.lessons[0]?.title, "Before lesson");
      assert.deepEqual(await store.get(orgA, snapshotCourse.id), {
        id: snapshotCourse.id,
        title: "Before module",
        description: null,
        status: "DRAFT",
        publishedAt: null,
        modules: [{
          id: snapshotModule.id,
          title: "After module",
          description: null,
          position: 1,
          lessons: [{
            id: snapshotLesson.id,
            title: "After lesson",
            type: "TEXT",
            position: 1,
            textContent: "After content",
            contentUrl: null,
          }],
        }],
      });
    } finally {
      continueRead();
    }
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
  }
});
