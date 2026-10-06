import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationError, requireOrganizationPermission, type AuthorizationStore } from "../src/lib/authorization-core.ts";
import { readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  createCourseHandlers,
  isCourseId,
  parseCourseCreate,
  parseCourseUpdate,
  type Course,
  type CourseCreate,
  type CourseStore,
  type CourseUpdate,
} from "../src/lib/course-core.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const owner: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "owner@example.com",
  name: "Organization Owner",
};
const orgA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const orgB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const courseA = "380645db-557b-4d1d-b294-fc65c92da9d3";
const courseB = "f646453b-b600-461f-9b44-c5d236ecdd58";

type StoredCourse = Course & { organizationId: string };

function publicCourse(course: StoredCourse): Course {
  const { organizationId: _organizationId, ...result } = course;
  void _organizationId;
  return result;
}

class MemoryStore implements CourseStore {
  readonly courses = new Map<string, StoredCourse>();
  readonly scopes: Array<{ operation: string; organizationId: string; courseId?: string }> = [];
  private sequence = 0;

  async list(organizationId: string) {
    this.scopes.push({ operation: "list", organizationId });
    return [...this.courses.values()]
      .filter((course) => course.organizationId === organizationId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id))
      .slice(0, 100)
      .map(publicCourse);
  }

  async get(organizationId: string, courseId: string) {
    this.scopes.push({ operation: "get", organizationId, courseId });
    const course = this.courses.get(courseId);
    if (!course || course.organizationId !== organizationId) return null;
    return publicCourse(course);
  }

  async create(organizationId: string, input: CourseCreate) {
    this.scopes.push({ operation: "create", organizationId });
    const now = new Date();
    const id = `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`;
    const course: StoredCourse = { id, ...input, organizationId, status: "DRAFT", createdAt: now, updatedAt: now };
    this.courses.set(id, course);
    return publicCourse(course);
  }

  async update(organizationId: string, courseId: string, input: CourseUpdate) {
    this.scopes.push({ operation: "update", organizationId, courseId });
    const prior = this.courses.get(courseId);
    if (!prior || prior.organizationId !== organizationId) return null;
    const updated = { ...prior, ...input, updatedAt: new Date() };
    this.courses.set(courseId, updated);
    return publicCourse(updated);
  }

  async delete(organizationId: string, courseId: string) {
    this.scopes.push({ operation: "delete", organizationId, courseId });
    const course = this.courses.get(courseId);
    if (!course || course.organizationId !== organizationId) return "not_found" as const;
    if (course.status === "PUBLISHED") return "published" as const;
    this.courses.delete(courseId);
    return "deleted" as const;
  }
}

class IdentityStore implements TenantMembershipStore, AuthorizationStore {
  readonly roles = new Map<string, "OWNER" | "ADMIN" | "MEMBER">();
  setRole(userId: string, organizationId: string, role: "OWNER" | "ADMIN" | "MEMBER") {
    this.roles.set(`${userId}:${organizationId}`, role);
  }
  async findOrganizationRole(userId: string, organizationId: string) {
    return this.roles.get(`${userId}:${organizationId}`) ?? null;
  }
  async findDefaultOrganizationMembership(userId: string) {
    const membership = [...this.roles.entries()].find(([key]) => key.startsWith(`${userId}:`));
    if (!membership) return null;
    return { organizationId: membership[0].slice(userId.length + 1), role: membership[1] };
  }
}

function request(method: string, value?: unknown, url = "https://lms.example.test/api/organizations/courses") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "https://lms.example.test" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

function makeHandlers(
  store: MemoryStore,
  identity: AuthenticatedUser | null,
  memberships: IdentityStore,
  isTrustedRequest: (request: Request) => boolean = () => true,
) {
  return createCourseHandlers({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, memberships);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, memberships);
    },
    store,
    isTrustedRequest,
    readBody: (incoming) => readJsonBody(incoming, 20 * 1024),
    logError: () => {},
  });
}

function seedCourse(
  store: MemoryStore,
  id: string,
  organizationId: string,
  status: "DRAFT" | "PUBLISHED" = "DRAFT",
) {
  const now = new Date("2026-01-01T00:00:00.000Z");
  store.courses.set(id, {
    id,
    organizationId,
    title: "Safety Training",
    description: null,
    status,
    createdAt: now,
    updatedAt: now,
  });
}

