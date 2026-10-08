import { isCourseId, type Course, type CourseStore } from "./course-core.ts";
import type { OrganizationPermission } from "./authorization-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";

export type CourseDetailsInput = { title: string; description: string | null };
export type CourseDetailsValidation =
  | { valid: true; value: CourseDetailsInput }
  | { valid: false; errors: { title?: string; description?: string } };

const invalidTextCharacters = /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u;

export function validateCourseDetails(title: string, description: string): CourseDetailsValidation {
  const normalizedTitle = title.trim();
  const normalizedDescription = description.trim();
  const errors: { title?: string; description?: string } = {};

  if (invalidTextCharacters.test(title) || [...normalizedTitle].length < 2) {
    errors.title = "Enter a title with at least 2 characters.";
  } else if ([...normalizedTitle].length > 160) {
    errors.title = "Titles can be up to 160 characters.";
  }

  if (invalidTextCharacters.test(description)) {
    errors.description = "Remove unsupported characters from the description.";
  } else if ([...normalizedDescription].length > 4000) {
    errors.description = "Descriptions can be up to 4,000 characters.";
  }

  if (Object.keys(errors).length) return { valid: false, errors };
  return {
    valid: true,
    value: {
      title: normalizedTitle,
      description: normalizedDescription.length ? normalizedDescription : null,
    },
  };
}

export type CourseRequestOptions = {
  method: "POST" | "PATCH" | "DELETE";
  credentials: "same-origin";
  headers: { "Content-Type": "application/json" };
  body: string;
};

export function createCourseRequest(value: CourseDetailsInput): CourseRequestOptions {
  return {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: value.title, description: value.description }),
  };
}

export function updateCourseRequest(value: CourseDetailsInput): CourseRequestOptions {
  return {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: value.title, description: value.description }),
  };
}

export function deleteCourseRequest(): CourseRequestOptions {
  return {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  };
}

const knownErrors = new Set([
  "invalid_request",
  "course_not_found",
  "published_course_delete_forbidden",
  "course_management_unavailable",
  "unauthenticated",
  "forbidden",
  "authorization_unavailable",
]);

export function courseErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const error = (body as Record<string, unknown>).error;
  return typeof error === "string" && knownErrors.has(error) ? error : null;
}

export function courseApiErrorMessage(status: number, body: unknown, action: "create" | "update" | "delete"): string {
  const code = courseErrorCode(body);
  if (status === 400 && code === "invalid_request") return "Check the course details and try again.";
  if (status === 403 && code === "forbidden") return "You no longer have permission to manage this course.";
  if (status === 404 && code === "course_not_found") return "This course is no longer available. Return to Courses.";
  if (status === 409 && code === "published_course_delete_forbidden" && action === "delete") {
    return "This course is published and can no longer be deleted.";
  }
  if (status === 503 && (code === "course_management_unavailable" || code === "authorization_unavailable")) {
    return "Course management is temporarily unavailable.";
  }
  return action === "delete"
    ? "The course could not be deleted. Please try again."
    : "The course could not be saved. Please try again.";
}

export type CourseDetailDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: Pick<CourseStore, "get">;
};

export type CourseDetailResult = { kind: "ok"; course: Course } | { kind: "not_found" };

/** Authorize and obtain the trusted tenant before validating or reading Course data. */
export async function loadManagedCourse(
  courseId: string,
  dependencies: CourseDetailDependencies,
): Promise<CourseDetailResult> {
  const tenant = await dependencies.requireTenantContext();
  await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
  if (!isCourseId(courseId)) return { kind: "not_found" };
  const course = await dependencies.store.get(tenant.organizationId, courseId);
  return course ? { kind: "ok", course } : { kind: "not_found" };
}
