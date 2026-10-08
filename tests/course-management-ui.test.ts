import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminCourseListView } from "../src/components/admin-portal-view.ts";
import { CourseDeleteControlView } from "../src/components/course-delete-control-view.ts";
import { CourseFormView } from "../src/components/course-form-view.ts";
import { CourseManagementDetailView } from "../src/components/course-management-view.ts";
import type { Course } from "../src/lib/course-core.ts";
import {
  courseApiErrorMessage,
  createCourseRequest,
  deleteCourseRequest,
  loadManagedCourse,
  updateCourseRequest,
  validateCourseDetails,
} from "../src/lib/course-management-core.ts";
import { AuthorizationError, requireOrganizationPermission } from "../src/lib/authorization-core.ts";
import type { OrganizationPermission } from "../src/lib/authorization-core.ts";

const organizationA = "87654321-4321-4321-8321-000000000001";
const organizationB = "87654321-4321-4321-8321-000000000002";
const courseId = "12345678-1234-4234-8234-123456789abc";
const userId = "98765432-9876-4876-8876-987654321000";
const now = new Date("2026-10-08T12:00:00.000Z");

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: courseId,
    title: "Fire safety basics",
    description: "Learn how to respond to a fire.",
    status: "DRAFT",
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function validDetails(title: string, description: string) {
  const result = validateCourseDetails(title, description);
  assert.equal(result.valid, true);
  if (!result.valid) throw new Error("Expected valid Course details");
  return result.value;
}

test("Course request helpers use same-origin JSON and send only the existing API fields", () => {
  const input = { title: "Fire safety", description: null };
  const create = createCourseRequest(input);
  assert.equal(create.method, "POST");
  assert.equal(new Headers(create.headers).get("content-type"), "application/json");
  assert.equal(create.credentials, "same-origin");
  assert.deepEqual(JSON.parse(create.body), { title: "Fire safety", description: null });

  const update = updateCourseRequest({ title: "Updated title", description: "Updated details" });
  assert.equal(update.method, "PATCH");
  assert.equal(new Headers(update.headers).get("content-type"), "application/json");
  assert.equal(update.credentials, "same-origin");
  assert.deepEqual(JSON.parse(update.body), { title: "Updated title", description: "Updated details" });

  const remove = deleteCourseRequest();
  assert.equal(remove.method, "DELETE");
  assert.equal(new Headers(remove.headers).get("content-type"), "application/json");
  assert.equal(remove.credentials, "same-origin");
  assert.equal(remove.body, "{}");
  for (const request of [create, update, remove]) {
    assert.doesNotMatch(request.body, /organizationId|tenantId|status|publishedAt|createdAt|updatedAt/);
  }
});

test("Course detail validation matches backend Unicode limits and normalizes blank descriptions", () => {
  assert.equal(validateCourseDetails("", "").valid, false);
  assert.equal(validateCourseDetails("x", "").valid, false);
  assert.deepEqual(validateCourseDetails("  ab  ", "  "), {
    valid: true,
    value: { title: "ab", description: null },
  });
  assert.equal(validateCourseDetails("😀", "").valid, false);
  assert.deepEqual(validDetails("😀😀", ""), { title: "😀😀", description: null });
  assert.equal(validateCourseDetails("界".repeat(160), "").valid, true);
  assert.equal(validateCourseDetails("界".repeat(161), "").valid, false);
  assert.equal(validateCourseDetails("valid\t title", "").valid, false);
  assert.equal(validateCourseDetails("Valid title", "x".repeat(4000)).valid, true);
  assert.equal(validateCourseDetails("Valid title", "x".repeat(4001)).valid, false);
  assert.equal(validateCourseDetails("Valid title", "bad\u0007text").valid, false);
});

test("course overview has the primary create action, empty-state CTA, Manage, and Preview links", () => {
  const empty = renderToStaticMarkup(createElement(AdminCourseListView, { courses: [] }));
  assert.match(empty, /href="\/admin\/courses\/new"[^>]*>New course/);
  assert.match(empty, /No courses yet\./);
  assert.match(empty, /Create your first course to start building training content\./);
  assert.match(empty, /href="\/admin\/courses\/new"[^>]*>Create course/);

  const rows = renderToStaticMarkup(createElement(AdminCourseListView, { courses: [
    course({ status: "DRAFT" }),
    course({ id: "22345678-1234-4234-8234-123456789abc", title: "Published", status: "PUBLISHED", publishedAt: now }),
  ] }));
  assert.match(rows, /href="\/admin\/courses\/12345678-1234-4234-8234-123456789abc"[^>]*>Manage/);
  assert.match(rows, /href="\/courses\/12345678-1234-4234-8234-123456789abc\/preview"[^>]*>Preview/);
  assert.match(rows, /DRAFT/);
  assert.match(rows, /PUBLISHED/);
  assert.match(rows, /Last updated/);
  assert.match(rows, /Published date/);
  assert.match(rows, /<time dateTime="2026-10-08T12:00:00.000Z"/);
});

