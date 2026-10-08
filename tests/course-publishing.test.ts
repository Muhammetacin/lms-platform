import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationError, type OrganizationPermission } from "../src/lib/authorization-core.ts";
import { readJsonBody } from "../src/lib/auth-core.ts";
import type { Course } from "../src/lib/course-core.ts";
import {
  createCoursePublishingHandlers,
  parseCoursePublishBody,
  type CoursePublishResult,
  type CoursePublishingStore,
} from "../src/lib/course-publishing-core.ts";
import { TenantContextError } from "../src/lib/tenant-context-core.ts";

const orgA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const orgB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const courseId = "380645db-557b-4d1d-b294-fc65c92da9d3";
const course: Course = {
  id: courseId,
  title: "Safety Training",
  description: null,
  status: "PUBLISHED",
  publishedAt: new Date("2026-10-08T12:00:00.000Z"),
  createdAt: new Date("2026-10-01T12:00:00.000Z"),
  updatedAt: new Date("2026-10-08T12:00:00.000Z"),
};

class StubStore implements CoursePublishingStore {
  result: CoursePublishResult = { kind: "published", course };
  calls: Array<{ organizationId: string; courseId: string }> = [];
  async publish(organizationId: string, id: string) {
    this.calls.push({ organizationId, courseId: id });
    return this.result;
  }
}

function request(body: string | undefined = "{}", extraHeaders: Record<string, string> = {}) {
  return new Request(`https://lms.example.test/api/organizations/courses/${courseId}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://lms.example.test", ...extraHeaders },
    ...(body === undefined ? {} : { body }),
  });
}

function handlersFor(
  store: CoursePublishingStore = new StubStore(),
  role: "OWNER" | "ADMIN" | "MEMBER" | "ANONYMOUS" = "OWNER",
  trusted = true,
) {
  return createCoursePublishingHandlers({
    requireTenantContext: async () => {
      if (role === "ANONYMOUS") throw new TenantContextError("unauthenticated");
      return { userId: courseId, organizationId: orgA, role };
    },
    requirePermission: async (_organizationId: string, permission: OrganizationPermission) => {
      assert.equal(permission, "MANAGE_COURSES");
      if (role === "MEMBER") throw new AuthorizationError("forbidden");
    },
    store,
    isTrustedRequest: () => trusted,
    readBody: (incoming) => readJsonBody(incoming, 1024),
    logError: () => {},
  });
}

function assertNoStore(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

test("publish accepts only an exact empty JSON object", () => {
  assert.equal(parseCoursePublishBody({}), true);
  for (const value of [null, [], { status: "PUBLISHED" }, { publishedAt: "2026-10-08" }, "{}", 0]) {
    assert.equal(parseCoursePublishBody(value), false);
  }
});

test("OWNER and ADMIN can publish through MANAGE_COURSES; MEMBER and anonymous callers cannot", async () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    const store = new StubStore();
    const response = await handlersFor(store, role).POST(request(), courseId);
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { course: { publishedAt: string } }).course.publishedAt, course.publishedAt?.toISOString());
    assert.deepEqual(store.calls, [{ organizationId: orgA, courseId }]);
    assertNoStore(response);
  }

  const member = await handlersFor(new StubStore(), "MEMBER").POST(request(), courseId);
  assert.equal(member.status, 403);
  assert.deepEqual(await member.json(), { error: "forbidden" });
  assertNoStore(member);

  const anonymous = await handlersFor(new StubStore(), "ANONYMOUS").POST(request(), courseId);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: "unauthenticated" });
  assertNoStore(anonymous);
});

test("malformed IDs, bad bodies, and untrusted requests fail safely without publishing", async () => {
  const store = new StubStore();
  const handlers = handlersFor(store);
  const malformed = await handlers.POST(request(), "not-a-uuid");
  assert.equal(malformed.status, 404);
  assert.deepEqual(await malformed.json(), { error: "course_not_found" });
  assert.equal(store.calls.length, 0);
  assertNoStore(malformed);

  for (const body of ["", "null", "[]", '{"status":"PUBLISHED"}', '{"organizationId":"' + orgB + '"}']) {
    const response = await handlers.POST(request(body), courseId);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
    assertNoStore(response);
  }
  assert.equal(store.calls.length, 0);

  const untrusted = await handlersFor(store, "OWNER", false).POST(request(), courseId);
  assert.equal(untrusted.status, 403);
  assert.deepEqual(await untrusted.json(), { error: "invalid_request" });
  assertNoStore(untrusted);
});

test("missing and foreign Courses share the safe not-found mapping", async () => {
  const store = new StubStore();
  store.result = { kind: "not_found" };
  const handlers = handlersFor(store);
  const foreign = await handlers.POST(request(), courseId);
  const missing = await handlers.POST(request(), "ee16d3c5-4161-43ef-9df0-296e7ba8a46d");
  assert.equal(foreign.status, 404);
  assert.deepEqual(await foreign.json(), await missing.json());
  assert.deepEqual(store.calls, [
    { organizationId: orgA, courseId },
    { organizationId: orgA, courseId: "ee16d3c5-4161-43ef-9df0-296e7ba8a46d" },
  ]);
  assertNoStore(foreign);
  assertNoStore(missing);
});

test("completeness issues and truncation use the stable 409 response", async () => {
  const store = new StubStore();
  store.result = {
    kind: "not_publishable",
    issues: [
      { code: "module_requires_lesson", moduleId: "module-1" },
      { code: "lesson_content_missing", moduleId: "module-2", lessonId: "lesson-1", type: "TEXT" },
    ],
    truncated: true,
  };
  const response = await handlersFor(store).POST(request(), courseId);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "course_not_publishable",
    issues: store.result.issues,
    truncated: true,
  });
  assertNoStore(response);
});

test("store failures return a generic safe error", async () => {
  const store: CoursePublishingStore = {
    async publish() { throw new Error("postgres://secret database URL and SQL details"); },
  };
  const response = await handlersFor(store).POST(request(), courseId);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "course_publishing_unavailable" });
  assertNoStore(response);
});
