import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { createLessonHandlers } from "@/lib/lesson-core";
import { lessonStore } from "@/lib/lesson-store";
import { requireTenantContext } from "@/lib/tenant-context";

const handlers = createLessonHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: (request) => readJsonBody(request, 20 * 1024),
  store: lessonStore,
});

type RouteContext = { params: Promise<{ courseId: string; moduleId: string; lessonId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { courseId, moduleId, lessonId } = await params;
  return handlers.GET_ONE(courseId, moduleId, lessonId);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { courseId, moduleId, lessonId } = await params;
  return handlers.PATCH(request, courseId, moduleId, lessonId);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { courseId, moduleId, lessonId } = await params;
  return handlers.DELETE(request, courseId, moduleId, lessonId);
}
