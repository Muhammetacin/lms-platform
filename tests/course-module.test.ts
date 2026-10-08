import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationError, requireOrganizationPermission, type AuthorizationStore } from "../src/lib/authorization-core.ts";
import { readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  createCourseModuleHandlers,
  isCourseModuleId,
  parseCourseModuleCreate,
  parseCourseModuleMove,
  parseCourseModuleUpdate,
  type CourseModule,
  type CourseModuleCreate,
  type CourseModuleMutation,
  type CourseModuleStore,
  type CourseModuleUpdate,
} from "../src/lib/course-module-core.ts";
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
const moduleA = "a932dbbe-1096-4f75-9f26-e3e2a0b61a10";
const moduleB = "ac1c58fc-718d-44c6-886c-5fe39e859806";

type StoredModule = CourseModule & { organizationId: string; courseId: string };
const courseKey = (organizationId: string, courseId: string) => `${organizationId}:${courseId}`;
const publicModule = ({ organizationId: _organizationId, courseId: _courseId, ...courseModule }: StoredModule) => {
  void _organizationId;
  void _courseId;
  return courseModule;
};

class MemoryStore implements CourseModuleStore {
  readonly courses = new Map<string, "DRAFT" | "PUBLISHED">();
  readonly modules = new Map<string, StoredModule>();
  readonly scopes: Array<{ operation: string; organizationId: string; courseId?: string; moduleId?: string }> = [];
  private sequence = 20;

  addCourse(organizationId: string, courseId: string, status: "DRAFT" | "PUBLISHED" = "DRAFT") {
    this.courses.set(courseKey(organizationId, courseId), status);
  }

  addModule(organizationId: string, courseId: string, id: string, position: number, title = `Module ${position}`) {
    const now = new Date("2026-10-08T00:00:00.000Z");
    const stored: StoredModule = {
      id, organizationId, courseId, title, description: null, position, createdAt: now, updatedAt: now,
    };
    this.modules.set(id, stored);
  }

  async courseExists(organizationId: string, courseId: string) {
    this.scopes.push({ operation: "courseExists", organizationId, courseId });
    return this.courses.has(courseKey(organizationId, courseId));
  }

  async list(organizationId: string, courseId: string) {
    this.scopes.push({ operation: "list", organizationId, courseId });
    if (!this.courses.has(courseKey(organizationId, courseId))) return null;
    return [...this.modules.values()]
      .filter((module) => module.organizationId === organizationId && module.courseId === courseId)
      .sort((a, b) => a.position - b.position)
      .map(publicModule);
  }

  async get(organizationId: string, courseId: string, moduleId: string) {
    this.scopes.push({ operation: "get", organizationId, courseId, moduleId });
    const courseModule = this.modules.get(moduleId);
    if (!courseModule || courseModule.organizationId !== organizationId || courseModule.courseId !== courseId) return null;
    return publicModule(courseModule);
  }

  async create(organizationId: string, courseId: string, input: CourseModuleCreate) {
    this.scopes.push({ operation: "create", organizationId, courseId });
    const status = this.courses.get(courseKey(organizationId, courseId));
    if (!status) return { kind: "course_not_found" } as const;
    if (status === "PUBLISHED") return { kind: "published_course_structure_locked" } as const;
    const position = [...this.modules.values()].filter((module) => module.organizationId === organizationId && module.courseId === courseId).length + 1;
    const now = new Date();
    const created: StoredModule = {
      id: `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`,
      ...input, organizationId, courseId, position, createdAt: now, updatedAt: now,
    };
    this.modules.set(created.id, created);
    return { kind: "ok", value: publicModule(created) } as const;
  }