test("create form labels fields, explains limits, links back, and accepts no tenant or lifecycle fields", () => {
  const markup = renderToStaticMarkup(createElement(CourseFormView, {
    mode: "create",
    title: "",
    description: "",
  }));
  assert.match(markup, /<label for="course-title">Title<\/label>/);
  assert.match(markup, /<input[^>]*name="title"/);
  assert.match(markup, /<label for="course-description">Description<\/label>/);
  assert.match(markup, /<textarea[^>]*name="description"/);
  assert.match(markup, /2–160 characters/);
  assert.match(markup, /up to 4,000 characters/);
  assert.match(markup, /href="\/admin\/courses"[^>]*>Cancel/);
  assert.match(markup, /Create course/);
  assert.match(markup, /aria-describedby="course-title-hint"/);
  assert.match(markup, /aria-describedby="course-description-hint"/);
  assert.doesNotMatch(markup, /name="(?:organizationId|tenantId|status|publishedAt|createdAt|updatedAt)"/);
  assert.doesNotMatch(markup, /<input[^>]*name="(?:organizationId|tenantId|status|publishedAt)"/);
});

test("draft detail has editable metadata and explicit delete confirmation; published detail cannot delete", () => {
  const draft = renderToStaticMarkup(createElement(CourseManagementDetailView, {
    course: course(),
    form: createElement(CourseFormView, { mode: "edit", title: "Fire safety basics", description: "Course details" }),
    deleteControl: createElement(CourseDeleteControlView, {}),
  }));
  assert.match(draft, /Fire safety basics/);
  assert.match(draft, /DRAFT/);
  assert.match(draft, /href="\/courses\/12345678-1234-4234-8234-123456789abc\/preview"[^>]*>Preview course/);
  assert.match(draft, /Course settings/);
  assert.match(draft, /Save changes/);
  assert.match(draft, /Danger zone/);
  assert.match(draft, />Delete course<\/button>/);
  assert.match(draft, /<time dateTime="2026-10-08T12:00:00.000Z"/);

  const confirmation = renderToStaticMarkup(createElement(CourseDeleteControlView, { confirming: true }));
  assert.match(confirmation, /Delete course\?/);
  assert.match(confirmation, /permanently deletes the draft course and its modules and lessons/i);
  assert.match(confirmation, />Cancel<\/button>/);
  assert.match(confirmation, />Delete permanently<\/button>/);

  const published = renderToStaticMarkup(createElement(CourseManagementDetailView, {
    course: course({ status: "PUBLISHED", publishedAt: now }),
    form: createElement(CourseFormView, { mode: "edit", title: "Published course", description: "Editable" }),
    deleteControl: createElement(CourseDeleteControlView, { allowDelete: false }),
  }));
  assert.match(published, /PUBLISHED/);
  assert.match(published, /Published courses cannot be deleted\./);
  assert.doesNotMatch(published, />Delete course<\/button>|Delete permanently/);
  assert.match(published, /Save changes/);

  const racedPublished = renderToStaticMarkup(createElement(CourseDeleteControlView, {
    allowDelete: false,
    errorMessage: "This course is published and can no longer be deleted.",
  }));
  assert.match(racedPublished, /role="alert">This course is published and can no longer be deleted\./);
  assert.doesNotMatch(racedPublished, /Delete course|Delete permanently/);
});

test("forms expose pending, success, and safe error feedback", () => {
  const pending = renderToStaticMarkup(createElement(CourseFormView, {
    mode: "edit", title: "Title", description: "", pending: true,
  }));
  assert.match(pending, /disabled=""[^>]*>Saving…/);

  const success = renderToStaticMarkup(createElement(CourseFormView, {
    mode: "edit", title: "Title", description: "", successMessage: "Changes saved.",
  }));
  assert.match(success, /role="status">Changes saved\./);

  const fieldError = renderToStaticMarkup(createElement(CourseFormView, {
    mode: "create", title: "x", description: "", titleError: "Enter a title with at least 2 characters.",
  }));
  assert.match(fieldError, /aria-invalid="true"/);
  assert.match(fieldError, /aria-describedby="course-title-hint course-title-error"/);
  assert.match(fieldError, /id="course-title-error"/);

  const generalError = renderToStaticMarkup(createElement(CourseDeleteControlView, {
    confirming: true,
    pending: true,
    errorMessage: "This course is published and can no longer be deleted.",
  }));
  assert.match(generalError, /role="alert"/);
  assert.match(generalError, /disabled=""[^>]*>Deleting…/);
});

