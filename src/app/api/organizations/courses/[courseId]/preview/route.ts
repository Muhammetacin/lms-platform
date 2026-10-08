import { requireOrganizationPermission } from "@/lib/authorization";
import { createCoursePreviewHandlers } from "@/lib/course-preview-core";
import { coursePreviewStore } from "@/lib/course-preview-store";
import { requireTenantContext } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const handlers = createCoursePreviewHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  store: coursePreviewStore,
});

type RouteContext = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { courseId } = await params;
  return handlers.GET(request, courseId);
}
