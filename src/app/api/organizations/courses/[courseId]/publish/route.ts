import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { requireTenantContext } from "@/lib/tenant-context";
import { createCoursePublishingHandlers } from "@/lib/course-publishing-core";
import { coursePublishingStore } from "@/lib/course-publishing-store";

const handlers = createCoursePublishingHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: (request) => readJsonBody(request, 1024),
  store: coursePublishingStore,
});

type RouteContext = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  const { courseId } = await params;
  return handlers.POST(request, courseId);
}
