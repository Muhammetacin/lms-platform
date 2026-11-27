import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CourseContentView } from "@/components/course-preview";
import { LearnerShell } from "@/components/learner-shell";
import { PortalAccessNotice } from "@/components/portal-access-notice";
import type { CoursePreview } from "@/lib/course-preview-core";
import { getLearnerCourseStore } from "@/lib/learner-course-server";
import { resolvePortalAccess } from "@/lib/portal-access";
import { getTenantContext } from "@/lib/tenant-context";
import "../../courses.css";

export const dynamic = "force-dynamic";

export default async function AssignedCoursePage({ params }: { params: Promise<{ courseId: string }> }) {
  const access = await resolvePortalAccess(getTenantContext);
  const { destination } = access;
  if (destination === "forbidden" || destination === "unavailable") {
    return <PortalAccessNotice reason={destination} />;
  }
  if (destination !== "/learn") redirect(destination);

  let course: CoursePreview | null;
  try {
    const { courseId } = await params;
    course = await (await getLearnerCourseStore()).get(access.tenant, courseId);
  } catch {
    return <PortalAccessNotice reason="unavailable" />;
  }
  if (!course) notFound();

  return (
    <LearnerShell>
      <Link className="back-link" href="/learn">← Mijn cursussen</Link>
      <header className="learner-course-heading">
        <h1>{course.title}</h1>
        {course.description ? <p>{course.description}</p> : null}
      </header>
      <CourseContentView modules={course.modules} language="nl" quizCourseId={course.id} />
    </LearnerShell>
  );
}
