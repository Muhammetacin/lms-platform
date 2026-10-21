import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import type { CourseStatus, LessonType } from "../generated/prisma/enums.ts";
import { isCourseId } from "./course-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type CoursePreviewLessonRecord = {
  id: string;
  title: string;
  type: LessonType;
  position: number;
  textContent: string | null;
  contentUrl: string | null;
};

export type CoursePreviewModuleRecord = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  lessons: CoursePreviewLessonRecord[];
};

export type CoursePreviewRecord = {
  id: string;
  title: string;
  description: string | null;
  status: CourseStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  modules: CoursePreviewModuleRecord[];
};

export type CoursePreviewLesson = {
  id: string;
  title: string;
  type: LessonType;
  position: number;
  content: { text: string | null } | { url: string | null } | null;
};

export type CoursePreviewModule = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  lessons: CoursePreviewLesson[];
};

export type CoursePreview = {
  id: string;
  title: string;
  description: string | null;
  status: CourseStatus;
  publishedAt: string | null;
  modules: CoursePreviewModule[];
};

export interface CoursePreviewStore {
  get(organizationId: string, courseId: string): Promise<CoursePreviewRecord | null>;
}

export function toCoursePreview(record: CoursePreviewRecord): CoursePreview {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    status: record.status,
    publishedAt: record.publishedAt?.toISOString() ?? null,
    modules: record.modules.map((courseModule) => ({
      id: courseModule.id,
      title: courseModule.title,
      description: courseModule.description,
      position: courseModule.position,
      lessons: courseModule.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        type: lesson.type,
        position: lesson.position,
        content: lesson.type === "TEXT"
          ? { text: lesson.textContent }
          : lesson.type === "QUIZ"
            ? null
            : { url: lesson.contentUrl },
      })),
    })),
  };
}

export type CoursePreviewResult =
  | { kind: "ok"; course: CoursePreview }
  | { kind: "not_found" };

/** Shared read path for the API and protected server-rendered page. */
export async function loadCoursePreview(
  store: CoursePreviewStore,
  organizationId: string,
  courseId: string,
): Promise<CoursePreviewResult> {
  if (!isCourseId(courseId)) return { kind: "not_found" };
  const record = await store.get(organizationId, courseId);
  return record === null
    ? { kind: "not_found" }
    : { kind: "ok", course: toCoursePreview(record) };
}

export type CoursePreviewDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: CoursePreviewStore;
  logError?(): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });

function errorResponse(error: unknown, logError?: CoursePreviewDependencies["logError"]) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (logError) logError();
  else console.error("Course preview request could not be completed.");
  return json({ error: "course_preview_unavailable" }, 503);
}

export function createCoursePreviewHandlers(dependencies: CoursePreviewDependencies) {
  return {
    async GET(_request: Request, courseId: string) {
      try {
        const tenant = await dependencies.requireTenantContext();
        await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
        const result = await loadCoursePreview(dependencies.store, tenant.organizationId, courseId);
        if (result.kind === "not_found") return json({ error: "course_not_found" }, 404);
        return json({ course: result.course });
      } catch (error) {
        return errorResponse(error, dependencies.logError);
      }
    },
  };
}
