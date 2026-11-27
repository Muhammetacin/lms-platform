import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { getLearnerCourseStore } from "@/lib/learner-course-server";
import { requireTenantContext, TenantContextError } from "@/lib/tenant-context";

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function PUT(request: Request, {
  params,
}: { params: Promise<{ courseId: string; lessonId: string }> }) {
  if (!isTrustedAuthRequest(request)) return json({ error: "invalid_request" }, 403);
  try {
    const tenant = await requireTenantContext();
    if (tenant.role !== "MEMBER") return json({ error: "forbidden" }, 403);
    const body = await readJsonBody(request, 256);
    if (typeof body !== "object" || body === null || Array.isArray(body) || Object.keys(body).length) {
      return json({ error: "invalid_request" }, 400);
    }
    const { courseId, lessonId } = await params;
    const completed = await (await getLearnerCourseStore()).completeLesson(tenant, courseId, lessonId);
    if (!completed) return json({ error: "lesson_not_found" }, 404);
    return json({ completed: true });
  } catch (error) {
    if (error instanceof TenantContextError) return json({ error: error.code }, error.status);
    console.error("Lesson completion could not be saved.");
    return json({ error: "progress_unavailable" }, 503);
  }
}
