import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoursePreviewView } from "../src/components/course-preview.ts";
import {
  createCoursePreviewHandlers,
  toCoursePreview,
  type CoursePreview,
  type CoursePreviewRecord,
  type CoursePreviewStore,
} from "../src/lib/course-preview-core.ts";
import { AuthorizationError, type OrganizationPermission } from "../src/lib/authorization-core.ts";
import { TenantContextError } from "../src/lib/tenant-context-core.ts";

const organizationId = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const courseId = "380645db-557b-4d1d-b294-fc65c92da9d3";
const courseRecord: CoursePreviewRecord = {
  id: courseId,
  title: "Safety Training",
  description: "A course description",
  status: "DRAFT",
  publishedAt: null,
  modules: [{
    id: "module-1",
    title: "Getting started",
    description: null,
    position: 1,
    lessons: [
      {
        id: "lesson-text",
        title: "Read this",
        type: "TEXT",
        position: 1,
        textContent: "First line\nSecond line",
        contentUrl: null,
      },
      {
        id: "lesson-video",
        title: "Watch this",
        type: "VIDEO",
        position: 2,
        textContent: null,
        contentUrl: "https://video.example.test/watch/123",
      },
      {
        id: "lesson-quiz",
        title: "Knowledge check",
        type: "QUIZ",
        position: 3,
        textContent: null,
        contentUrl: null,
      },
    ],
  }],
};

class StubStore implements CoursePreviewStore {
  result: CoursePreviewRecord | null = courseRecord;
  error: Error | null = null;
  calls: Array<{ organizationId: string; courseId: string }> = [];

  async get(scopedOrganizationId: string, id: string) {
    this.calls.push({ organizationId: scopedOrganizationId, courseId: id });
    if (this.error) throw this.error;
    return this.result;
  }
}

function request(url = `https://lms.example.test/api/organizations/courses/${courseId}/preview`) {
  return new Request(url, { headers: { "x-organization-id": "forged-tenant" } });
}

function handlersFor(
  store: CoursePreviewStore = new StubStore(),
  role: "OWNER" | "ADMIN" | "MEMBER" | "ANONYMOUS" = "OWNER",
) {
  return createCoursePreviewHandlers({
    async requireTenantContext() {
      if (role === "ANONYMOUS") throw new TenantContextError("unauthenticated");
      return { userId: courseId, organizationId, role };
    },
    async requirePermission(_organizationId: string, permission: OrganizationPermission) {
      assert.equal(permission, "MANAGE_COURSES");
      if (role === "MEMBER") throw new AuthorizationError("forbidden");
    },
    store,
    logError: () => {},
  });
}

function assertNoStore(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
}

test("OWNER and ADMIN can read the preview; MEMBER and anonymous callers are denied", async () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    const store = new StubStore();
    const response = await handlersFor(store, role).GET(request(), courseId);
    assert.equal(response.status, 200);
    assert.deepEqual(store.calls, [{ organizationId, courseId }]);
    assertNoStore(response);
  }

  const member = await handlersFor(new StubStore(), "MEMBER").GET(request(), courseId);
  assert.equal(member.status, 403);
  assert.deepEqual(await member.json(), { error: "forbidden" });
  assertNoStore(member);

  const anonymous = await handlersFor(new StubStore(), "ANONYMOUS").GET(request(), courseId);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await anonymous.json(), { error: "unauthenticated" });
  assertNoStore(anonymous);
});

test("preview uses only the trusted tenant and returns an explicit public read model", async () => {
  const store = new StubStore();
  const response = await handlersFor(store).GET(
    request(`https://lms.example.test/api/organizations/courses/${courseId}/preview?organizationId=forged`),
    courseId,
  );
  assert.equal(response.status, 200);
  assertNoStore(response);
  assert.deepEqual(store.calls, [{ organizationId, courseId }]);
  const body = await response.json() as { course: CoursePreview };
  assert.equal(body.course.title, "Safety Training");
  assert.deepEqual(body.course.modules[0]?.lessons.map(({ content }) => content), [
    { text: "First line\nSecond line" },
    { url: "https://video.example.test/watch/123" },
    null,
  ]);
  assert.doesNotMatch(JSON.stringify(body), /organizationId|moduleId|courseId|textContent|contentUrl|createdAt|updatedAt/);
  assert.deepEqual(Object.keys(body.course).sort(), ["description", "id", "modules", "publishedAt", "status", "title"]);
  assert.deepEqual(Object.keys(body.course.modules[0]!).sort(), ["description", "id", "lessons", "position", "title"]);
  assert.deepEqual(Object.keys(body.course.modules[0]!.lessons[0]!).sort(), ["content", "id", "position", "title", "type"]);
});

