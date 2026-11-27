import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { createCourseAssignmentHandlers } from "@/lib/course-assignment-core";
import { createPrismaCourseAssignmentStore } from "@/lib/course-assignment-prisma-store";
import { requireTenantContext } from "@/lib/tenant-context";

const handlers = createCourseAssignmentHandlers({
  requireTenantContext,
  requirePermission: requireOrganizationPermission,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: (request) => readJsonBody(request, 1024),
  async getStore() {
    const { db } = await import("@/lib/db");
    return createPrismaCourseAssignmentStore(db);
  },
});

type Context = { params: Promise<{ courseId: string }> };

export async function GET(request: Request, { params }: Context) {
  return handlers.GET(request, (await params).courseId);
}

export async function PUT(request: Request, { params }: Context) {
  return handlers.PUT(request, (await params).courseId);
}

export async function DELETE(request: Request, { params }: Context) {
  return handlers.DELETE(request, (await params).courseId);
}
