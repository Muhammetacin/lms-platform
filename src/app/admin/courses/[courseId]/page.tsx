import { notFound, redirect } from "next/navigation";
import {
  AccessUnavailableView,
  AdminDataUnavailableView,
} from "@/components/admin-portal-view";
import { CourseDeleteControl } from "@/components/course-delete-control";
import { CourseForm } from "@/components/course-form";
import { CourseManagementDetailView } from "@/components/course-management-view";
import { AuthorizationError } from "@/lib/authorization-core";
import { TenantContextError } from "@/lib/tenant-context-core";
import { getManagedCourse } from "@/lib/course-management-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CoursePageProps = { params: Promise<{ courseId: string }> };

function deniedPage(error: unknown) {
  if (
    (error instanceof AuthorizationError && error.code === "unauthenticated") ||
    (error instanceof TenantContextError && error.code === "unauthenticated")
  ) redirect("/login");

  if (
    (error instanceof AuthorizationError && error.code === "forbidden") ||
    (error instanceof TenantContextError && ["no_organization_membership", "invalid_organization_context"].includes(error.code))
  ) return <AccessUnavailableView />;

  return <AdminDataUnavailableView />;
}

export default async function CourseManagementPage({ params }: CoursePageProps) {
  const { courseId } = await params;
  let result: Awaited<ReturnType<typeof getManagedCourse>>;
  try {
    result = await getManagedCourse(courseId);
  } catch (error) {
    return deniedPage(error);
  }
  if (result.kind === "not_found") notFound();

  const course = result.course;
  return (
    <CourseManagementDetailView
      course={course}
      form={
        <CourseForm
          mode="edit"
          courseId={course.id}
          initialTitle={course.title}
          initialDescription={course.description}
        />
      }
      deleteControl={<CourseDeleteControl courseId={course.id} allowDelete={course.status === "DRAFT"} />}
    />
  );
}