test("malformed, missing, and foreign Course IDs map to the same safe 404", async () => {
  const store = new StubStore();
  const handlers = handlersFor(store);
  const malformed = await handlers.GET(request(), "not-a-uuid");
  assert.equal(malformed.status, 404);
  assert.deepEqual(await malformed.json(), { error: "course_not_found" });
  assertNoStore(malformed);
  assert.equal(store.calls.length, 0);

  store.result = null;
  const missing = await handlers.GET(request(), courseId);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "course_not_found" });
  assertNoStore(missing);
});

test("tenant-context and authorization failures remain private; storage failure is generic", async () => {
  const tenantUnavailable = createCoursePreviewHandlers({
    async requireTenantContext() { throw new TenantContextError("tenant_context_unavailable"); },
    async requirePermission() { throw new Error("must not be called"); },
    store: new StubStore(),
    logError: () => {},
  });
  const unavailable = await tenantUnavailable.GET(request(), courseId);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "tenant_context_unavailable" });
  assertNoStore(unavailable);

  const store = new StubStore();
  store.error = new Error("private SQL details");
  const failed = await handlersFor(store).GET(request(), courseId);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "course_preview_unavailable" });
  assertNoStore(failed);
});

test("read-model mapping strips raw columns and serializes publishedAt", () => {
  const published = toCoursePreview({
    ...courseRecord,
    status: "PUBLISHED",
    publishedAt: new Date("2026-10-08T12:34:56.000Z"),
  });
  assert.equal(published.publishedAt, "2026-10-08T12:34:56.000Z");
  assert.equal(published.status, "PUBLISHED");
});

test("server rendering escapes TEXT, keeps line breaks, and never auto-loads resources", async () => {
  const xssText = '<script>alert("xss")</script>\n<img src=x onerror=alert(1)>';
  const course = toCoursePreview({
    ...courseRecord,
    modules: [{
      ...courseRecord.modules[0]!,
      lessons: [
        courseRecord.modules[0]!.lessons[0]!,
        {
          id: "xss-text",
          title: "Untrusted source text",
          type: "TEXT",
          position: 2,
          textContent: xssText,
          contentUrl: null,
        },
        { ...courseRecord.modules[0]!.lessons[1]!, position: 3 },
        { ...courseRecord.modules[0]!.lessons[2]!, position: 4 },
        {
          id: "invalid-url",
          title: "Historical URL",
          type: "LINK",
          position: 5,
          textContent: null,
          contentUrl: "javascript:alert(1)",
        },
        {
          id: "empty-text",
          title: "Unconfigured text",
          type: "TEXT",
          position: 6,
          textContent: null,
          contentUrl: null,
        },
        {
          id: "empty-url",
          title: "Unconfigured URL",
          type: "PDF",
          position: 7,
          textContent: null,
          contentUrl: null,
        },
      ],
    }],
  });
  const markup = renderToStaticMarkup(createElement(CoursePreviewView, { course }));
  assert.match(markup, /Safety Training/);
  assert.match(markup, /Getting started/);
  assert.match(markup, /Read this|First line/);
  assert.match(markup, /Draft preview/);
  assert.match(markup, /First line\nSecond line/);
  assert.match(markup, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;\n&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /Quiz configuration is not available yet\./);
  assert.match(markup, /Content not configured/);
  assert.match(markup, /video\.example\.test/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer"/);
  assert.match(markup, /referrerPolicy="no-referrer"/);
  assert.match(markup, /Resource unavailable/);
  assert.match(markup, /Resource not configured/);
  assert.doesNotMatch(markup, /<script\b|<img\b|<iframe\b|<video\b|<embed\b|<object\b/i);
  assert.doesNotMatch(markup, /href="javascript:/i);

  const componentSource = await readFile(new URL("../src/components/course-preview.ts", import.meta.url), "utf8");
  assert.doesNotMatch(componentSource, /dangerouslySetInnerHTML/);
});

test("published state, empty course, and empty module render accessible placeholders", () => {
  const published = toCoursePreview({
    ...courseRecord,
    status: "PUBLISHED",
    publishedAt: new Date("2026-10-08T12:34:56.000Z"),
    modules: [{ ...courseRecord.modules[0]!, lessons: [] }],
  });
  const markup = renderToStaticMarkup(createElement(CoursePreviewView, { course: published }));
  assert.match(markup, /Published/);
  assert.match(markup, /dateTime="2026-10-08T12:34:56\.000Z"/);
  assert.match(markup, /No lessons have been added to this module yet\./);
  assert.doesNotMatch(markup, /Draft preview/);

  const emptyCourse = { ...published, modules: [] };
  const emptyMarkup = renderToStaticMarkup(createElement(CoursePreviewView, { course: emptyCourse }));
  assert.match(emptyMarkup, /No modules have been added yet\./);
});
