import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import { isCourseId, type Course } from "./course-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type CoursePublishingIssue =
  | { code: "course_requires_module" }
  | { code: "module_order_invalid"; moduleId: string }
  | { code: "module_requires_lesson"; moduleId: string }
  | { code: "lesson_order_invalid"; moduleId: string; lessonId: string }
  | { code: "lesson_content_missing"; moduleId: string; lessonId: string; type: "TEXT" | "VIDEO" | "PDF" | "IMAGE" | "LINK" }
  | { code: "quiz_not_configured"; moduleId: string; lessonId: string };

export type CoursePublishResult =
  | { kind: "published"; course: Course }
  | { kind: "not_found" }
  | { kind: "not_publishable"; issues: CoursePublishingIssue[]; truncated: boolean };

export interface CoursePublishingStore {
  publish(organizationId: string, courseId: string): Promise<CoursePublishResult>;
}

export type CoursePublishingDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: CoursePublishingStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });

export function parseCoursePublishBody(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
}

function errorResponse(error: unknown, logError?: CoursePublishingDependencies["logError"]) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (logError) logError();
  else console.error("Course publishing could not be completed.");
  return json({ error: "course_publishing_unavailable" }, 503);
}

export function createCoursePublishingHandlers(dependencies: CoursePublishingDependencies) {
  return {
    async POST(request: Request, courseId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
        if (!isCourseId(courseId)) return json({ error: "course_not_found" }, 404);
        if (!parseCoursePublishBody(await dependencies.readBody(request))) {
          return json({ error: "invalid_request" }, 400);
        }

        const result = await dependencies.store.publish(tenant.organizationId, courseId);
        if (result.kind === "not_found") return json({ error: "course_not_found" }, 404);
        if (result.kind === "not_publishable") {
          return json({ error: "course_not_publishable", issues: result.issues, truncated: result.truncated }, 409);
        }
        return json({ course: result.course });
      } catch (error) {
        return errorResponse(error, dependencies.logError);
      }
    },
  };
}
