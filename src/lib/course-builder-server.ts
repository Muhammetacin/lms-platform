import "server-only";
import { requireOrganizationPermission } from "@/lib/authorization";
import { coursePreviewStore } from "@/lib/course-preview-store";
import { loadManagedCourseBuilder } from "@/lib/course-builder-core";
import { requireTenantContext } from "@/lib/tenant-context";

export function getManagedCourseBuilder(courseId: string) {
  return loadManagedCourseBuilder(courseId, {
    requireTenantContext,
    requirePermission: requireOrganizationPermission,
    store: coursePreviewStore,
  });
}