function assertNoStore(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

test("title validation trims whitespace and counts Unicode code points", () => {
  assert.deepEqual(parseCourseCreate({ title: "  Safety Training  " }), {
    title: "Safety Training",
    description: null,
  });
  assert.equal(parseCourseCreate({ title: "😀" }), null);
  assert.equal(parseCourseCreate({ title: "😀😀" })?.title, "😀😀");
  assert.equal(parseCourseCreate({ title: "x".repeat(160) })?.title.length, 160);
  assert.equal(parseCourseCreate({ title: "x".repeat(161) }), null);
  assert.equal(parseCourseCreate({ title: "  " }), null);
  assert.equal(parseCourseCreate({ title: "Safety\u0000Training" }), null);
  assert.equal(parseCourseCreate({ title: "Safety\u0085Training" }), null);
  assert.equal(parseCourseCreate({ title: `A\ud800B` }), null);
});

test("description is optional, nullable, trimmed, plain text, and limited to 4000 code points", () => {
  assert.deepEqual(parseCourseCreate({ title: "Safety" }), { title: "Safety", description: null });
  assert.deepEqual(parseCourseCreate({ title: "Safety", description: null }), { title: "Safety", description: null });
  assert.deepEqual(parseCourseCreate({ title: "Safety", description: "  " }), { title: "Safety", description: null });
  assert.deepEqual(parseCourseCreate({ title: "Safety", description: "  Fire safety  " }), {
    title: "Safety",
    description: "Fire safety",
  });
  assert.equal(parseCourseCreate({ title: "Safety", description: "😀".repeat(4000) })?.description?.length, 8000);
  assert.equal(parseCourseCreate({ title: "Safety", description: "😀".repeat(4001) }), null);
  assert.equal(parseCourseCreate({ title: "Safety", description: "bad\u0007text" }), null);
  assert.equal(parseCourseCreate({ title: "Safety", description: `bad\udffftext` }), null);
});

test("strict create and PATCH allowlists reject status, tenant data, metadata, and unknown fields", () => {
  for (const extra of [
    "status", "organizationId", "tenantId", "id", "createdAt", "updatedAt", "publishedAt", "ownerId", "createdBy", "unknown",
  ]) {
    assert.equal(parseCourseCreate({ title: "Safety", [extra]: orgB }), null, `create accepted ${extra}`);
    assert.equal(parseCourseUpdate({ title: "New Title", [extra]: orgB }), null, `PATCH accepted ${extra}`);
  }
  assert.deepEqual(parseCourseUpdate({ title: "  New Title  " }), { title: "New Title" });
  assert.deepEqual(parseCourseUpdate({ description: null }), { description: null });
  assert.deepEqual(parseCourseUpdate({ description: "  " }), { description: null });
  assert.equal(parseCourseUpdate({}), null);
  assert.equal(parseCourseUpdate({ title: undefined }), null);
  assert.equal(parseCourseCreate({ title: "Safety", description: undefined }), null);
});

test("malformed course IDs fail the same not-found path", async () => {
  assert.equal(isCourseId(courseA), true);
  assert.equal(isCourseId("not-a-uuid"), false);
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const handlers = makeHandlers(new MemoryStore(), owner, memberships);
  assert.deepEqual(await (await handlers.GET_ONE("not-a-uuid")).json(), { error: "course_not_found" });
  assert.equal((await handlers.GET_ONE("not-a-uuid")).status, 404);
  assert.equal((await handlers.PATCH(request("PATCH", { title: "Updated" }), "bad-id")).status, 404);
  assert.equal((await handlers.DELETE(request("DELETE"), "bad-id")).status, 404);
});

test("MANAGE_COURSES permits OWNER and ADMIN and denies MEMBER for every CRUD action", async () => {
  for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
    const memberships = new IdentityStore();
    memberships.setRole(owner.id, orgA, role);
    const store = new MemoryStore();
    seedCourse(store, courseA, orgA);
    const handlers = makeHandlers(store, owner, memberships);
    const allowed = role !== "MEMBER";

    assert.equal((await handlers.GET()).status, allowed ? 200 : 403);
    assert.equal((await handlers.GET_ONE(courseA)).status, allowed ? 200 : 403);
    assert.equal((await handlers.POST(request("POST", { title: "New Course" }))).status, allowed ? 201 : 403);
    assert.equal((await handlers.PATCH(request("PATCH", { title: "Updated" }), courseA)).status, allowed ? 200 : 403);
    assert.equal((await handlers.DELETE(request("DELETE"), courseA)).status, allowed ? 200 : 403);
  }
});

test("anonymous requests are denied across Course CRUD", async () => {
  const memberships = new IdentityStore();
  const handlers = makeHandlers(new MemoryStore(), null, memberships);
  assert.equal((await handlers.GET()).status, 401);
  assert.equal((await handlers.GET_ONE(courseA)).status, 401);
  assert.equal((await handlers.POST(request("POST", { title: "New Course" }))).status, 401);
  assert.equal((await handlers.PATCH(request("PATCH", { title: "Updated" }), courseA)).status, 401);
  assert.equal((await handlers.DELETE(request("DELETE"), courseA)).status, 401);
});

