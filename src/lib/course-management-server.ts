import "server-only";
import { requireOrganizationPermission } from "@/lib/authorization";
import { courseStore } from "@/lib/course-store";
import { loadManagedCourse } from "@/lib/course-management-core";
import { requireTenantContext } from "@/lib/tenant-context";

export function getManagedCourse(courseId: string) {
  return loadManagedCourse(courseId, {
    requireTenantContext,
    requirePermission: requireOrganizationPermission,
    store: courseStore,
  });
}
