import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationError, type OrganizationPermission } from "../src/lib/authorization-core.ts";
import { readJsonBody } from "../src/lib/auth-core.ts";
import {
  createLessonHandlers,
  isLessonBuilderId,
  parseLessonContent,
  parseLessonCreate,
  parseLessonMove,
  parseLessonTextContent,
  parseLessonUpdate,
  parseLessonUrl,
  type LessonMutation,
  type LessonRecord,
  type LessonStore,
} from "../src/lib/lesson-core.ts";
import { TenantContextError } from "../src/lib/tenant-context-core.ts";

const orgId = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const courseId = "380645db-557b-4d1d-b294-fc65c92da9d3";
const moduleId = "a932dbbe-1096-4f75-9f26-e3e2a0b61a10";
const lessonId = "ac1c58fc-718d-44c6-886c-5fe39e859806";

const lesson: LessonRecord = {
  id: lessonId,
  title: "Introduction",
  type: "TEXT",
  position: 1,
  textContent: null,
  contentUrl: null,
  createdAt: new Date("2026-10-08T00:00:00.000Z"),
  updatedAt: new Date("2026-10-08T00:00:00.000Z"),
};

class StubStore implements LessonStore {
  listResult: Awaited<ReturnType<LessonStore["list"]>> = { kind: "ok", value: [] };
  getResult: Awaited<ReturnType<LessonStore["get"]>> = { kind: "ok", value: lesson };
  mutationResult: LessonMutation<LessonRecord> = { kind: "ok", value: lesson };
  deleteResult: LessonMutation<true> = { kind: "ok", value: true };
  lastContentBody: unknown;

  async list() { return this.listResult; }
  async get() { return this.getResult; }
  async create() { return this.mutationResult; }
  async update() { return this.mutationResult; }
  async move() { return this.mutationResult; }
  async delete() { return this.deleteResult; }
  async updateContent(_organizationId: string, _courseId: string, _moduleId: string, _lessonId: string, body: unknown) {
    this.lastContentBody = body;
    return this.mutationResult;
  }
}

function handlersFor(store: LessonStore = new StubStore(), role: "OWNER" | "ADMIN" | "MEMBER" | "ANONYMOUS" = "OWNER") {
  return createLessonHandlers({
    requireTenantContext: async () => {
      if (role === "ANONYMOUS") throw new TenantContextError("unauthenticated");
      return { userId: lessonId, organizationId: orgId, role };
    },
    requirePermission: async (_organizationId: string, permission: OrganizationPermission) => {
      assert.equal(permission, "MANAGE_COURSES");
      if (role === "MEMBER") throw new AuthorizationError("forbidden");
    },
    store,
    isTrustedRequest: () => true,
    readBody: (request) => readJsonBody(request, 512 * 1024),
    logError: () => {},
  });
}