test("course tenant scope ignores forged query and organization headers", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  seedCourse(store, courseA, orgA);
  seedCourse(store, courseB, orgB);
  const handlers = makeHandlers(store, owner, memberships);
  const url = `https://lms.example.test/api/organizations/courses?organizationId=${orgB}&tenantId=${orgB}`;
  const forged = new Request(url, { headers: { "x-organization-id": orgB, "x-tenant-id": orgB } });
  const list = await handlers.GET(forged);
  assert.deepEqual((await list.json() as { courses: Course[] }).courses.map(({ id }) => id), [courseA]);
  assert.equal(store.scopes[0]?.organizationId, orgA);
});

test("foreign and missing Course IDs have identical safe GET, PATCH, and DELETE results", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  seedCourse(store, courseA, orgA);
  seedCourse(store, courseB, orgB);
  const handlers = makeHandlers(store, owner, memberships);

  const foreignGet = await handlers.GET_ONE(courseB);
  const missingGet = await handlers.GET_ONE("ee16d3c5-4161-43ef-9df0-296e7ba8a46d");
  assert.equal(foreignGet.status, 404);
  assert.deepEqual(await foreignGet.json(), await missingGet.json());
  assert.equal((await handlers.PATCH(request("PATCH", { title: "Stolen" }), courseB)).status, 404);
  assert.equal((await handlers.DELETE(request("DELETE"), courseB)).status, 404);
  assert.equal(store.courses.get(courseB)?.title, "Safety Training");
  assert.equal(store.courses.has(courseB), true);
  assert.deepEqual(store.scopes.filter(({ courseId }) => courseId === courseB).map(({ organizationId }) => organizationId), [orgA, orgA, orgA]);
});

test("status and tenant fields cannot be written through handlers", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  const handlers = makeHandlers(store, owner, memberships);
  for (const key of ["status", "organizationId", "tenantId"]) {
    assert.equal((await handlers.POST(request("POST", { title: "Safety", [key]: orgB }))).status, 400);
    assert.equal((await handlers.PATCH(request("PATCH", { [key]: "PUBLISHED" }), courseA)).status, 400);
  }
  assert.equal(store.courses.size, 0);
});

test("draft deletion succeeds and published deletion maps to a stable conflict", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  seedCourse(store, courseA, orgA, "DRAFT");
  seedCourse(store, courseB, orgA, "PUBLISHED");
  const handlers = makeHandlers(store, owner, memberships);
  assert.equal((await handlers.DELETE(request("DELETE"), courseA)).status, 200);
  assert.equal(store.courses.has(courseA), false);
  const published = await handlers.DELETE(request("DELETE"), courseB);
  assert.equal(published.status, 409);
  assert.deepEqual(await published.json(), { error: "published_course_delete_forbidden" });
  assert.equal(store.courses.get(courseB)?.status, "PUBLISHED");
});

test("mutation routes require a trusted same-origin JSON request", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  seedCourse(store, courseA, orgA);
  const handlers = makeHandlers(store, owner, memberships, () => false);
  assert.equal((await handlers.POST(request("POST", { title: "Nope" }))).status, 403);
  assert.equal((await handlers.PATCH(request("PATCH", { title: "Nope" }), courseA)).status, 403);
  assert.equal((await handlers.DELETE(request("DELETE"), courseA)).status, 403);
  assert.equal(store.courses.size, 1);
});

test("Course responses consistently disable caching and omit organizationId", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  seedCourse(store, courseA, orgA);
  const handlers = makeHandlers(store, owner, memberships);
  const detail = await handlers.GET_ONE(courseA);
  for (const response of [
    await handlers.GET(),
    detail,
    await handlers.POST(request("POST", { title: "Created Course" })),
    await handlers.PATCH(request("PATCH", { description: "Updated" }), courseA),
    await handlers.GET_ONE("invalid"),
    await handlers.DELETE(request("DELETE"), courseA),
  ]) {
    assertNoStore(response);
  }
  assert.equal("organizationId" in (await detail.json() as { course: object }).course, false);
});

test("authorization and database failures use safe generic responses", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  store.list = async () => { throw new Error("postgres://secret/db: constraint data"); };
  const handlers = makeHandlers(store, owner, memberships);
  const failed = await handlers.GET();
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "course_management_unavailable" });

  const unavailable = createCourseHandlers({
    requireTenantContext: async () => { throw new AuthorizationError("authorization_unavailable"); },
    requirePermission: async () => undefined,
    store,
    isTrustedRequest: () => true,
    readBody: async () => null,
    logError: () => {},
  });
  const authFailure = await unavailable.GET();
  assert.equal(authFailure.status, 503);
  assert.deepEqual(await authFailure.json(), { error: "authorization_unavailable" });
});
