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

type RouteContext = { params: Promise<{ courseId: string; moduleId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { courseId, moduleId } = await params;
  return handlers.GET_LIST(courseId, moduleId, request);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { courseId, moduleId } = await params;
  return handlers.POST(request, courseId, moduleId);
}