  async update(organizationId: string, courseId: string, moduleId: string, input: CourseModuleUpdate): Promise<CourseModuleMutation<CourseModule>> {
    this.scopes.push({ operation: "update", organizationId, courseId, moduleId });
    const status = this.courses.get(courseKey(organizationId, courseId));
    if (!status) return { kind: "course_not_found" };
    if (status === "PUBLISHED") return { kind: "published_course_structure_locked" };
    const prior = this.modules.get(moduleId);
    if (!prior || prior.organizationId !== organizationId || prior.courseId !== courseId) return { kind: "module_not_found" };
    const updated = { ...prior, ...input, updatedAt: new Date() };
    this.modules.set(moduleId, updated);
    return { kind: "ok", value: publicModule(updated) };
  }

  async move(organizationId: string, courseId: string, moduleId: string, position: number): Promise<CourseModuleMutation<CourseModule>> {
    this.scopes.push({ operation: "move", organizationId, courseId, moduleId });
    const status = this.courses.get(courseKey(organizationId, courseId));
    if (!status) return { kind: "course_not_found" };
    if (status === "PUBLISHED") return { kind: "published_course_structure_locked" };
    const modules = [...this.modules.values()]
      .filter((module) => module.organizationId === organizationId && module.courseId === courseId)
      .sort((a, b) => a.position - b.position);
    const moving = this.modules.get(moduleId);
    if (!moving || moving.organizationId !== organizationId || moving.courseId !== courseId) return { kind: "module_not_found" };
    if (position < 1 || position > modules.length) return { kind: "invalid_position" };
    const oldPosition = moving.position;
    for (const courseModule of modules) {
      if (courseModule.id === moduleId) continue;
      if (oldPosition < position && courseModule.position > oldPosition && courseModule.position <= position) courseModule.position -= 1;
      if (position < oldPosition && courseModule.position >= position && courseModule.position < oldPosition) courseModule.position += 1;
    }
    moving.position = position;
    return { kind: "ok", value: publicModule(moving) };
  }

  async delete(organizationId: string, courseId: string, moduleId: string): Promise<CourseModuleMutation<true>> {
    this.scopes.push({ operation: "delete", organizationId, courseId, moduleId });
    const status = this.courses.get(courseKey(organizationId, courseId));
    if (!status) return { kind: "course_not_found" };
    if (status === "PUBLISHED") return { kind: "published_course_structure_locked" };
    const deleting = this.modules.get(moduleId);
    if (!deleting || deleting.organizationId !== organizationId || deleting.courseId !== courseId) return { kind: "module_not_found" };
    this.modules.delete(moduleId);
    for (const courseModule of this.modules.values()) {
      if (courseModule.organizationId === organizationId && courseModule.courseId === courseId && courseModule.position > deleting.position) courseModule.position -= 1;
    }
    return { kind: "ok", value: true };
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
  store: CourseModuleStore,
  identity: AuthenticatedUser | null,
  memberships: IdentityStore,
  trustedRequest: (request: Request) => boolean = () => true,
) {
  return createCourseModuleHandlers({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, memberships);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, memberships);
    },
    store,
    isTrustedRequest: trustedRequest,
    readBody: (incoming) => readJsonBody(incoming, 20 * 1024),
    logError: () => {},
  });
}

function setUp() {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  memberships.setRole("a64cc1d9-2919-4a18-a253-9854962edc94", orgA, "ADMIN");
  memberships.setRole("b17b8ddf-ad75-48bb-850a-175362aab5dc", orgA, "MEMBER");
  const store = new MemoryStore();
  store.addCourse(orgA, courseA);
  store.addCourse(orgA, courseB);
  store.addCourse(orgB, courseA);
  store.addModule(orgA, courseA, moduleA, 1, "Introduction");
  store.addModule(orgA, courseA, moduleB, 2, "Introduction");
  return { store, memberships, ownerHandlers: makeHandlers(store, owner, memberships) };
}

