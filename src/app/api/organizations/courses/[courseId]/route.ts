import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { requireTenantContext } from "@/lib/tenant-context";
import { createCourseHandlers } from "@/lib/course-core";
import { courseStore } from "@/lib/course-store";

const handlers = createCourseHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: (request) => readJsonBody(request, 20 * 1024),
  store: courseStore,
});

type Context = { params: Promise<{ courseId: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { courseId } = await params;
  return handlers.GET_ONE(courseId);
}

export async function PATCH(request: Request, { params }: Context) {
  const { courseId } = await params;
  return handlers.PATCH(request, courseId);
}

export async function DELETE(request: Request, { params }: Context) {
  const { courseId } = await params;
  return handlers.DELETE(request, courseId);
}
