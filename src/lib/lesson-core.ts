import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import type { LessonType } from "../generated/prisma/enums.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export const lessonTypes = ["TEXT", "VIDEO", "PDF", "IMAGE", "LINK", "QUIZ"] as const;
export type LessonTypeValue = (typeof lessonTypes)[number];

export type LessonRecord = {
  id: string;
  title: string;
  type: LessonType;
  position: number;
  textContent: string | null;
  contentUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LessonSummary = Omit<LessonRecord, "textContent" | "contentUrl">;
export type LessonDetail = Omit<LessonSummary, "type"> & {
  type: LessonType;
  content: { text: string | null } | { url: string | null } | null;
};

export type LessonCreate = { title: string; type: LessonTypeValue };
export type LessonUpdate = { title?: string; type?: LessonTypeValue };
export type LessonContentInput = { textContent: string | null; contentUrl: string | null };

export type LessonMutation<T> =
  | { kind: "ok"; value: T }
  | { kind: "course_not_found" }
  | { kind: "module_not_found" }
  | { kind: "lesson_not_found" }
  | { kind: "published_course_structure_locked" }
  | { kind: "invalid_position" }
  | { kind: "invalid_content" }
  | { kind: "quiz_content_not_available" };

export type LessonRead<T> =
  | { kind: "ok"; value: T }
  | { kind: "course_not_found" }
  | { kind: "module_not_found" }
  | { kind: "lesson_not_found" };

export interface LessonStore {
  list(organizationId: string, courseId: string, moduleId: string): Promise<LessonRead<LessonSummary[]>>;
  get(organizationId: string, courseId: string, moduleId: string, lessonId: string): Promise<LessonRead<LessonRecord>>;
  create(organizationId: string, courseId: string, moduleId: string, input: LessonCreate): Promise<LessonMutation<LessonRecord>>;
  update(organizationId: string, courseId: string, moduleId: string, lessonId: string, input: LessonUpdate): Promise<LessonMutation<LessonRecord>>;
  move(organizationId: string, courseId: string, moduleId: string, lessonId: string, position: number): Promise<LessonMutation<LessonRecord>>;
  delete(organizationId: string, courseId: string, moduleId: string, lessonId: string): Promise<LessonMutation<true>>;
  updateContent(organizationId: string, courseId: string, moduleId: string, lessonId: string, body: unknown): Promise<LessonMutation<LessonRecord>>;
}

export type LessonDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: LessonStore;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
  logError?(operation: LessonOperation): void;
};

type LessonOperation = "list" | "get" | "create" | "update" | "move" | "delete" | "content";

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateJsonHeaders });
const invalidRequest = () => json({ error: "invalid_request" }, 400);
const courseNotFound = () => json({ error: "course_not_found" }, 404);
const moduleNotFound = () => json({ error: "module_not_found" }, 404);
const lessonNotFound = () => json({ error: "lesson_not_found" }, 404);
const structureLocked = () => json({ error: "published_course_structure_locked" }, 409);
const quizContentUnavailable = () => json({ error: "quiz_content_not_available" }, 409);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const titleControlPattern = /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u;
const textControlPattern = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cs}]/u;

export function isLessonBuilderId(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function normalizeTitle(value: unknown): string | null {
  if (typeof value !== "string" || titleControlPattern.test(value)) return null;
  const title = value.trim();
  const length = [...title].length;
  return length >= 2 && length <= 160 ? title : null;
}

function isLessonType(value: unknown): value is LessonTypeValue {
  return typeof value === "string" && (lessonTypes as readonly string[]).includes(value);
}

export function parseLessonCreate(value: unknown): LessonCreate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || Object.keys(input).some((key) => key !== "title" && key !== "type")) return null;
  const title = normalizeTitle(input.title);
  if (title === null || !isLessonType(input.type)) return null;
  return { title, type: input.type };
}

export function parseLessonUpdate(value: unknown): LessonUpdate | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0 || keys.some((key) => key !== "title" && key !== "type")) return null;
  const update: LessonUpdate = {};
  if (Object.hasOwn(input, "title")) {
    const title = normalizeTitle(input.title);
    if (title === null) return null;
    update.title = title;
  }
  if (Object.hasOwn(input, "type")) {
    if (!isLessonType(input.type)) return null;
    update.type = input.type;
  }
  return update;
}

export function parseLessonMove(value: unknown): number | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "position")) return null;
  return Number.isSafeInteger(input.position) && (input.position as number) >= 1
    ? (input.position as number)
    : null;
}

export type ParsedTextContent = { valid: true; value: string | null } | { valid: false };
export function parseLessonTextContent(value: unknown): ParsedTextContent {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string" || textControlPattern.test(value)) return { valid: false };
  const normalized = value.replace(/\r\n?/g, "\n");
  if ([...normalized].length > 100_000) return { valid: false };
  return { valid: true, value: normalized.trim().length === 0 ? null : normalized };
}

export type ParsedLessonUrl = { valid: true; value: string | null } | { valid: false };
export function parseLessonUrl(value: unknown): ParsedLessonUrl {
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string") return { valid: false };
  const urlText = value.trim();
  if (urlText.length === 0) return { valid: true, value: null };
  if ([...urlText].length > 2048) return { valid: false };
  if (/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(urlText)) return { valid: false };
  try {
    const url = new URL(urlText);
    const authority = urlText.slice(urlText.indexOf(":") + 1).replace(/^\/\//, "").split(/[/?#]/, 1)[0] ?? "";
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || authority.includes("@")) {
      return { valid: false };
    }
    return { valid: true, value: url.href };
  } catch {
    return { valid: false };
  }
}

