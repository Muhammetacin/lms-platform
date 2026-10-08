import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { requireTenantContext } from "@/lib/tenant-context";
import { createCourseModuleHandlers } from "@/lib/course-module-core";
import { courseModuleStore } from "@/lib/course-module-store";

const handlers = createCourseModuleHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: (request) => readJsonBody(request, 20 * 1024),
  store: courseModuleStore,
});

type RouteContext = { params: Promise<{ courseId: string; moduleId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { courseId, moduleId } = await params;
  return handlers.GET_ONE(courseId, moduleId);
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { courseId, moduleId } = await params;
  return handlers.PATCH(request, courseId, moduleId);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { courseId, moduleId } = await params;
  return handlers.DELETE(request, courseId, moduleId);
}
