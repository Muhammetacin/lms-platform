import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CourseBuilderView } from "../src/components/course-builder-view.ts";
import { CourseModuleView, AddModuleFormView } from "../src/components/course-module-view.ts";
import { LessonEditorView, AddLessonFormView } from "../src/components/lesson-editor-view.ts";
import { LessonContentEditorView } from "../src/components/lesson-content-editor-view.ts";
import { CoursePublishControlView } from "../src/components/course-publish-control-view.ts";
import {
  builderApiErrorMessage,
  cancelLessonTypeChange,
  createLessonRequest,
  createModuleRequest,
  deleteLessonRequest,
  deleteModuleRequest,
  lessonHasConfiguredContent,
  lessonTypeLabels,
  mapPublishIssues,
  moveLessonRequest,
  moveModuleRequest,
  publishCourseRequest,
  saveLessonWithTypeChangeConfirmation,
  updateLessonContentRequest,
  updateLessonRequest,
  updateModuleRequest,
  validateLessonText,
  validateLessonTitle,
  validateLessonType,
  validateLessonUrl,
  validateModuleDetails,
} from "../src/lib/course-builder-ui-core.ts";
import type { CourseBuilderData } from "../src/lib/course-builder-core.ts";
import { builderPageAccessMessage, loadManagedCourseBuilder } from "../src/lib/course-builder-core.ts";
import { AuthorizationError, requireOrganizationPermission } from "../src/lib/authorization-core.ts";

const courseId = "12345678-1234-4234-8234-123456789abc";
const moduleAId = "22345678-1234-4234-8234-123456789abc";
const moduleBId = "32345678-1234-4234-8234-123456789abc";
const textLessonId = "42345678-1234-4234-8234-123456789abc";
const videoLessonId = "52345678-1234-4234-8234-123456789abc";
const organizationA = "87654321-4321-4321-8321-000000000001";
const organizationB = "87654321-4321-4321-8321-000000000002";
const userId = "98765432-9876-4876-8876-987654321000";
const now = new Date("2026-10-08T12:00:00.000Z");

const builder: CourseBuilderData = {
  courseId,
  status: "DRAFT",
  publishedAt: null,
  modules: [
    {
      id: moduleAId,
      title: "Getting started",
      description: "Introduction and orientation.",
      position: 1,
      lessons: [
        { id: textLessonId, title: "Welcome", type: "TEXT", position: 1, content: { text: "First line\nSecond line" } },
        { id: videoLessonId, title: "Watch this", type: "VIDEO", position: 2, content: { url: "https://video.example.test/watch/1" } },
      ],
    },
    {
      id: moduleBId,
      title: "Next steps",
      description: null,
      position: 2,
      lessons: [{ id: "62345678-1234-4234-8234-123456789abc", title: "Knowledge check", type: "QUIZ", position: 1, content: null }],
    },
  ],
};

function moduleView(overrides: Partial<Parameters<typeof CourseModuleView>[0]> = {}) {
  return h(CourseModuleView, {
    module: builder.modules[0]!,
    index: 0,
    moduleCount: 2,
    editable: true,
    ...overrides,
  });
}

function lessonView(overrides: Partial<Parameters<typeof LessonEditorView>[0]> = {}) {
  return h(LessonEditorView, {
    lesson: builder.modules[0]!.lessons[0]!,
    index: 0,
    lessonCount: 2,
    editable: true,
    ...overrides,
  });
}

function render(node: Parameters<typeof renderToStaticMarkup>[0]) {
  return renderToStaticMarkup(node);
}

test("empty Course offers the authoring start and keeps Preview available", () => {
  const emptyBuilder = { ...builder, modules: [] };
  const markup = render(h(CourseBuilderView, {
    builder: emptyBuilder,
    children: h("div", { className: "builder-empty-state" },
      h("h3", null, "No modules yet."),
      h("p", null, "Add your first module to start building this course."),
      h(AddModuleFormView, { open: false }),
    ),
  }));
  assert.match(markup, /Course content/);
  assert.match(markup, /No modules yet\./);
  assert.match(markup, /Add your first module to start building this course\./);
  assert.match(markup, />\+ Add module<\/button>/);
  assert.match(markup, new RegExp(`href="/courses/${courseId}/preview"`));
});

