import { notFound, redirect } from "next/navigation";
import {
  AccessUnavailableView,
  AdminDataUnavailableView,
} from "@/components/admin-portal-view";
import { CourseDeleteControl } from "@/components/course-delete-control";
import { CourseForm } from "@/components/course-form";
import { CourseManagementDetailView } from "@/components/course-management-view";
import { CourseBuilder } from "@/components/course-builder";
import { builderPageAccessMessage } from "@/lib/course-builder-core";
import { getManagedCourseBuilder } from "@/lib/course-builder-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type CoursePageProps = { params: Promise<{ courseId: string }> };

export default async function CourseManagementPage({ params }: CoursePageProps) {
  const { courseId } = await params;
  let result: Awaited<ReturnType<typeof getManagedCourseBuilder>>;
  try {
    result = await getManagedCourseBuilder(courseId);
  } catch (error) {
    const access = builderPageAccessMessage(error);
    if (access === "login") redirect("/login");
    if (access === "denied") return <AccessUnavailableView />;
    return <AdminDataUnavailableView />;
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
      builder={<CourseBuilder builder={result.builder} />}
      deleteControl={<CourseDeleteControl courseId={course.id} allowDelete={course.status === "DRAFT"} />}
    />
  );
}