test("Course Module validation enforces Unicode lengths, controls, and strict request allowlists", () => {
  assert.equal(parseCourseModuleCreate({ title: " AB " })?.title, "AB");
  assert.equal(parseCourseModuleCreate({ title: "😀😀" })?.title, "😀😀");
  assert.equal(parseCourseModuleCreate({ title: "😀" }), null);
  assert.equal(parseCourseModuleCreate({ title: "x" }), null);
  assert.equal(parseCourseModuleCreate({ title: "A\u0000B" }), null);
  assert.equal(parseCourseModuleCreate({ title: "\ud800x" }), null);
  assert.equal(parseCourseModuleCreate({ title: "a".repeat(160) })?.title.length, 160);
  assert.equal(parseCourseModuleCreate({ title: "a".repeat(161) }), null);
  assert.deepEqual(parseCourseModuleCreate({ title: "Introduction", description: "  Notes  " }), {
    title: "Introduction", description: "Notes",
  });
  assert.deepEqual(parseCourseModuleCreate({ title: "Introduction", description: "  " }), {
    title: "Introduction", description: null,
  });
  assert.deepEqual(parseCourseModuleCreate({ title: "Introduction", description: null }), {
    title: "Introduction", description: null,
  });
  assert.equal(parseCourseModuleCreate({ title: "Introduction", description: "a".repeat(4001) }), null);
  assert.equal(parseCourseModuleCreate({ title: "Introduction", description: "x\u007f" }), null);
  for (const key of ["position", "courseId", "organizationId", "tenantId", "id", "createdAt", "updatedAt", "status", "moduleId"]) {
    assert.equal(parseCourseModuleCreate({ title: "Introduction", [key]: "forged" }), null, key);
  }
  assert.deepEqual(parseCourseModuleUpdate({ description: null }), { description: null });
  assert.equal(parseCourseModuleUpdate({}), null);
  assert.equal(parseCourseModuleUpdate({ position: 2 }), null);
  assert.equal(parseCourseModuleUpdate({ organizationId: orgB, title: "Edited" }), null);
  assert.equal(parseCourseModuleUpdate({ title: "x" }), null);
});

