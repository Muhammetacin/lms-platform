import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { requireOrganizationPermission, type AuthorizationStore } from "../src/lib/authorization-core.ts";
import { isTrustedAuthRequest, readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import { createCourseHandlers, type Course, type CourseStore } from "../src/lib/course-core.ts";
import { createPrismaCourseStore } from "../src/lib/course-prisma-store.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL Course CRUD enforces management access, tenant scope, validation, and draft deletion", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL Course CRUD tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const store = createPrismaCourseStore(db);
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
  const makeHandlers = (identity: AuthenticatedUser | null, courseStore: CourseStore = store) => createCourseHandlers({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, membershipStore);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    store: courseStore,
    isTrustedRequest: isTrustedAuthRequest,
    readBody: (request) => readJsonBody(request, 20 * 1024),
    logError: () => {},
  });
  const request = (
    method: string,
    value?: unknown,
    url = "https://lms.example.test/api/organizations/courses",
  ) => new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "https://lms.example.test" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const json = async <T>(response: Response) => await response.json() as T;
  const assertNoStore = (response: Response) => assert.equal(response.headers.get("cache-control"), "no-store");

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Course CRUD Tenant A", slug: `${orgA}-course-crud-test` },
      { id: orgB, name: "Course CRUD Tenant B", slug: `${orgB}-course-crud-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
    ] });

    const ownerA = makeHandlers(asUser(users.ownerA));
    const adminA = makeHandlers(asUser(users.adminA));
    const memberA = makeHandlers(asUser(users.memberA));
    const ownerB = makeHandlers(asUser(users.ownerB));
    const anonymous = makeHandlers(null);

    const createdResponse = await ownerA.POST(request("POST", { title: "  Safety Training  " }));
    assert.equal(createdResponse.status, 201);
    assertNoStore(createdResponse);
    const created = (await json<{ course: Course }>(createdResponse)).course;
    assert.equal(created.title, "Safety Training");
    assert.equal(created.description, null);
    assert.equal(created.status, "DRAFT");
    assert.equal(created.publishedAt, null);
    assert.equal("organizationId" in created, false);
    const persistedCreated = await db.course.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(persistedCreated.organizationId, orgA);
    assert.equal(persistedCreated.status, "DRAFT");

    const adminCreatedResponse = await adminA.POST(request("POST", { title: "Admin Course", description: "  " }));
    assert.equal(adminCreatedResponse.status, 201);
    assertNoStore(adminCreatedResponse);
    const adminCourse = (await json<{ course: Course }>(adminCreatedResponse)).course;
    assert.equal(adminCourse.description, null);
    assert.equal(adminCourse.publishedAt, null);
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: adminCourse.id } })).organizationId, orgA);
    assert.equal((await memberA.POST(request("POST", { title: "Member denied" }))).status, 403);

    for (const rejected of [
      { title: "Client status", status: "PUBLISHED" },
      { title: "Forged organization", organizationId: orgB },
      { title: "Forged tenant", tenantId: orgB },
    ]) {
      const response = await ownerA.POST(request("POST", rejected));
      assert.equal(response.status, 400);
      assertNoStore(response);
    }
    assert.equal((await ownerA.POST(request("POST", { title: "😀" }))).status, 400);
    assert.equal((await ownerA.POST(request("POST", { title: "😀😀" }))).status, 201);
    assert.equal((await ownerA.POST(request("POST", { title: "x".repeat(160) }))).status, 201);
    assert.equal((await ownerA.POST(request("POST", { title: "x".repeat(161) }))).status, 400);
    assert.equal((await ownerA.POST(request("POST", { title: "Control\u0000Character" }))).status, 400);
    assert.equal((await ownerA.POST(request("POST", { title: "C1\u009fCharacter" }))).status, 400);
    assert.equal((await ownerA.POST(request("POST", { title: `Surrogate\ud800` }))).status, 400);
    assert.equal((await ownerA.POST(request("POST", { title: "Description test", description: "😀".repeat(4000) }))).status, 201);
    assert.equal((await ownerA.POST(request("POST", { title: "Description too long", description: "d".repeat(4001) }))).status, 400);
    assert.equal((await ownerA.POST(request("POST", { title: "Description controls", description: "bad\u0007text" }))).status, 400);
    assert.equal((await ownerA.POST(request("POST", { title: "Description surrogate", description: `bad\udffftext` }))).status, 400);

    const duplicateA1 = await ownerA.POST(request("POST", { title: "Duplicate Title" }));
    const duplicateA2 = await ownerA.POST(request("POST", { title: "Duplicate Title" }));
    assert.equal(duplicateA1.status, 201);
    assert.equal(duplicateA2.status, 201);
    const duplicateB = await ownerB.POST(request("POST", { title: "Duplicate Title" }));
    assert.equal(duplicateB.status, 201);
    const identicalConcurrent = await Promise.all([
      ownerA.POST(request("POST", { title: "Concurrent Duplicate" })),
      adminA.POST(request("POST", { title: "Concurrent Duplicate" })),
    ]);
    assert.deepEqual(identicalConcurrent.map(({ status }) => status), [201, 201]);
    assert.equal(await db.course.count({ where: { organizationId: orgA, title: "Concurrent Duplicate" } }), 2);

    const foreignCourse = await db.course.create({ data: {
      organizationId: orgB,
      title: "Tenant B private course",
      description: "Must survive every Tenant A attack",
    } });
    const publishedCourse = await db.course.create({ data: {
      organizationId: orgA,
      title: "Published course",
      status: "PUBLISHED",
      publishedAt: new Date(),
    } });

    const listResponse = await ownerA.GET();
    assert.equal(listResponse.status, 200);
    assertNoStore(listResponse);
    const listA = (await json<{ courses: Course[] }>(listResponse)).courses;
    assert.equal((await memberA.GET()).status, 403);
    assert.equal(listA.length <= 100, true);
    assert.equal(listA.some(({ id }) => id === foreignCourse.id), false);
    assert.equal(listA.some(({ id }) => id === created.id), true);
    assert.equal(listA.find(({ id }) => id === created.id)?.publishedAt, null);
    for (let index = 1; index < listA.length; index += 1) {
      const previous = listA[index - 1]!;
      const current = listA[index]!;
      const previousDate = Date.parse(previous.createdAt.toString());
      const currentDate = Date.parse(current.createdAt.toString());
      assert.ok(previousDate > currentDate || (previousDate === currentDate && previous.id > current.id));
    }
    const forgedQuery = new Request(
      `https://lms.example.test/api/organizations/courses?organizationId=${orgB}&tenantId=${orgB}`,
      { headers: { "x-organization-id": orgB, "x-tenant-id": orgB } },
    );
    const forgedList = await ownerA.GET(forgedQuery);
    assert.equal((await json<{ courses: Course[] }>(forgedList)).courses.some(({ id }) => id === foreignCourse.id), false);

    const detailResponse = await ownerA.GET_ONE(created.id);
    assert.equal(detailResponse.status, 200);
    assertNoStore(detailResponse);
    const detail = (await json<{ course: Course }>(detailResponse)).course;
    assert.equal(detail.publishedAt, null);
    assert.equal("organizationId" in detail, false);
    assert.equal((await adminA.GET_ONE(adminCourse.id)).status, 200);
    assert.equal((await memberA.GET_ONE(created.id)).status, 403);
    const foreignRead = await ownerA.GET_ONE(foreignCourse.id);
    const missingRead = await ownerA.GET_ONE(crypto.randomUUID());
    const malformedRead = await ownerA.GET_ONE("not-a-uuid");
    assert.equal(foreignRead.status, 404);
    const foreignReadBody = await foreignRead.json();
    assert.deepEqual(foreignReadBody, await missingRead.json());
    assert.deepEqual(foreignReadBody, await malformedRead.json());

    const updatedResponse = await adminA.PATCH(request("PATCH", {
      title: "  Updated Safety Training  ",
      description: "  Updated details  ",
    }), created.id);
    assert.equal(updatedResponse.status, 200);
    assertNoStore(updatedResponse);
    const updated = (await json<{ course: Course }>(updatedResponse)).course;
    assert.equal(updated.title, "Updated Safety Training");
    assert.equal(updated.description, "Updated details");
    assert.equal(updated.status, "DRAFT");
    assert.equal(updated.publishedAt, null);
    const cleared = await ownerA.PATCH(request("PATCH", { description: null }), created.id);
    assert.equal((await json<{ course: Course }>(cleared)).course.description, null);
    assert.equal((await ownerA.PATCH(request("PATCH", {}), created.id)).status, 400);
    assert.equal((await ownerA.PATCH(request("PATCH", { unknown: "field" }), created.id)).status, 400);
    assert.equal((await ownerA.PATCH(request("PATCH", { status: "PUBLISHED" }), created.id)).status, 400);
    assert.equal((await ownerA.PATCH(request("PATCH", { organizationId: orgB }), created.id)).status, 400);
    assert.equal((await ownerA.PATCH(request("PATCH", { tenantId: orgB }), created.id)).status, 400);
    const foreignPatch = await ownerA.PATCH(request("PATCH", { title: "Stolen" }), foreignCourse.id);
    const missingPatch = await ownerA.PATCH(request("PATCH", { title: "Stolen" }), crypto.randomUUID());
    assert.equal(foreignPatch.status, 404);
    assert.deepEqual(await foreignPatch.json(), await missingPatch.json());
    assert.equal((await memberA.PATCH(request("PATCH", { title: "Member edit" }), created.id)).status, 403);
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: foreignCourse.id } })).title, "Tenant B private course");

    const publishedMetadataUpdate = await adminA.PATCH(request("PATCH", { title: "Published metadata updated" }), publishedCourse.id);
    assert.equal(publishedMetadataUpdate.status, 200);
    const publishedMetadataCourse = (await json<{ course: Course }>(publishedMetadataUpdate)).course;
    assert.equal(publishedMetadataCourse.status, "PUBLISHED");
    assert.equal(publishedMetadataCourse.publishedAt?.toISOString(), publishedCourse.publishedAt?.toISOString());

    const moduleDeletedWithCourse = await db.courseModule.create({
      data: {
        organizationId: orgA,
        courseId: created.id,
        title: "Course delete cascade regression",
        position: 1,
      },
    });
    const draftDeleteResponse = await ownerA.DELETE(request("DELETE"), created.id);
    assert.equal(draftDeleteResponse.status, 200);
    assertNoStore(draftDeleteResponse);
    assert.equal(await db.course.findUnique({ where: { id: created.id } }), null);
    assert.equal(await db.courseModule.findUnique({ where: { id: moduleDeletedWithCourse.id } }), null,
      "LMS-019 DRAFT Course deletion must continue to cascade its LMS-020 Modules");
    const publishedDelete = await ownerA.DELETE(request("DELETE"), publishedCourse.id);
    assert.equal(publishedDelete.status, 409);
    assertNoStore(publishedDelete);
    assert.deepEqual(await publishedDelete.json(), { error: "published_course_delete_forbidden" });
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: publishedCourse.id } })).status, "PUBLISHED");
    const foreignDelete = await ownerA.DELETE(request("DELETE"), foreignCourse.id);
    const missingDelete = await ownerA.DELETE(request("DELETE"), crypto.randomUUID());
    assert.equal(foreignDelete.status, 404);
    assert.deepEqual(await foreignDelete.json(), await missingDelete.json());
    assert.equal((await memberA.DELETE(request("DELETE"), adminCourse.id)).status, 403);
    const persistedB = await db.course.findUniqueOrThrow({ where: { id: foreignCourse.id } });
    assert.equal(persistedB.organizationId, orgB);
    assert.equal(persistedB.title, "Tenant B private course");
    assert.equal(persistedB.description, "Must survive every Tenant A attack");

    const failingStore: CourseStore = {
      ...store,
      async list() {
        throw new Error("postgres://secret/database connection and constraint detail");
      },
    };
    const failedList = await makeHandlers(asUser(users.ownerA), failingStore).GET();
    assert.equal(failedList.status, 503);
    assert.deepEqual(await failedList.json(), { error: "course_management_unavailable" });

    const racedCourse = await db.course.create({ data: { organizationId: orgA, title: "Concurrent publish guard" } });
    const [raceDelete, racePublish] = await Promise.all([
      ownerA.DELETE(request("DELETE"), racedCourse.id),
      db.course.updateMany({
        where: { id: racedCourse.id, organizationId: orgA, status: "DRAFT" },
        data: { status: "PUBLISHED", publishedAt: new Date() },
      }),
    ]);
    if (racePublish.count === 1) {
      assert.equal(raceDelete.status, 409);
      assert.equal((await db.course.findUniqueOrThrow({ where: { id: racedCourse.id } })).status, "PUBLISHED");
    } else {
      assert.equal(raceDelete.status, 200);
      assert.equal(await db.course.findUnique({ where: { id: racedCourse.id } }), null);
    }

    const listFixtures = Array.from({ length: 105 }, (_, index) => ({
      id: crypto.randomUUID(),
      organizationId: orgA,
      title: `List ordering fixture ${index}`,
      description: null,
      status: "DRAFT" as const,
      createdAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)),
    }));
    await db.course.createMany({ data: listFixtures });
    const boundedList = await ownerA.GET();
    const boundedCourses = (await json<{ courses: Course[] }>(boundedList)).courses;
    assert.equal(boundedCourses.length, 100);
    assert.equal(boundedCourses.some(({ id }) => id === foreignCourse.id), false);

    for (const response of [
      await anonymous.GET(),
      await anonymous.GET_ONE(created.id),
      await anonymous.POST(request("POST", { title: "No identity" })),
      await anonymous.PATCH(request("PATCH", { title: "No identity" }), created.id),
      await anonymous.DELETE(request("DELETE"), created.id),
    ]) {
      assert.equal(response.status, 401);
      assertNoStore(response);
    }
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    if (priorAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = priorAppUrl;
    await db.$disconnect();
  }
});
