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

export const GET = handlers.GET;

export async function POST(request: Request) {
  return handlers.POST(request);
}