test("Course Module move body and route identifiers reject malformed values", () => {
  assert.equal(isCourseModuleId(moduleA), true);
  assert.equal(isCourseModuleId("not-a-uuid"), false);
  assert.equal(parseCourseModuleMove({ position: 2 }), 2);
  assert.equal(parseCourseModuleMove({ position: 0 }), null);
  assert.equal(parseCourseModuleMove({ position: 1.5 }), null);
  assert.equal(parseCourseModuleMove({ position: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(parseCourseModuleMove({ position: 2, organizationId: orgB }), null);
});

test("OWNER and ADMIN may list Course Modules while MEMBER and anonymous users are denied", async () => {
  const { store, memberships, ownerHandlers } = setUp();
  const admin = makeHandlers(store, { id: "a64cc1d9-2919-4a18-a253-9854962edc94", email: "admin@example.com", name: null }, memberships);
  const member = makeHandlers(store, { id: "b17b8ddf-ad75-48bb-850a-175362aab5dc", email: "member@example.com", name: null }, memberships);
  const anonymous = makeHandlers(store, null, memberships);
  assert.equal((await ownerHandlers.GET_LIST(courseA)).status, 200);
  assert.equal((await admin.GET_LIST(courseA)).status, 200);
  assert.equal((await member.GET_LIST(courseA)).status, 403);
  assert.equal((await anonymous.GET_LIST(courseA)).status, 401);
});

test("Course Module access always scopes tenant and parent Course and hides foreign or malformed IDs", async () => {
  const { store, ownerHandlers } = setUp();
  const crossCourse = await ownerHandlers.GET_ONE(courseB, moduleA);
  const malformedModule = await ownerHandlers.GET_ONE(courseA, "bad-id");
  const malformedCourse = await ownerHandlers.GET_LIST("bad-id");
  assert.equal(crossCourse.status, 404);
  assert.deepEqual(await crossCourse.json(), { error: "module_not_found" });
  assert.deepEqual(await malformedModule.json(), { error: "module_not_found" });
  assert.deepEqual(await malformedCourse.json(), { error: "course_not_found" });
  assert.equal((await ownerHandlers.GET_ONE(courseA, "00000000-0000-4000-8000-999999999999")).status, 404);
  assert.ok(store.scopes.every((scope) => scope.organizationId === orgA));
  assert.ok(store.scopes.filter((scope) => scope.moduleId).every((scope) => scope.courseId === courseB || scope.courseId === courseA));
});

test("Course Module mutations return stable published lock and strict validation errors", async () => {
  const { store, ownerHandlers } = setUp();
  store.addCourse(orgA, "90d285f3-9c88-48fb-8f88-d29d073fba77", "PUBLISHED");
  const create = await ownerHandlers.POST(request("POST", { title: "No" }), "90d285f3-9c88-48fb-8f88-d29d073fba77");
  assert.equal(create.status, 409);
  assert.deepEqual(await create.json(), { error: "published_course_structure_locked" });
  assert.equal((await ownerHandlers.PATCH(request("PATCH", { position: 1 }), courseA, moduleA)).status, 400);
  assert.equal((await ownerHandlers.MOVE(request("POST", { position: 1, tenantId: orgB }), courseA, moduleA)).status, 400);
  assert.equal((await ownerHandlers.POST(request("POST", { title: "Ok", organizationId: orgB }), courseA)).status, 400);
});

test("trusted mutation checks and no-store responses apply to all Course Module endpoints", async () => {
  const { store, memberships } = setUp();
  const handlers = makeHandlers(store, owner, memberships, () => false);
  assert.equal((await handlers.POST(request("POST", { title: "A New Module" }), courseA)).status, 403);
  assert.equal((await handlers.PATCH(request("PATCH", { title: "Updated" }), courseA, moduleA)).status, 403);
  assert.equal((await handlers.MOVE(request("POST", { position: 2 }), courseA, moduleA)).status, 403);
  assert.equal((await handlers.DELETE(request("DELETE"), courseA, moduleA)).status, 403);

  const { ownerHandlers } = setUp();
  const responses = [
    await ownerHandlers.GET_LIST(courseA),
    await ownerHandlers.GET_ONE(courseA, moduleA),
    await ownerHandlers.POST(request("POST", { title: "A New Module" }), courseA),
    await ownerHandlers.PATCH(request("PATCH", { title: "Updated" }), courseA, moduleA),
    await ownerHandlers.MOVE(request("POST", { position: 1 }), courseA, moduleA),
    await ownerHandlers.DELETE(request("DELETE"), courseA, moduleB),
  ];
  assert.ok(responses.every((response) => response.headers.get("cache-control") === "no-store"));
  const detail = await responses[1]!.json() as { module: Record<string, unknown> };
  assert.equal("organizationId" in detail.module, false);
  assert.equal("courseId" in detail.module, false);
});

test("authorization and database failures map to safe generic responses", async () => {
  const { ownerHandlers, memberships } = setUp();
  const failedPermission = createCourseModuleHandlers({
    async requireTenantContext() { return resolveTenantContext(owner, undefined, memberships); },
    async requirePermission() { throw new AuthorizationError("authorization_unavailable"); },
    store: new MemoryStore(),
    isTrustedRequest: () => true,
    readBody: (incoming) => readJsonBody(incoming),
    logError: () => {},
  });
  assert.deepEqual(await (await failedPermission.GET_LIST(courseA)).json(), { error: "authorization_unavailable" });
  const unavailable = createCourseModuleHandlers({
    async requireTenantContext() { return resolveTenantContext(owner, undefined, memberships); },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(owner, organizationId, permission, memberships);
    },
    store: {
      async courseExists() { throw new Error("database connection string and SQL must remain private"); },
      async list() { throw new Error("unreachable"); },
      async get() { throw new Error("unreachable"); },
      async create() { throw new Error("unreachable"); },
      async update() { throw new Error("unreachable"); },
      async move() { throw new Error("unreachable"); },
      async delete() { throw new Error("unreachable"); },
    },
    isTrustedRequest: () => true,
    readBody: (incoming) => readJsonBody(incoming),
    logError: () => {},
  });
  const response = await unavailable.GET_ONE(courseA, moduleA);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "course_module_management_unavailable" });
  void ownerHandlers;
});
