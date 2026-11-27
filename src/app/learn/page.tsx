import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LearnerShell } from "@/components/learner-shell";
import { PortalAccessNotice } from "@/components/portal-access-notice";
import type { Course } from "@/lib/course-core";
import { getLearnerCourseStore } from "@/lib/learner-course-server";
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

  let courses: Pick<Course, "id" | "title" | "description">[];
  try {
    courses = await (await getLearnerCourseStore()).list(access.tenant);
  } catch {
    return <PortalAccessNotice reason="unavailable" />;
  }

  return (
    <LearnerShell home>
      <h1>Mijn cursussen</h1>
      {courses.length ? (
        <ul className="learner-course-list" aria-label="Toegewezen cursussen">
          {courses.map((course) => (
            <li key={course.id}>
              <h2><Link href={`/learn/courses/${course.id}`} prefetch={false}>{course.title}</Link></h2>
              {course.description ? <p>{course.description}</p> : null}
            </li>
          ))}
        </ul>
      ) : (
        <section className="learner-empty" aria-labelledby="learner-empty-title">
          <h2 id="learner-empty-title">Je hebt nog geen cursussen</h2>
          <p>Zodra een cursus aan je is toegewezen, verschijnt die hier.</p>
        </section>
      )}
    </LearnerShell>
  );
}