test("Modules and Lessons render in the supplied backend order with human type labels", () => {
  const markup = render(h(CourseBuilderView, { builder, children: h("div", null,
    h(CourseModuleView, { module: builder.modules[0]!, index: 0, moduleCount: 2, editable: true }),
    h(CourseModuleView, { module: builder.modules[1]!, index: 1, moduleCount: 2, editable: true }),
    h(LessonEditorView, { lesson: builder.modules[0]!.lessons[0]!, index: 0, lessonCount: 2, editable: true }),
    h(LessonEditorView, { lesson: builder.modules[0]!.lessons[1]!, index: 1, lessonCount: 2, editable: true }),
  ) }));
  assert.ok(markup.indexOf("Getting started") < markup.indexOf("Next steps"));
  assert.match(markup, /Welcome/);
  assert.match(markup, /Text/);
  assert.match(markup, /Watch this/);
  assert.deepEqual(lessonTypeLabels, { TEXT: "Text", VIDEO: "Video", PDF: "PDF", IMAGE: "Image", LINK: "Link", QUIZ: "Quiz" });
});

test("module create/edit/delete and move request contracts are exact allowlists", () => {
  const create = createModuleRequest({ title: "Introduction", description: null });
  assert.equal(create.method, "POST");
  assert.equal(create.credentials, "same-origin");
  assert.equal(new Headers(create.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(create.body), { title: "Introduction", description: null });
  assert.deepEqual(JSON.parse(updateModuleRequest({ title: "Updated", description: "Details" }).body), { title: "Updated", description: "Details" });
  assert.deepEqual(JSON.parse(moveModuleRequest(2).body), { position: 2 });
  assert.deepEqual(JSON.parse(deleteModuleRequest().body), {});
  assert.match(render(h(AddModuleFormView, { open: true })), /Module title/);
  const editMarkup = render(moduleView({ editing: true }));
  assert.match(editMarkup, /Description \(optional\)/);
  assert.doesNotMatch(editMarkup, /name="position"|organizationId|tenantId/);
  const deleted = render(moduleView({ confirmingDelete: true }));
  assert.match(deleted, /Delete module\?/);
  assert.match(deleted, /permanently deletes the module and all lessons inside it/);
});

test("module validation mirrors Unicode boundaries and blank description normalization", () => {
  assert.equal(validateModuleDetails("x", "").valid, false);
  assert.deepEqual(validateModuleDetails("😀😀", "  "), { valid: true, value: { title: "😀😀", description: null } });
  assert.equal(validateModuleDetails("界".repeat(160), "").valid, true);
  assert.equal(validateModuleDetails("界".repeat(161), "").valid, false);
  assert.equal(validateModuleDetails("Valid title", "x".repeat(4000)).valid, true);
  assert.equal(validateModuleDetails("Valid title", "x".repeat(4001)).valid, false);
  assert.equal(validateModuleDetails("bad\ttitle", "").valid, false);
});

test("Move up/down controls disable at the first and last positions", () => {
  const firstModule = render(moduleView({ index: 0, moduleCount: 2 }));
  assert.match(firstModule, /disabled="" aria-label="Move Getting started up"/);
  assert.doesNotMatch(firstModule, /disabled="" aria-label="Move Getting started down"/);
  const lastModule = render(moduleView({ index: 1, moduleCount: 2 }));
  assert.match(lastModule, /disabled="" aria-label="Move Getting started down"/);
  const firstLesson = render(lessonView({ index: 0, lessonCount: 2 }));
  assert.match(firstLesson, /disabled="" aria-label="Move Welcome up"/);
  assert.doesNotMatch(firstLesson, /disabled="" aria-label="Move Welcome down"/);
  const lastLesson = render(lessonView({ index: 1, lessonCount: 2 }));
  assert.match(lastLesson, /disabled="" aria-label="Move Welcome down"/);
  assert.deepEqual(JSON.parse(moveLessonRequest(2).body), { position: 2 });
});

test("lesson create and edit forms use exact enum values and metadata allowlists", () => {
  const markup = render(h(AddLessonFormView, { open: true }));
  for (const type of ["TEXT", "VIDEO", "PDF", "IMAGE", "LINK", "QUIZ"]) {
    assert.match(markup, new RegExp(`<option value="${type}"`));
  }
  assert.deepEqual(JSON.parse(createLessonRequest("Welcome", "TEXT").body), { title: "Welcome", type: "TEXT" });
  assert.deepEqual(JSON.parse(updateLessonRequest({ title: "Updated", type: "VIDEO" }).body), { title: "Updated", type: "VIDEO" });
  assert.deepEqual(JSON.parse(deleteLessonRequest().body), {});
  assert.equal(validateLessonType("QUIZ").valid, true);
  assert.equal(validateLessonType("OTHER").valid, false);
  const metadata = render(lessonView({ editing: true }));
  assert.match(metadata, /Lesson title/);
  assert.match(metadata, /<select/);
  assert.doesNotMatch(metadata, /name="(?:position|content|organizationId|tenantId)"/);
});

test("lesson title validation accepts 2–160 Unicode code points and rejects unsupported controls", () => {
  assert.equal(validateLessonTitle("x").valid, false);
  assert.equal(validateLessonTitle("ab").valid, true);
  assert.equal(validateLessonTitle("😀😀").valid, true);
  assert.equal(validateLessonTitle("界".repeat(160)).valid, true);
  assert.equal(validateLessonTitle("界".repeat(161)).valid, false);
  assert.equal(validateLessonTitle("bad\ntitle").valid, false);
});

test("content type change shows the data loss confirmation before the mutation", () => {
  const markup = render(lessonView({ editing: true, type: "VIDEO", proposedType: "VIDEO" }));
  assert.match(markup, /Change lesson type\?/);
  assert.match(markup, /Changing the lesson type clears its current content\./);
  assert.match(markup, />Change type<\/button>/);
  assert.equal(lessonHasConfiguredContent("TEXT", { text: "current text" }), true);
  assert.equal(lessonHasConfiguredContent("VIDEO", { url: "https://video.example.test/" }), true);
  assert.equal(lessonHasConfiguredContent("TEXT", { text: null }), false);
  assert.equal(lessonHasConfiguredContent("QUIZ", null), false);
});

test("content type change confirmation allows exactly one update after explicit confirmation", async () => {
  const requests: ReturnType<typeof updateLessonRequest>[] = [];
  const save = async () => {
    requests.push(updateLessonRequest({ title: "Welcome", type: "VIDEO" }));
    return { ok: true };
  };

  const firstSave = await saveLessonWithTypeChangeConfirmation({
    currentType: "TEXT",
    nextType: "VIDEO",
    hasConfiguredContent: true,
    confirmedType: null,
    save,
  });
  assert.deepEqual(firstSave, { kind: "confirmation-required", proposedType: "VIDEO" });
  assert.equal(requests.length, 0);

  const confirmedSave = await saveLessonWithTypeChangeConfirmation({
    currentType: "TEXT",
    nextType: "VIDEO",
    hasConfiguredContent: true,
    confirmedType: "VIDEO",
    save,
  });
  assert.deepEqual(confirmedSave, { kind: "saved", result: { ok: true } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.method, "PATCH");
  assert.deepEqual(JSON.parse(requests[0]!.body), { title: "Welcome", type: "VIDEO" });

  const lessonEditorSource = await readFile(new URL("../src/components/lesson-editor.tsx", import.meta.url), "utf8");
  assert.match(lessonEditorSource, /saveLessonWithTypeChangeConfirmation\(\{/);
  assert.match(lessonEditorSource, /onConfirmTypeChange=\{\(\) => \{\s*if \(proposedType\) void saveLesson\(undefined, proposedType\);\s*\}\}/);
  assert.match(lessonEditorSource, /onTypeChange=\{\(value\) => \{\s*setType\(value\);\s*setFieldError\(null\);\s*setProposedType\(null\);\s*\}\}/);
});

test("canceling a confirmed content type change restores the original type without a PATCH", async () => {
  let patchCount = 0;
  const firstSave = await saveLessonWithTypeChangeConfirmation({
    currentType: "TEXT",
    nextType: "VIDEO",
    hasConfiguredContent: true,
    confirmedType: null,
    save: async () => { patchCount += 1; },
  });
  assert.equal(firstSave.kind, "confirmation-required");
  assert.equal(patchCount, 0);

  const cancelled = cancelLessonTypeChange("TEXT");
  assert.deepEqual(cancelled, { type: "TEXT", proposedType: null });
  assert.equal(patchCount, 0);

  const lessonEditorSource = await readFile(new URL("../src/components/lesson-editor.tsx", import.meta.url), "utf8");
  assert.match(lessonEditorSource, /cancelLessonTypeChange\(lesson\.type\)/);
  assert.match(lessonEditorSource, /setType\(cancelledType\.type\)/);
});

test("type changes without configured content save immediately without confirmation", async () => {
  let patchCount = 0;
  const result = await saveLessonWithTypeChangeConfirmation({
    currentType: "TEXT",
    nextType: "VIDEO",
    hasConfiguredContent: false,
    confirmedType: null,
    save: async () => { patchCount += 1; return "patched"; },
  });
  assert.deepEqual(result, { kind: "saved", result: "patched" });
  assert.equal(patchCount, 1);
});

test("TEXT editor preserves multiline source as escaped text and enforces backend limits", () => {
  const markup = render(h(LessonContentEditorView, {
    lessonId: textLessonId,
    type: "TEXT",
    editable: true,
    configured: true,
    text: "First line\nSecond line",
  }));
  assert.match(markup, /Lesson content/);
  assert.match(markup, /First line\nSecond line/);
  assert.equal(validateLessonText("x".repeat(100_000)).valid, true);
  assert.equal(validateLessonText("x".repeat(100_001)).valid, false);
  assert.deepEqual(validateLessonText("First\r\nSecond"), { valid: true, value: "First\nSecond" });
  assert.equal(validateLessonText("tab\tallowed\nline").valid, true);
  assert.equal(validateLessonText("bad\u0000text").valid, false);
  assert.deepEqual(JSON.parse(updateLessonContentRequest({ type: "TEXT", text: "Text" }).body), { text: "Text" });
});

test("URL editor accepts only HTTPS without credentials and sends only url", () => {
  assert.equal(validateLessonUrl("https://assets.example.test/guide.pdf").valid, true);
  assert.equal(validateLessonUrl("http://assets.example.test/guide.pdf").valid, false);
  assert.equal(validateLessonUrl("https://user:pass@assets.example.test/file").valid, false);
  assert.equal(validateLessonUrl("https://assets.example.test/" + "x".repeat(2048)).valid, false);
  assert.deepEqual(validateLessonUrl("   "), { valid: true, value: { value: null, href: null, hostname: null } });
  assert.deepEqual(JSON.parse(updateLessonContentRequest({ type: "VIDEO", url: "https://video.example.test/watch/1" }).body), { url: "https://video.example.test/watch/1" });
  const markup = render(h(LessonContentEditorView, {
    lessonId: videoLessonId,
    type: "VIDEO",
    editable: true,
    configured: true,
    url: "https://video.example.test/watch/1",
  }));
  assert.match(markup, /Resource URL/);
  assert.match(markup, /HTTPS only/);
  assert.doesNotMatch(markup, /<iframe|<video|<img|<embed|<object/i);
  const publishedResource = render(h(LessonContentEditorView, {
    lessonId: videoLessonId,
    type: "VIDEO",
    editable: false,
    configured: true,
    url: "https://video.example.test/watch/1",
    hostname: "video.example.test",
  }));
  assert.match(publishedResource, /href="https:\/\/video\.example\.test\/watch\/1"/);
  assert.match(publishedResource, /target="_blank"/);
  assert.match(publishedResource, /rel="noopener noreferrer"/);
  assert.match(publishedResource, /referrerPolicy="no-referrer"/);
  assert.doesNotMatch(publishedResource, /<iframe\b|<video\b|<img\b|<embed\b|<object\b/i);
});

test("QUIZ shows the future boundary with no fake editor", () => {
  const quiz = builder.modules[1]!.lessons[0]!;
  const markup = render(h(LessonContentEditorView, {
    lessonId: quiz.id,
    type: "QUIZ",
    editable: true,
    configured: false,
  }));
  assert.match(markup, /Quiz not configured/);
  assert.match(markup, /Quiz configuration is not available yet\. Quiz Builder will be added in the Quiz epic\./);
  assert.doesNotMatch(markup, /<textarea|<input|<select/);
});

test("lesson delete confirmation, content status, and safe API errors render clearly", () => {
  const deleted = render(lessonView({ confirmingDelete: true }));
  assert.match(deleted, /Delete lesson\?/);
  assert.match(deleted, /This permanently removes this lesson\./);
  assert.match(deleted, />Delete lesson<\/button>/);
  const configured = render(h(LessonContentEditorView, { lessonId: textLessonId, type: "TEXT", editable: false, configured: true, summary: "Readable" }));
  const missing = render(h(LessonContentEditorView, { lessonId: textLessonId, type: "TEXT", editable: false, configured: false }));
  assert.match(configured, /Content configured/);
  assert.match(missing, /Content not configured/);
  const unavailable = render(h(LessonContentEditorView, { lessonId: videoLessonId, type: "VIDEO", editable: false, configured: true, resourceUnavailable: true }));
  assert.match(unavailable, /Resource unavailable/);
  assert.equal(builderApiErrorMessage(409, { error: "published_course_structure_locked", message: "raw sql" }, "lesson"), "This course has been published. Its structure can no longer be changed.");
  assert.equal(builderApiErrorMessage(403, { error: "forbidden" }, "module"), "You no longer have permission to manage this course.");
  assert.doesNotMatch(builderApiErrorMessage(400, { error: "private_sql", message: "secret" }, "lesson"), /private_sql|secret/);
});

test("draft structure is editable; published structure is read-only while Preview remains", () => {
  const draftMarkup = render(h(CourseBuilderView, { builder, children: h("div", null,
    h(CourseModuleView, { module: builder.modules[0]!, index: 0, moduleCount: 2, editable: true }),
    h(LessonEditorView, { lesson: builder.modules[0]!.lessons[0]!, index: 0, lessonCount: 2, editable: true }),
    h(CoursePublishControlView, { published: false }),
  ) }));
  assert.match(draftMarkup, />Edit<\/button>/);
  assert.match(draftMarkup, />Edit lesson<\/button>/);
  assert.match(draftMarkup, />Publish course<\/button>/);

  const publishedBuilder = { ...builder, status: "PUBLISHED" as const, publishedAt: now.toISOString() };
  const publishedMarkup = render(h(CourseBuilderView, { builder: publishedBuilder, children: h("div", null,
    h(CourseModuleView, { module: builder.modules[0]!, index: 0, moduleCount: 2, editable: false }),
    h(LessonEditorView, { lesson: builder.modules[0]!.lessons[0]!, index: 0, lessonCount: 2, editable: false }),
    h(CoursePublishControlView, { published: true }),
  ) }));
  assert.match(publishedMarkup, /Published course/);
  assert.match(publishedMarkup, /Course structure is locked after publishing\./);
  assert.doesNotMatch(publishedMarkup, /Add module|Add lesson|Edit lesson|Delete lesson|Delete module|Move up|Move down|Publish course|<textarea|<select/);
  assert.match(publishedMarkup, new RegExp(`href="/courses/${courseId}/preview"`));
});

test("publish control asks for confirmation and maps safe local titles and truncated issues", () => {
  const prompt = render(h(CoursePublishControlView, { published: false }));
  assert.match(prompt, /Publishing locks the course structure/);
  assert.match(prompt, />Publish course<\/button>/);
  const confirmation = render(h(CoursePublishControlView, { published: false, confirming: true }));
  assert.match(confirmation, /Publish course\?/);
  assert.match(confirmation, /After publishing, modules and lessons can no longer be changed\./);
  assert.deepEqual(JSON.parse(publishCourseRequest().body), {});
  assert.equal(publishCourseRequest().method, "POST");
  assert.equal(publishCourseRequest().credentials, "same-origin");

  const body = {
    error: "course_not_publishable",
    issues: [
      { code: "module_requires_lesson", moduleId: moduleAId },
      { code: "lesson_content_missing", moduleId: moduleAId, lessonId: textLessonId, type: "TEXT" },
      { code: "quiz_not_configured", moduleId: moduleBId, lessonId: "62345678-1234-4234-8234-123456789abc" },
      { code: "unknown", message: "database details" },
    ],
    truncated: true,
  };
  const mapped = mapPublishIssues(body, builder);
  assert.deepEqual(mapped.messages, [
    "Add at least one lesson to “Getting started”.",
    "Add content to “Welcome”.",
    "Configure or remove quiz lesson “Knowledge check”. Quiz configuration is not available yet.",
    "The course still contains content that prevents publishing.",
  ]);
  assert.equal(mapped.truncated, true);
  const issueMarkup = render(h(CoursePublishControlView, { published: false, issues: mapped.messages, truncated: mapped.truncated }));
  assert.match(issueMarkup, /Additional publishing issues were omitted/);
  assert.doesNotMatch(issueMarkup, /database details|12345678/);
});

test("accessible markup has headings, labels, alerts, status, no tenant fields, and no unsafe HTML or embeds", async () => {
  const maliciousText = '<script>alert(1)</script>\n<img src=x onerror=alert(1)>';
  const textView = h(LessonContentEditorView, {
    lessonId: textLessonId,
    type: "TEXT",
    editable: false,
    configured: true,
    summary: maliciousText,
  });
  const errorView = h(CoursePublishControlView, { published: false, errorMessage: "Resolve the publishing issues below before publishing this course." });
  const markup = render(h(CourseBuilderView, { builder, children: h("div", null, textView, errorView) }));
  assert.match(markup, /<h2 id="course-content-heading">Course content/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(markup, /role="alert"/);
  assert.match(render(h(LessonContentEditorView, { lessonId: textLessonId, type: "TEXT", editable: false, configured: true })), /Content configured/);
  assert.doesNotMatch(markup, /name="(?:organizationId|tenantId)"/);
  assert.doesNotMatch(markup, /<script\b|<img\b|<iframe\b|<video\b|<embed\b|<object\b/i);

  const clientSource = await readFile(new URL("../src/components/course-builder.tsx", import.meta.url), "utf8");
  const lessonSource = await readFile(new URL("../src/components/lesson-content-editor.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(`${clientSource}\n${lessonSource}`, /dangerouslySetInnerHTML|<iframe|<video|<img|<embed|<object/i);
});

test("initial builder data is loaded after trusted tenant and MANAGE_COURSES authorization", async () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    const order: string[] = [];
    const result = await loadManagedCourseBuilder(courseId, {
      async requireTenantContext() {
        order.push("tenant");
        return { userId, organizationId: organizationA, role };
      },
      async requirePermission(organizationId, permission) {
        order.push("permission");
        assert.equal(organizationId, organizationA);
        assert.equal(permission, "MANAGE_COURSES");
        return requireOrganizationPermission({ id: userId, email: "manager@example.test", name: null }, organizationId, permission, {
          async findOrganizationRole() { return role; },
        });
      },
      store: {
        async get(organizationId, id) {
          order.push("read");
          assert.equal(organizationId, organizationA);
          assert.equal(id, courseId);
          return {
            id,
            title: "Builder test",
            description: null,
            status: "DRAFT",
            publishedAt: null,
            createdAt: now,
            updatedAt: now,
            modules: [],
          };
        },
      },
    });
    assert.deepEqual(order, ["tenant", "permission", "read"]);
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.course.createdAt, now);
      assert.deepEqual(result.builder.modules, []);
      assert.doesNotMatch(JSON.stringify(result), /organizationId|tenantId/);
    }
  }

  let memberReads = 0;
  await assert.rejects(loadManagedCourseBuilder(courseId, {
    async requireTenantContext() { return { userId, organizationId: organizationA, role: "MEMBER" }; },
    async requirePermission(orgId, permission) {
      return requireOrganizationPermission({ id: userId, email: "member@example.test", name: null }, orgId, permission, {
        async findOrganizationRole() { return "MEMBER"; },
      });
    },
    store: { async get() { memberReads += 1; return null; } },
  }), (error: unknown) => error instanceof AuthorizationError && error.code === "forbidden");
  assert.equal(memberReads, 0);

  let foreignScope = "";
  const foreign = await loadManagedCourseBuilder(courseId, {
    async requireTenantContext() { return { userId, organizationId: organizationB, role: "OWNER" }; },
    async requirePermission(orgId, permission) {
      return requireOrganizationPermission({ id: userId, email: "owner@example.test", name: null }, orgId, permission, {
        async findOrganizationRole() { return "OWNER"; },
      });
    },
    store: { async get(orgId) { foreignScope = orgId; return null; } },
  });
  assert.equal(foreignScope, organizationB);
  assert.deepEqual(foreign, { kind: "not_found" });
  assert.deepEqual(await loadManagedCourseBuilder("not-a-uuid", {
    async requireTenantContext() { return { userId, organizationId: organizationA, role: "OWNER" }; },
    async requirePermission() { return undefined; },
    store: { async get() { throw new Error("Malformed ID must not read"); } },
  }), { kind: "not_found" });
  assert.equal(builderApiErrorMessage(401, { error: "unauthenticated" }, "module"), "Your session has ended. Sign in to continue.");
  assert.equal(builderApiErrorMessage(404, { error: "lesson_not_found" }, "lesson"), "This course content is no longer available. The page has been refreshed.");
  assert.equal(builderPageAccessMessage(new AuthorizationError("unauthenticated")), "login");
  assert.equal(builderPageAccessMessage(new AuthorizationError("forbidden")), "denied");
});
