import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import { isCourseId } from "./course-core.ts";
import { TenantContextError, type TenantContext } from "./tenant-context-core.ts";

export type CourseAssignmentType = "member" | "team";
export type CourseAssignmentTarget = { type: CourseAssignmentType; targetId: string };
export type CourseAssignmentEntry = CourseAssignmentTarget & {
  name: string;
  email?: string;
  active: boolean;
};

export interface CourseAssignmentStore {
  courseStatus(organizationId: string, courseId: string): Promise<"DRAFT" | "PUBLISHED" | null>;
  list(organizationId: string, courseId: string): Promise<CourseAssignmentEntry[]>;
  search(organizationId: string, type: CourseAssignmentType, query: string): Promise<CourseAssignmentEntry[]>;
  grant(organizationId: string, courseId: string, target: CourseAssignmentTarget): Promise<boolean>;
  revoke(organizationId: string, courseId: string, target: CourseAssignmentTarget): Promise<void>;
}

type Dependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  getStore(): Promise<CourseAssignmentStore>;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
};

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function isAssignmentType(value: unknown): value is CourseAssignmentType {
  return value === "member" || value === "team";
}

function parseTarget(value: unknown): CourseAssignmentTarget | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2 || !("type" in value) || !("targetId" in value)) return null;
  if (!isAssignmentType(value.type) || !isCourseId(value.targetId)) return null;
  return { type: value.type, targetId: value.targetId };
}

export function createCourseAssignmentHandlers(dependencies: Dependencies) {
  async function handle(
    request: Request,
    courseId: string,
    operation: "list" | "grant" | "revoke",
  ): Promise<Response> {
    if (operation !== "list" && !dependencies.isTrustedRequest(request)) {
      return json({ error: "invalid_request" }, 403);
    }

    try {
      const { organizationId } = await dependencies.requireTenantContext();
      await dependencies.requirePermission(organizationId, "ASSIGN_TRAINING");
      if (!isCourseId(courseId)) return json({ error: "course_not_found" }, 404);
      const store = await dependencies.getStore();
      const status = await store.courseStatus(organizationId, courseId);
      if (status === null) return json({ error: "course_not_found" }, 404);
      if (status !== "PUBLISHED") return json({ error: "course_not_published" }, 409);

      if (operation === "list") {
        const params = new URL(request.url).searchParams;
        const type = params.get("type");
        const query = params.get("q")?.trim() ?? "";
        if (type === null && !params.has("q")) {
          return json({ assignments: await store.list(organizationId, courseId) });
        }
        if (!isAssignmentType(type) || query.length > 100 || query.includes("\u0000")) {
          return json({ error: "invalid_request" }, 400);
        }
        return json({ candidates: await store.search(organizationId, type, query) });
      }

      const target = parseTarget(await dependencies.readBody(request));
      if (!target) return json({ error: "invalid_request" }, 400);
      if (operation === "grant") {
        if (!(await store.grant(organizationId, courseId, target))) {
          return json({ error: "assignment_target_not_found" }, 404);
        }
      } else {
        await store.revoke(organizationId, courseId, target);
      }
      return json({ success: true });
    } catch (error) {
      if (error instanceof AuthorizationError || error instanceof TenantContextError) {
        return json({ error: error.code }, error.status);
      }
      console.error("Course assignment request could not be completed.", { operation });
      return json({ error: "course_assignment_unavailable" }, 503);
    }
  }

  return {
    GET: (request: Request, courseId: string) => handle(request, courseId, "list"),
    PUT: (request: Request, courseId: string) => handle(request, courseId, "grant"),
    DELETE: (request: Request, courseId: string) => handle(request, courseId, "revoke"),
  };
}
