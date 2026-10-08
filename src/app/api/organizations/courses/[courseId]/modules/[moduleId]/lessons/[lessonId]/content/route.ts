import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { createLessonHandlers } from "@/lib/lesson-core";
import { lessonStore } from "@/lib/lesson-store";
import { requireTenantContext } from "@/lib/tenant-context";

const handlers = createLessonHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: (request) => readJsonBody(request, 512 * 1024),
  store: lessonStore,
});

type RouteContext = { params: Promise<{ courseId: string; moduleId: string; lessonId: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  const { courseId, moduleId, lessonId } = await params;
  return handlers.PUT_CONTENT(request, courseId, moduleId, lessonId);
}
