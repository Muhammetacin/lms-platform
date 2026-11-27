import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { AuthorizationError } from "@/lib/authorization-core";
import { setCourseCatalogListing } from "@/lib/course-catalog-prisma-store";
import { requireTenantContext, TenantContextError } from "@/lib/tenant-context";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function PUT(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  if (!isTrustedAuthRequest(request)) return json({ error: "invalid_request" }, 403);
  try {
    const { organizationId } = await requireTenantContext();
    await requireOrganizationPermission(organizationId, "MANAGE_COURSES");
    const body = await readJsonBody(request, 256);
    if (typeof body !== "object" || body === null || Object.keys(body).length !== 1 ||
      !("catalogListed" in body) || typeof body.catalogListed !== "boolean") {
      return json({ error: "invalid_request" }, 400);
    }
    const { courseId } = await params;
    const { db } = await import("@/lib/db");
    const saved = await setCourseCatalogListing(db, organizationId, courseId, body.catalogListed);
    return saved ? json({ catalogListed: body.catalogListed }) : json({ error: "course_not_found" }, 404);
  } catch (error) {
    if (error instanceof TenantContextError || error instanceof AuthorizationError) {
      return json({ error: error.code }, error.status);
    }
    console.error("Course catalog listing could not be saved.");
    return json({ error: "catalog_unavailable" }, 503);
  }
}
