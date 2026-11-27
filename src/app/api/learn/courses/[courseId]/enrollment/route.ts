import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { enrollInCatalogCourse } from "@/lib/course-catalog-prisma-store";
import { requireTenantContext, TenantContextError } from "@/lib/tenant-context";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function PUT(request: Request, { params }: { params: Promise<{ courseId: string }> }) {
  if (!isTrustedAuthRequest(request)) return json({ error: "invalid_request" }, 403);
  try {
    const tenant = await requireTenantContext();
    if (tenant.role !== "MEMBER") return json({ error: "forbidden" }, 403);
    const body = await readJsonBody(request, 256);
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length) {
      return json({ error: "invalid_request" }, 400);
    }
    const { courseId } = await params;
    const { db } = await import("@/lib/db");
    const enrolled = await enrollInCatalogCourse(db, tenant, courseId);
    return enrolled ? json({ enrolled: true }) : json({ error: "course_not_found" }, 404);
  } catch (error) {
    if (error instanceof TenantContextError) return json({ error: error.code }, error.status);
    console.error("Course enrollment could not be saved.");
    return json({ error: "enrollment_unavailable" }, 503);
  }
}