export function parseLessonContent(type: LessonType, body: unknown): LessonContentInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (type === "TEXT") {
    if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "text")) return null;
    const parsed = parseLessonTextContent(input.text);
    return parsed.valid ? { textContent: parsed.value, contentUrl: null } : null;
  }
  if (type === "QUIZ") return null;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "url")) return null;
  const parsed = parseLessonUrl(input.url);
  return parsed.valid ? { textContent: null, contentUrl: parsed.value } : null;
}

export function toLessonDetail(lesson: LessonRecord): LessonDetail {
  const { textContent, contentUrl, ...summary } = lesson;
  if (lesson.type === "QUIZ") return { ...summary, content: null };
  if (lesson.type === "TEXT") return { ...summary, content: { text: textContent } };
  return { ...summary, content: { url: contentUrl } };
}

function errorResponse(error: unknown, operation: LessonOperation, logError?: LessonDependencies["logError"]) {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (logError) logError(operation);
  else console.error("Lesson builder request could not be completed.", { operation });
  return json({ error: "lesson_builder_unavailable" }, 503);
}

function readResponse<T>(result: LessonRead<T>, wrap: (value: T) => unknown): Response {
  switch (result.kind) {
    case "ok": return json(wrap(result.value));
    case "course_not_found": return courseNotFound();
    case "module_not_found": return moduleNotFound();
    case "lesson_not_found": return lessonNotFound();
  }
}

function mutationResponse<T>(result: LessonMutation<T>, wrap: (value: T) => unknown): Response {
  switch (result.kind) {
    case "ok": return json(wrap(result.value));
    case "course_not_found": return courseNotFound();
    case "module_not_found": return moduleNotFound();
    case "lesson_not_found": return lessonNotFound();
    case "published_course_structure_locked": return structureLocked();
    case "invalid_position": return invalidRequest();
    case "invalid_content": return invalidRequest();
    case "quiz_content_not_available": return quizContentUnavailable();
  }
}

export function createLessonHandlers(dependencies: LessonDependencies) {
  const requireCourseManagement = async () => {
    const tenant = await dependencies.requireTenantContext();
    await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
    return tenant;
  };

  return {
    async GET_LIST(courseId: string, moduleId: string, request?: Request) {
      void request;
      try {
        const tenant = await requireCourseManagement();
        if (!isLessonBuilderId(courseId)) return courseNotFound();
        return readResponse(
          await dependencies.store.list(tenant.organizationId, courseId, moduleId),
          (lessons) => ({ lessons }),
        );
      } catch (error) {
        return errorResponse(error, "list", dependencies.logError);
      }
    },

    async POST(request: Request, courseId: string, moduleId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isLessonBuilderId(courseId)) return courseNotFound();
        const input = parseLessonCreate(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        const result = await dependencies.store.create(tenant.organizationId, courseId, moduleId, input);
        if (result.kind === "ok") return json({ lesson: toLessonDetail(result.value) }, 201);
        return mutationResponse<LessonRecord>(result, (lesson) => ({ lesson: toLessonDetail(lesson) }));
      } catch (error) {
        return errorResponse(error, "create", dependencies.logError);
      }
    },

    async GET_ONE(courseId: string, moduleId: string, lessonId: string) {
      try {
        const tenant = await requireCourseManagement();
        if (!isLessonBuilderId(courseId)) return courseNotFound();
        return readResponse(
          await dependencies.store.get(tenant.organizationId, courseId, moduleId, lessonId),
          (lesson) => ({ lesson: toLessonDetail(lesson) }),
        );
      } catch (error) {
        return errorResponse(error, "get", dependencies.logError);
      }
    },

    async PATCH(request: Request, courseId: string, moduleId: string, lessonId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isLessonBuilderId(courseId)) return courseNotFound();
        const input = parseLessonUpdate(await dependencies.readBody(request));
        if (!input) return invalidRequest();
        return mutationResponse<LessonRecord>(
          await dependencies.store.update(tenant.organizationId, courseId, moduleId, lessonId, input),
          (lesson) => ({ lesson: toLessonDetail(lesson) }),
        );
      } catch (error) {
        return errorResponse(error, "update", dependencies.logError);
      }
    },

    async MOVE(request: Request, courseId: string, moduleId: string, lessonId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isLessonBuilderId(courseId)) return courseNotFound();
        const position = parseLessonMove(await dependencies.readBody(request));
        if (position === null) return invalidRequest();
        return mutationResponse<LessonRecord>(
          await dependencies.store.move(tenant.organizationId, courseId, moduleId, lessonId, position),
          (lesson) => ({ lesson: toLessonDetail(lesson) }),
        );
      } catch (error) {
        return errorResponse(error, "move", dependencies.logError);
      }
    },

    async DELETE(request: Request, courseId: string, moduleId: string, lessonId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isLessonBuilderId(courseId)) return courseNotFound();
        const result = await dependencies.store.delete(tenant.organizationId, courseId, moduleId, lessonId);
        if (result.kind === "ok") return json({ deleted: true });
        return mutationResponse<true>(result, () => ({ deleted: true }));
      } catch (error) {
        return errorResponse(error, "delete", dependencies.logError);
      }
    },

    async PUT_CONTENT(request: Request, courseId: string, moduleId: string, lessonId: string) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const tenant = await requireCourseManagement();
        if (!isLessonBuilderId(courseId)) return courseNotFound();
        const body = await dependencies.readBody(request);
        return mutationResponse<LessonRecord>(
          await dependencies.store.updateContent(tenant.organizationId, courseId, moduleId, lessonId, body),
          (lesson) => ({ lesson: toLessonDetail(lesson) }),
        );
      } catch (error) {
        return errorResponse(error, "content", dependencies.logError);
      }
    },
  };
}
