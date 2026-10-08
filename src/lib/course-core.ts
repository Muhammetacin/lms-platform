import type { CourseStatus } from "../generated/prisma/enums.ts";
import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type Course = {
  id: string;
  title: string;
  description: string | null;
  status: CourseStatus;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CourseCreate = { title: string; description: string | null };
export type CourseUpdate = { title?: string; description?: string | null };
export type CourseDeleteResult = "deleted" | "not_found" | "published";

export interface CourseStore {
  list(organizationId: string): Promise<Course[]>;
  get(organizationId: string, courseId: string): Promise<Course | null>;
  create(organizationId: string, input: CourseCreate): Promise<Course>;
  update(organizationId: string, courseId: string, input: CourseUpdate): Promise<Course | null>;
  delete(organizationId: string, courseId: string): Promise<CourseDeleteResult>;
}

export type CourseDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: CourseStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: "list" | "get" | "create" | "update" | "delete"): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });
const courseNotFound = () => json({ error: "course_not_found" }, 404);
const invalidRequest = () => json({ error: "invalid_request" }, 400);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u;

export function isCourseId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string" || controlCharacterPattern.test(value)) return null;
  const title = value.trim();
  const length = [...title].length;
  return length >= 2 && length <= 160 ? title : null;
}

type NormalizedDescription = { valid: true; value: string | null } | { valid: false };

function normalizeDescription(value: unknown): NormalizedDescription {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string" || controlCharacterPattern.test(value)) return { valid: false };
  const description = value.trim();
  if ([...description].length > 4000) return { valid: false };
  return { valid: true, value: description.length === 0 ? null : description };
}

export function parseCourseCreate(value: unknown): CourseCreate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== "title" && key !== "description")) return null;
  const title = normalizeTitle(input.title);
  if (title === null) return null;

  let description: string | null = null;
  if (Object.hasOwn(input, "description")) {
    const normalized = normalizeDescription(input.description);
    if (!normalized.valid) return null;
    description = normalized.value;
  }
  return { title, description };
}

export function parseCourseUpdate(value: unknown): CourseUpdate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => key !== "title" && key !== "description")) return null;

  const update: CourseUpdate = {};
  if (Object.hasOwn(input, "title")) {
    const title = normalizeTitle(input.title);
    if (title === null) return null;
    update.title = title;
  }
  if (Object.hasOwn(input, "description")) {
    const description = normalizeDescription(input.description);
    if (!description.valid) return null;
    update.description = description.value;
  }
  return update;
}

function errorResponse(
  error: unknown,
  operation: "list" | "get" | "create" | "update" | "delete",
  logError?: CourseDependencies["logError"],
) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (logError) logError(operation);
  else console.error("Course request could not be completed.", { operation });
  return json({ error: "course_management_unavailable" }, 503);
}

export function createCourseHandlers(dependencies: CourseDependencies) {
  const requireCourseManagement = async () => {
    const tenant = await dependencies.requireTenantContext();
    await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
    return tenant;
  };

  return {
    async GET(_request?: Request) {
      void _request;
      try {
        const tenant = await requireCourseManagement();
        return json({ courses: await dependencies.store.list(tenant.organizationId) });
      } catch (error) {
        return errorResponse(error, "list", dependencies.logError);
      }
    },

    async POST(request: Request) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        const input = parseCourseCreate(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        return json({ course: await dependencies.store.create(tenant.organizationId, input) }, 201);
      } catch (error) {
        return errorResponse(error, "create", dependencies.logError);
      }
    },

    async GET_ONE(courseId: string) {
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseId(courseId)) return courseNotFound();
        const course = await dependencies.store.get(tenant.organizationId, courseId);
        if (!course) return courseNotFound();
        return json({ course });
      } catch (error) {
        return errorResponse(error, "get", dependencies.logError);
      }
    },

    async PATCH(request: Request, courseId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseId(courseId)) return courseNotFound();
        const input = parseCourseUpdate(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        const course = await dependencies.store.update(tenant.organizationId, courseId, input);
        if (!course) return courseNotFound();
        return json({ course });
      } catch (error) {
        return errorResponse(error, "update", dependencies.logError);
      }
    },

    async DELETE(request: Request, courseId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseId(courseId)) return courseNotFound();
        const result = await dependencies.store.delete(tenant.organizationId, courseId);
        if (result === "not_found") return courseNotFound();
        if (result === "published") {
          return json({ error: "published_course_delete_forbidden" }, 409);
        }
        return json({ deleted: true });
      } catch (error) {
        return errorResponse(error, "delete", dependencies.logError);
      }
    },
  };
}
