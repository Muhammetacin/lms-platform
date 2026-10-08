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

type RouteContext = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { courseId } = await params;
  return handlers.GET_LIST(courseId, request);
}

export async function POST(request: Request, { params }: RouteContext) {
  const { courseId } = await params;
  return handlers.POST(request, courseId);
}
