import type { CourseStatus } from "../generated/prisma/enums.ts";
import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import type { Course } from "./course-core.ts";
import { isCourseId } from "./course-core.ts";
import {
  toCoursePreview,
  type CoursePreviewModule,
  type CoursePreviewStore,
} from "./course-preview-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export type CourseBuilderData = {
  courseId: string;
  status: CourseStatus;
  publishedAt: string | null;
  modules: CoursePreviewModule[];
};

export type CourseBuilderResult =
  | { kind: "ok"; course: Course; builder: CourseBuilderData }
  | { kind: "not_found" };

export type CourseBuilderDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  store: Pick<CoursePreviewStore, "get">;
};

/** Authorize before loading the tenant-scoped Course and its complete builder hierarchy. */
export async function loadManagedCourseBuilder(
  courseId: string,
  dependencies: CourseBuilderDependencies,
): Promise<CourseBuilderResult> {
  const tenant = await dependencies.requireTenantContext();
  await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
  if (!isCourseId(courseId)) return { kind: "not_found" };

  const record = await dependencies.store.get(tenant.organizationId, courseId);
  if (!record) return { kind: "not_found" };

  const preview = toCoursePreview(record);
  return {
    kind: "ok",
    course: {
      id: record.id,
      title: record.title,
      description: record.description,
      status: record.status,
      publishedAt: record.publishedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
    builder: {
      courseId: record.id,
      status: record.status,
      publishedAt: preview.publishedAt,
      modules: preview.modules,
    },
  };
}

export function builderPageAccessMessage(error: unknown): "login" | "denied" | "unavailable" {
  if (
    (error instanceof AuthorizationError && error.code === "unauthenticated") ||
    (error instanceof TenantContextError && error.code === "unauthenticated")
  ) return "login";

  if (
    (error instanceof AuthorizationError && error.code === "forbidden") ||
    (error instanceof TenantContextError && ["no_organization_membership", "invalid_organization_context"].includes(error.code))
  ) return "denied";

  return "unavailable";
}
