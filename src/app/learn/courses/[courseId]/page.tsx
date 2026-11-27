import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CourseContentView } from "@/components/course-preview";
import { LearnerCourseProgress } from "@/components/learner-course-progress";
import { LearnerLessonProgress } from "@/components/learner-lesson-progress";
import { LearnerShell } from "@/components/learner-shell";
import { PortalAccessNotice } from "@/components/portal-access-notice";
import { getLearnerCourseStore, type LearnerCourseStore } from "@/lib/learner-course-server";
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

  let course: Awaited<ReturnType<LearnerCourseStore["get"]>>;
  try {
    const { courseId } = await params;
    course = await (await getLearnerCourseStore()).get(access.tenant, courseId);
  } catch {
    return <PortalAccessNotice reason="unavailable" />;
  }
  if (!course) notFound();

  return (
    <LearnerShell>
      <Link className="back-link" href="/learn" prefetch={false}>← Mijn cursussen</Link>
      <header className="learner-course-heading">
        <h1>{course.title}</h1>
        {course.description ? <p>{course.description}</p> : null}
        <LearnerCourseProgress progress={course.progress} />
      </header>
      <CourseContentView
        modules={course.modules}
        language="nl"
        quizCourseId={course.id}
        renderLessonProgress={(lesson) => {
          const completed = course.completedLessons.has(lesson.id);
          if (lesson.type === "QUIZ") {
            return completed ? <p className="learner-lesson-completed">Les afgerond</p> : null;
          }
          return <LearnerLessonProgress courseId={course.id} lessonId={lesson.id} completed={completed} />;
        }}
      />
    </LearnerShell>
  );
}
