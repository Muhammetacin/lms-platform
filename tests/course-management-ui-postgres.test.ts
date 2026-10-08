import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  requireOrganizationPermission,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import {
  isTrustedAuthRequest,
  readJsonBody,
  type AuthenticatedUser,
} from "../src/lib/auth-core.ts";
import { createCourseHandlers, type Course, type CourseStore } from "../src/lib/course-core.ts";
import { createPrismaCourseStore } from "../src/lib/course-prisma-store.ts";
import { createPrismaAdminPortalStore } from "../src/lib/admin-portal-prisma-store.ts";
import { createCourseRequest, deleteCourseRequest, updateCourseRequest } from "../src/lib/course-management-core.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";
const appUrl = "https://lms.example.test";

test("Course management UI request contracts use production handlers and tenant-scoped PostgreSQL stores", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL Course Management UI tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const courseStore = createPrismaCourseStore(db);
  const portalStore = createPrismaAdminPortalStore(db);
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
  const handlersFor = (identity: AuthenticatedUser | null, store: CourseStore = courseStore) => createCourseHandlers({
    requireTenantContext() {
      return resolveTenantContext(identity, undefined, membershipStore);
    },
    requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    store,
    isTrustedRequest: isTrustedAuthRequest,
    readBody: (request) => readJsonBody(request, 20 * 1024),
    logError: () => {},
  });
  const withOrigin = (path: string, options: ReturnType<typeof createCourseRequest>) => {
    const headers = new Headers(options.headers);
    headers.set("origin", appUrl);
    return new Request(new URL(path, appUrl), { ...options, headers });
  };
  const readCourse = async (response: Response) => (await response.json() as { course: Course }).course;

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Course UI Tenant A", slug: `${orgA}-course-ui-test` },
      { id: orgB, name: "Course UI Tenant B", slug: `${orgB}-course-ui-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
    ] });

    const ownerA = handlersFor(asUser(users.ownerA));
    const adminA = handlersFor(asUser(users.adminA));
    const memberA = handlersFor(asUser(users.memberA));
    const ownerB = handlersFor(asUser(users.ownerB));

    const createRequest = withOrigin("/api/organizations/courses", createCourseRequest({
      title: "Safety from the UI",
      description: null,
    }));
    assert.equal(createRequest.method, "POST");
    const createdResponse = await ownerA.POST(createRequest);
    assert.equal(createdResponse.status, 201);
    const created = await readCourse(createdResponse);
    assert.equal(created.status, "DRAFT");
    assert.equal(created.description, null);
    assert.equal("organizationId" in created, false);
    assert.equal((await db.course.findUniqueOrThrow({ where: { id: created.id } })).organizationId, orgA);

    const draftList = await ownerA.GET();
    assert.equal(draftList.status, 200);
    assert.equal((await draftList.json() as { courses: Course[] }).courses.some(({ id }) => id === created.id), true);
    const tenantBList = await ownerB.GET();
    assert.equal((await tenantBList.json() as { courses: Course[] }).courses.some(({ id }) => id === created.id), false);
    assert.equal((await memberA.GET()).status, 403);

    const updateOptions = updateCourseRequest({ title: "Updated from the UI", description: "Edited details" });
    assert.equal(updateOptions.method, "PATCH");
    const updatedResponse = await adminA.PATCH(
      withOrigin(`/api/organizations/courses/${created.id}`, updateOptions),
      created.id,
    );
    assert.equal(updatedResponse.status, 200);
    const updated = await readCourse(updatedResponse);
    assert.equal(updated.title, "Updated from the UI");
    assert.equal(updated.description, "Edited details");
    assert.equal(updated.status, "DRAFT");

    const published = await db.course.create({
      data: {
        organizationId: orgA,
        title: "Published metadata",
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    const publishedUpdate = await ownerA.PATCH(
      withOrigin(`/api/organizations/courses/${published.id}`, updateCourseRequest({
        title: "Published metadata updated",
        description: "Metadata stays editable after publishing",
      })),
      published.id,
    );
    assert.equal(publishedUpdate.status, 200);
    assert.equal((await readCourse(publishedUpdate)).status, "PUBLISHED");

    const foreign = await db.course.create({ data: { organizationId: orgB, title: "Tenant B private" } });
    assert.equal((await ownerA.GET_ONE(foreign.id)).status, 404);
    assert.equal((await ownerB.GET_ONE(foreign.id)).status, 200);

    const deleteOptions = deleteCourseRequest();
    assert.equal(deleteOptions.method, "DELETE");
    assert.equal(deleteOptions.body, "{}");
    const deletedResponse = await ownerA.DELETE(
      withOrigin(`/api/organizations/courses/${created.id}`, deleteOptions),
      created.id,
    );
    assert.equal(deletedResponse.status, 200);
    assert.deepEqual(await deletedResponse.json(), { deleted: true });
    assert.equal(await db.course.findFirst({ where: { id: created.id, organizationId: orgA } }), null);

    const refreshedList = await ownerA.GET();
    assert.equal((await refreshedList.json() as { courses: Course[] }).courses.some(({ id }) => id === created.id), false);
    assert.deepEqual(await portalStore.getCourseCounts(orgA), { total: 1, draft: 0, published: 1 });

    const publishedDelete = await adminA.DELETE(
      withOrigin(`/api/organizations/courses/${published.id}`, deleteOptions),
      published.id,
    );
    assert.equal(publishedDelete.status, 409);
    assert.deepEqual(await publishedDelete.json(), { error: "published_course_delete_forbidden" });
    assert.equal((await db.course.findFirst({ where: { id: published.id, organizationId: orgA } }))?.status, "PUBLISHED");
    assert.deepEqual(await portalStore.getCourseCounts(orgA), { total: 1, draft: 0, published: 1 });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    if (priorAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = priorAppUrl;
    await db.$disconnect();
  }
});