test("API error mapping uses known codes only and never renders server-provided messages", () => {
  assert.equal(courseApiErrorMessage(400, { error: "invalid_request" }, "create"), "Check the course details and try again.");
  assert.equal(courseApiErrorMessage(403, { error: "forbidden" }, "update"), "You no longer have permission to manage this course.");
  assert.equal(courseApiErrorMessage(404, { error: "course_not_found" }, "update"), "This course is no longer available. Return to Courses.");
  assert.equal(courseApiErrorMessage(503, { error: "course_management_unavailable" }, "create"), "Course management is temporarily unavailable.");
  assert.equal(courseApiErrorMessage(409, { error: "published_course_delete_forbidden" }, "delete"), "This course is published and can no longer be deleted.");
  const untrusted = courseApiErrorMessage(400, { error: "invalid_request", message: "database password: secret" }, "create");
  assert.equal(untrusted, "Check the course details and try again.");
  assert.doesNotMatch(untrusted, /secret|database/);
});

test("detail loading checks trusted tenant and MANAGE_COURSES before scoped reads", async () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    let readOrganizationId: string | null = null;
    const result = await loadManagedCourse(courseId, {
      async requireTenantContext() { return { userId, organizationId: organizationA, role }; },
      async requirePermission(orgId, permission) {
        assert.equal(orgId, organizationA);
        assert.equal(permission, "MANAGE_COURSES");
        return requireOrganizationPermission({ id: userId, email: "admin@example.test", name: null }, orgId, permission, {
          async findOrganizationRole() { return role; },
        });
      },
      store: {
        async get(orgId, id) {
          readOrganizationId = orgId;
          assert.equal(id, courseId);
          return course();
        },
      },
    });
    assert.equal(result.kind, "ok");
    assert.equal(readOrganizationId, organizationA);
  }

  let memberReads = 0;
  await assert.rejects(loadManagedCourse(courseId, {
    async requireTenantContext() { return { userId, organizationId: organizationA, role: "MEMBER" }; },
    async requirePermission(orgId, permission) {
      return requireOrganizationPermission({ id: userId, email: "member@example.test", name: null }, orgId, permission, {
        async findOrganizationRole() { return "MEMBER"; },
      });
    },
    store: { async get() { memberReads += 1; return course(); } },
  }), (error: unknown) => error instanceof AuthorizationError && error.code === "forbidden");
  assert.equal(memberReads, 0);

  const missingDependencies = {
    async requireTenantContext() { return { userId, organizationId: organizationA, role: "OWNER" as const }; },
    async requirePermission(orgId: string, permission: OrganizationPermission) {
      return requireOrganizationPermission({ id: userId, email: "owner@example.test", name: null }, orgId, permission, {
        async findOrganizationRole() { return "OWNER" as const; },
      });
    },
    store: { async get() { return null; } },
  };
  const missing = await loadManagedCourse(courseId, missingDependencies);
  const foreign = await loadManagedCourse(courseId, {
    ...missingDependencies,
    async requireTenantContext() { return { userId, organizationId: organizationB, role: "OWNER" as const }; },
    async requirePermission(orgId, permission) {
      return requireOrganizationPermission({ id: userId, email: "owner@example.test", name: null }, orgId, permission, {
        async findOrganizationRole() { return "OWNER" as const; },
      });
    },
  });
  assert.deepEqual(missing, { kind: "not_found" });
  assert.deepEqual(foreign, { kind: "not_found" });

  let malformedReads = 0;
  const malformed = await loadManagedCourse("malformed-id", {
    ...missingDependencies,
    store: { async get() { malformedReads += 1; return null; } },
  });
  assert.deepEqual(malformed, { kind: "not_found" });
  assert.equal(malformedReads, 0);
});

test("client mutations call only the existing same-origin Course endpoints", async () => {
  const formSource = await readFile(new URL("../src/components/course-form.tsx", import.meta.url), "utf8");
  const deleteSource = await readFile(new URL("../src/components/course-delete-control.tsx", import.meta.url), "utf8");
  assert.match(formSource, /"\/api\/organizations\/courses"/);
  assert.match(formSource, /`\/api\/organizations\/courses\/\$\{encodeURIComponent\(courseId!\)\}`/);
  assert.match(deleteSource, /`\/api\/organizations\/courses\/\$\{encodeURIComponent\(courseId\)\}`/);
  assert.match(formSource, /response\.status === 401[\s\S]*router\.replace\("\/login"\)/);
  assert.match(deleteSource, /response\.status === 401[\s\S]*router\.replace\("\/login"\)/);
  assert.match(formSource, /router\.refresh\(\)/);
  assert.match(deleteSource, /router\.replace\("\/admin\/courses"\)/);
  assert.doesNotMatch(formSource + deleteSource, /organizationId|tenantId|status:\s*["'](?:DRAFT|PUBLISHED)|publishedAt/);
});
