import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LearnerCourseProgress } from "@/components/learner-course-progress";
import { LearnerShell } from "@/components/learner-shell";
import { PortalAccessNotice } from "@/components/portal-access-notice";
import { getLearnerCourseStore, type LearnerCourseStore } from "@/lib/learner-course-server";
import { resolvePortalAccess } from "@/lib/portal-access";
import { getTenantContext } from "@/lib/tenant-context";
import "./courses.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = { title: "Mijn cursussen | LMS Platform" };

export default async function LearnerPage() {
  const access = await resolvePortalAccess(getTenantContext);
  const { destination } = access;
  if (destination === "forbidden" || destination === "unavailable") {
    return <PortalAccessNotice reason={destination} />;
  }
  if (destination !== "/learn") redirect(destination);

  let courses: Awaited<ReturnType<LearnerCourseStore["list"]>>;
  try {
    courses = await (await getLearnerCourseStore()).list(access.tenant);
  } catch {
    return <PortalAccessNotice reason="unavailable" />;
  }

  return (
    <LearnerShell home>
      <h1>Mijn cursussen</h1>
      {courses.length ? (
        <ul className="learner-course-list" aria-label="Mijn cursussen">
          {courses.map((course) => (
            <li key={course.id}>
              <h2><Link href={`/learn/courses/${course.id}`} prefetch={false}>{course.title}</Link></h2>
              {course.description ? <p>{course.description}</p> : null}
              <LearnerCourseProgress progress={course.progress} />
            </li>
          ))}
        </ul>
      ) : (
        <section className="learner-empty" aria-labelledby="learner-empty-title">
          <h2 id="learner-empty-title">Je hebt nog geen cursussen</h2>
          <p>Kies een cursus in de <Link href="/learn/catalog">catalogus</Link> om te beginnen.</p>
        </section>
      )}
    </LearnerShell>
  );
}
