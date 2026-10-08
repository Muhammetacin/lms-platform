import { notFound } from "next/navigation";
import { AuthorizationError } from "@/lib/authorization-core";
import { requireOrganizationPermission } from "@/lib/authorization";
import { CoursePreviewUnavailable, CoursePreviewView } from "@/components/course-preview";
import { loadCoursePreview } from "@/lib/course-preview-core";
import { coursePreviewStore } from "@/lib/course-preview-store";
import { requireTenantContext, TenantContextError } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CoursePreviewPage({
  params,
}: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  let organizationId: string;

  try {
    const tenant = await requireTenantContext();
    await requireOrganizationPermission(tenant.organizationId, "MANAGE_COURSES");
    organizationId = tenant.organizationId;
  } catch (error) {
    if (!(error instanceof AuthorizationError) && !(error instanceof TenantContextError)) {
      console.error("Course preview authorization could not be completed.");
    }
    return <CoursePreviewUnavailable />;
  }

  let result;
  try {
    result = await loadCoursePreview(coursePreviewStore, organizationId, courseId);
  } catch {
    console.error("Course preview page could not be loaded.");
    return <CoursePreviewUnavailable />;
  }

  if (result.kind === "not_found") notFound();
  return <CoursePreviewView course={result.course} />;
}
