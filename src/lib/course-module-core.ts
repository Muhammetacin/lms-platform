import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type CourseModule = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CourseModuleCreate = { title: string; description: string | null };
export type CourseModuleUpdate = { title?: string; description?: string | null };
export type CourseModuleMutation<T> =
  | { kind: "ok"; value: T }
  | { kind: "course_not_found" }
  | { kind: "module_not_found" }
  | { kind: "published_course_structure_locked" }
  | { kind: "invalid_position" };

export interface CourseModuleStore {
  courseExists(organizationId: string, courseId: string): Promise<boolean>;
  list(organizationId: string, courseId: string): Promise<CourseModule[] | null>;
  get(organizationId: string, courseId: string, moduleId: string): Promise<CourseModule | null>;
  create(
    organizationId: string,
    courseId: string,
    input: CourseModuleCreate,
  ): Promise<CourseModuleMutation<CourseModule>>;
  update(
    organizationId: string,
    courseId: string,
    moduleId: string,
    input: CourseModuleUpdate,
  ): Promise<CourseModuleMutation<CourseModule>>;
  move(
    organizationId: string,
    courseId: string,
    moduleId: string,
    position: number,
  ): Promise<CourseModuleMutation<CourseModule>>;
  delete(
    organizationId: string,
    courseId: string,
    moduleId: string,
  ): Promise<CourseModuleMutation<true>>;
}

export type CourseModuleDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: CourseModuleStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: CourseModuleOperation): void;
};

type CourseModuleOperation = "list" | "get" | "create" | "update" | "move" | "delete";

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });
const courseNotFound = () => json({ error: "course_not_found" }, 404);
const moduleNotFound = () => json({ error: "module_not_found" }, 404);
const invalidRequest = () => json({ error: "invalid_request" }, 400);
const structureLocked = () => json({ error: "published_course_structure_locked" }, 409);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u;

export function isCourseModuleId(value: unknown): value is string {
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

export function parseCourseModuleCreate(value: unknown): CourseModuleCreate | null {
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

export function parseCourseModuleUpdate(value: unknown): CourseModuleUpdate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => key !== "title" && key !== "description")) return null;

  const update: CourseModuleUpdate = {};
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

export function parseCourseModuleMove(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "position")) return null;
  return Number.isSafeInteger(input.position) && (input.position as number) >= 1
    ? (input.position as number)
    : null;
}

function errorResponse(
  error: unknown,
  operation: CourseModuleOperation,
  logError?: CourseModuleDependencies["logError"],
) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (logError) logError(operation);
  else console.error("Course module request could not be completed.", { operation });
  return json({ error: "course_module_management_unavailable" }, 503);
}

function mutationResponse<T>(result: CourseModuleMutation<T>, wrap: (value: T) => unknown): Response {
  switch (result.kind) {
    case "ok":
      return json(wrap(result.value));
    case "course_not_found":
      return courseNotFound();
    case "module_not_found":
      return moduleNotFound();
    case "published_course_structure_locked":
      return structureLocked();
    case "invalid_position":
      return invalidRequest();
  }
}

export function createCourseModuleHandlers(dependencies: CourseModuleDependencies) {
  const requireCourseManagement = async () => {
    const tenant = await dependencies.requireTenantContext();
    await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
    return tenant;
  };

  return {
    async GET_LIST(courseId: string, request?: Request) {
      void request;
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseModuleId(courseId)) return courseNotFound();
        const modules = await dependencies.store.list(tenant.organizationId, courseId);
        if (modules === null) return courseNotFound();
        return json({ modules });
      } catch (error) {
        return errorResponse(error, "list", dependencies.logError);
      }
    },

    async POST(request: Request, courseId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseModuleId(courseId)) return courseNotFound();
        const input = parseCourseModuleCreate(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        const result = await dependencies.store.create(tenant.organizationId, courseId, input);
        if (result.kind === "course_not_found") return courseNotFound();
        if (result.kind === "published_course_structure_locked") return structureLocked();
        if (result.kind !== "ok") throw new Error("Unexpected module creation result.");
        return json({ module: result.value }, 201);
      } catch (error) {
        return errorResponse(error, "create", dependencies.logError);
      }
    },

    async GET_ONE(courseId: string, moduleId: string) {
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseModuleId(courseId)) return courseNotFound();
        if (!(await dependencies.store.courseExists(tenant.organizationId, courseId))) return courseNotFound();
        if (!isCourseModuleId(moduleId)) return moduleNotFound();
        const foundModule = await dependencies.store.get(tenant.organizationId, courseId, moduleId);
        if (!foundModule) return moduleNotFound();
        return json({ module: foundModule });
      } catch (error) {
        return errorResponse(error, "get", dependencies.logError);
      }
    },

    async PATCH(request: Request, courseId: string, moduleId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseModuleId(courseId)) return courseNotFound();
        if (!isCourseModuleId(moduleId)) {
          if (!(await dependencies.store.courseExists(tenant.organizationId, courseId))) return courseNotFound();
          return moduleNotFound();
        }
        const input = parseCourseModuleUpdate(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        return mutationResponse(
          await dependencies.store.update(tenant.organizationId, courseId, moduleId, input),
          (updatedModule) => ({ module: updatedModule }),
        );
      } catch (error) {
        return errorResponse(error, "update", dependencies.logError);
      }
    },

    async MOVE(request: Request, courseId: string, moduleId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseModuleId(courseId)) return courseNotFound();
        if (!isCourseModuleId(moduleId)) {
          if (!(await dependencies.store.courseExists(tenant.organizationId, courseId))) return courseNotFound();
          return moduleNotFound();
        }
        const position = parseCourseModuleMove(await dependencies.readBody(request));
        if (position === null) return invalidRequest();
        return mutationResponse(
          await dependencies.store.move(tenant.organizationId, courseId, moduleId, position),
          (movedModule) => ({ module: movedModule }),
        );
      } catch (error) {
        return errorResponse(error, "move", dependencies.logError);
      }
    },

    async DELETE(request: Request, courseId: string, moduleId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isCourseModuleId(courseId)) return courseNotFound();
        if (!isCourseModuleId(moduleId)) {
          if (!(await dependencies.store.courseExists(tenant.organizationId, courseId))) return courseNotFound();
          return moduleNotFound();
        }
        const result = await dependencies.store.delete(tenant.organizationId, courseId, moduleId);
        if (result.kind === "ok") return json({ deleted: true });
        return mutationResponse(result, () => ({ deleted: true }));
      } catch (error) {
        return errorResponse(error, "delete", dependencies.logError);
      }
    },
  };
}
