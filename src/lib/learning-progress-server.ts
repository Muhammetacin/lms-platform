import "server-only";
import { requireOrganizationPermission } from "@/lib/authorization";
import { readAssignedCourseProgress } from "@/lib/learning-progress-prisma-store";
import { requireTenantContext } from "@/lib/tenant-context";

export async function getAssignedCourseProgress(courseId: string, page: number) {
  const { organizationId } = await requireTenantContext();
  await requireOrganizationPermission(organizationId, "VIEW_ORGANIZATION_REPORTS");
  const { db } = await import("@/lib/db");
  return readAssignedCourseProgress(db, organizationId, courseId, page);
}
