import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccessUnavailableView, AdminDataUnavailableView } from "@/components/admin-portal-view";
import { CourseAssignments } from "@/components/course-assignments";
import { builderPageAccessMessage } from "@/lib/course-builder-core";
import { getManagedCourse } from "@/lib/course-management-server";
import "./assignments.css";

export const dynamic = "force-dynamic";

export default async function CourseAssignmentsPage({
  params,
}: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  let result: Awaited<ReturnType<typeof getManagedCourse>>;
  try {
    result = await getManagedCourse(courseId);
  } catch (error) {
    const access = builderPageAccessMessage(error);
    if (access === "login") redirect("/login");
    if (access === "denied") return <AccessUnavailableView />;
    return <AdminDataUnavailableView />;
  }
  if (result.kind === "not_found" || result.course.status !== "PUBLISHED") notFound();

  return (
    <div className="admin-page course-assignments" lang="nl">
      <Link className="back-link" href={`/admin/courses/${result.course.id}`}>← Terug naar cursus</Link>
      <h1>Toewijzingen</h1>
      <p className="assignment-course-title">{result.course.title}</p>
      <CourseAssignments courseId={result.course.id} />
    </div>
  );
}