function request(method: string, body?: unknown) {
  return new Request("https://lms.example.test/api", {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function payload(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function assertNoStore(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

test("Lesson Builder validates IDs, titles, exact types, and strict mutation allowlists", () => {
  assert.equal(isLessonBuilderId(courseId), true);
  assert.equal(isLessonBuilderId("malformed-id"), false);
  assert.deepEqual(parseLessonCreate({ title: "  Intro  ", type: "TEXT" }), { title: "Intro", type: "TEXT" });
  assert.equal(parseLessonCreate({ title: "Intro" }), null, "type is required");
  assert.equal(parseLessonCreate({ title: "Intro", type: "text" }), null, "type is exact and case-sensitive");
  for (const type of ["TEXT", "VIDEO", "PDF", "IMAGE", "LINK", "QUIZ"]) {
    assert.deepEqual(parseLessonCreate({ title: "Intro", type }), { title: "Intro", type });
  }
  assert.equal(parseLessonCreate({ title: "Intro", type: "TEXT", position: 1 }), null);
  for (const field of ["organizationId", "tenantId", "courseId", "moduleId", "id", "textContent", "contentUrl", "createdAt", "updatedAt", "status"]) {
    assert.equal(parseLessonCreate({ title: "Intro", type: "TEXT", [field]: "forged" }), null, `${field} is rejected`);
  }
  assert.deepEqual(parseLessonUpdate({ title: "  Renamed " }), { title: "Renamed" });
  assert.deepEqual(parseLessonUpdate({ type: "VIDEO" }), { type: "VIDEO" });
  assert.equal(parseLessonUpdate({}), null);
  assert.equal(parseLessonUpdate({ position: 2 }), null);
  assert.equal(parseLessonUpdate({ moduleId }), null);
  assert.equal(parseLessonUpdate({ title: "ok", type: "OTHER" }), null);
  assert.equal(parseLessonMove({ position: 3 }), 3);
  for (const input of [{ position: 0 }, { position: 1.5 }, { position: Number.MAX_SAFE_INTEGER + 1 }, { position: 2, title: "x" }, null]) {
    assert.equal(parseLessonMove(input), null);
  }
});

test("Lesson title validation counts Unicode code points and rejects controls and unpaired surrogates", () => {
  assert.deepEqual(parseLessonCreate({ title: " 🚀x ", type: "TEXT" }), { title: "🚀x", type: "TEXT" });
  assert.equal(parseLessonCreate({ title: "x", type: "TEXT" }), null);
  assert.equal(parseLessonCreate({ title: `a${"b".repeat(160)}`, type: "TEXT" }), null);
  assert.equal(parseLessonCreate({ title: `a${"b".repeat(159)}`, type: "TEXT" })?.title.length, 160);
  assert.equal(parseLessonCreate({ title: "ab\ncd", type: "TEXT" }), null);
  assert.equal(parseLessonCreate({ title: "ab\ud800", type: "TEXT" }), null);
});

test("TEXT content preserves formatting, normalizes line endings, and enforces text limits", () => {
  assert.deepEqual(parseLessonTextContent("  first\r\nsecond\rthird  "), { valid: true, value: "  first\nsecond\nthird  " });
  assert.deepEqual(parseLessonTextContent(" \n\t "), { valid: true, value: null });
  assert.deepEqual(parseLessonTextContent(null), { valid: true, value: null });
  assert.equal(parseLessonTextContent("a\u0000b").valid, false);
  assert.equal(parseLessonTextContent("a\u000bb").valid, false);
  assert.deepEqual(parseLessonTextContent("a\tb\nc"), { valid: true, value: "a\tb\nc" });
  assert.equal(parseLessonTextContent("x".repeat(100_001)).valid, false);
  const unicodeLimit = parseLessonTextContent("😀".repeat(100_000));
  assert.equal(unicodeLimit.valid, true);
  if (unicodeLimit.valid) assert.equal([...unicodeLimit.value!].length, 100_000);
  assert.equal(parseLessonTextContent("\udfff").valid, false);
  assert.deepEqual(parseLessonContent("TEXT", { text: "body" }), { textContent: "body", contentUrl: null });
  assert.deepEqual(parseLessonContent("TEXT", { text: null }), { textContent: null, contentUrl: null });
  assert.equal(parseLessonContent("TEXT", { text: "body", url: "https://example.test" }), null);
  assert.equal(parseLessonContent("TEXT", { url: "https://example.test" }), null);
});

test("URL content accepts only absolute HTTPS URLs without credentials and within limits", () => {
  assert.deepEqual(parseLessonUrl("  https://example.com/path  "), { valid: true, value: "https://example.com/path" });
  assert.deepEqual(parseLessonUrl("  "), { valid: true, value: null });
  assert.deepEqual(parseLessonUrl(null), { valid: true, value: null });
  for (const invalid of [
    "/relative", "http://example.com", "javascript:alert(1)", "data:text/plain,x", "file:///tmp/a", "ftp://example.com",
    "https://user:pass@example.com", "https://user@example.com", "https://@example.com", "https://example.com/" + "x".repeat(2048),
    "https://example.com/line\nbreak", "https://example.com/bad\ud800",
  ]) assert.equal(parseLessonUrl(invalid).valid, false, invalid.slice(0, 40));
  assert.deepEqual(parseLessonContent("VIDEO", { url: "https://video.example.test/v" }), {
    textContent: null, contentUrl: "https://video.example.test/v",
  });
  for (const type of ["VIDEO", "PDF", "IMAGE", "LINK"] as const) {
    assert.deepEqual(parseLessonContent(type, { url: null }), { textContent: null, contentUrl: null });
    assert.equal(parseLessonContent(type, { text: "not a url" }), null);
  }
  assert.equal(parseLessonContent("QUIZ", { text: "x" }), null);
});

test("handlers scope safe errors and return no-store responses", async () => {
  const store = new StubStore();
  const handlers = handlersFor(store);
  store.listResult = { kind: "course_not_found" };
  const missingCourse = await handlers.GET_LIST(courseId, moduleId);
  assert.equal(missingCourse.status, 404);
  assert.deepEqual(await payload(missingCourse), { error: "course_not_found" });
  assertNoStore(missingCourse);

  store.listResult = { kind: "module_not_found" };
  const missingModule = await handlers.GET_LIST(courseId, "malformed-module");
  assert.equal(missingModule.status, 404);
  assert.deepEqual(await payload(missingModule), { error: "module_not_found" });
  assertNoStore(missingModule);

  store.getResult = { kind: "lesson_not_found" };
  const missingLesson = await handlers.GET_ONE(courseId, moduleId, "malformed-lesson");
  assert.equal(missingLesson.status, 404);
  assert.deepEqual(await payload(missingLesson), { error: "lesson_not_found" });
  assertNoStore(missingLesson);

  const malformedCourse = await handlers.GET_LIST("bad-course", moduleId);
  assert.equal(malformedCourse.status, 404);
  assert.deepEqual(await payload(malformedCourse), { error: "course_not_found" });
  assertNoStore(malformedCourse);
});

test("OWNER and ADMIN can list; MEMBER and anonymous requests use existing authorization errors", async () => {
  const ownerResponse = await handlersFor(new StubStore(), "OWNER").GET_LIST(courseId, moduleId);
  const adminResponse = await handlersFor(new StubStore(), "ADMIN").GET_LIST(courseId, moduleId);
  assert.equal(ownerResponse.status, 200);
  assert.equal(adminResponse.status, 200);
  assertNoStore(ownerResponse);
  assertNoStore(adminResponse);
  const memberResponse = await handlersFor(new StubStore(), "MEMBER").GET_LIST(courseId, moduleId);
  assert.equal(memberResponse.status, 403);
  assert.deepEqual(await payload(memberResponse), { error: "forbidden" });
  assertNoStore(memberResponse);
  const anonymousResponse = await handlersFor(new StubStore(), "ANONYMOUS").GET_LIST(courseId, moduleId);
  assert.equal(anonymousResponse.status, 401);
  assert.deepEqual(await payload(anonymousResponse), { error: "unauthenticated" });
  assertNoStore(anonymousResponse);
});

test("content, published lock, and generic failure mappings stay safe and uncached", async () => {
  const store = new StubStore();
  const handlers = handlersFor(store);
  const validContentRequest = request("PUT", { text: "unit body" });
  const contentResponse = await handlers.PUT_CONTENT(validContentRequest, courseId, moduleId, lessonId);
  assert.equal(contentResponse.status, 200);
  assert.deepEqual(store.lastContentBody, { text: "unit body" });
  assertNoStore(contentResponse);
  assert.deepEqual(await payload(contentResponse), {
    lesson: {
      id: lessonId, title: "Introduction", type: "TEXT", position: 1,
      content: { text: null }, createdAt: lesson.createdAt.toISOString(), updatedAt: lesson.updatedAt.toISOString(),
    },
  });

  store.mutationResult = { kind: "published_course_structure_locked" };
  const locked = await handlers.POST(request("POST", { title: "Intro", type: "TEXT" }), courseId, moduleId);
  assert.equal(locked.status, 409);
  assert.deepEqual(await payload(locked), { error: "published_course_structure_locked" });
  assertNoStore(locked);

  store.mutationResult = { kind: "quiz_content_not_available" };
  const quiz = await handlers.PUT_CONTENT(request("PUT", {}), courseId, moduleId, lessonId);
  assert.equal(quiz.status, 409);
  assert.deepEqual(await payload(quiz), { error: "quiz_content_not_available" });
  assertNoStore(quiz);

  const broken = new StubStore();
  broken.list = async () => { throw new Error("SQLSTATE 23505; secret db url"); };
  const failures = handlersFor(broken);
  const response = await failures.GET_LIST(courseId, moduleId);
  assert.equal(response.status, 503);
  assert.deepEqual(await payload(response), { error: "lesson_builder_unavailable" });
  assertNoStore(response);
});

test("delete mapping and false same-origin checks stay no-store", async () => {
  const handlers = handlersFor(new StubStore());
  const deleted = await handlers.DELETE(request("DELETE"), courseId, moduleId, lessonId);
  assert.equal(deleted.status, 200);
  assert.deepEqual(await payload(deleted), { deleted: true });
  assertNoStore(deleted);

  const untrusted = createLessonHandlers({
    requireTenantContext: async () => ({ userId: lessonId, organizationId: orgId, role: "OWNER" }),
    requirePermission: async () => {}, store: new StubStore(), isTrustedRequest: () => false,
    readBody: async () => null, logError: () => {},
  });
  const rejected = await untrusted.PATCH(request("PATCH", { title: "Changed" }), courseId, moduleId, lessonId);
  assert.equal(rejected.status, 403);
  assert.deepEqual(await payload(rejected), { error: "invalid_request" });
  assertNoStore(rejected);
});
