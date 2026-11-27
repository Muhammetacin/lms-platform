import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LearnerShell } from "@/components/learner-shell";
import { PortalAccessNotice } from "@/components/portal-access-notice";
import { StartCatalogCourse } from "@/components/start-catalog-course";
import { listCourseCatalog } from "@/lib/course-catalog-prisma-store";
import { resolvePortalAccess } from "@/lib/portal-access";
import { getTenantContext } from "@/lib/tenant-context";
import "../courses.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalogus | LMS Platform" };

export default async function CourseCatalogPage() {
  const access = await resolvePortalAccess(getTenantContext);
  const { destination } = access;
  if (destination === "forbidden" || destination === "unavailable") {
    return <PortalAccessNotice reason={destination} />;
  }
  if (destination !== "/learn") redirect(destination);

  let courses: Awaited<ReturnType<typeof listCourseCatalog>>;
  try {
    const { db } = await import("@/lib/db");
    courses = await listCourseCatalog(db, access.tenant);
  } catch {
    return <PortalAccessNotice reason="unavailable" />;
  }

  return (
    <LearnerShell catalog>
      <h1>Catalogus</h1>
      {courses.length === 0 ? (
        <section className="learner-empty" aria-labelledby="empty-catalog">
          <h2 id="empty-catalog">Er staan nog geen cursussen open voor inschrijving</h2>
          <p>Toegewezen cursussen vind je onder <Link href="/learn">Mijn cursussen</Link>.</p>
        </section>
      ) : (
        <ul className="learner-course-list" aria-label="Cursusaanbod">
          {courses.map((course) => (
            <li key={course.id}>
              <h2>{course.title}</h2>
              {course.description ? <p>{course.description}</p> : null}
              {course.accessible ? (
                <div className="learner-lesson-action">
                  <Link href={`/learn/courses/${course.id}`} prefetch={false}>Open cursus</Link>
                </div>
              ) : <StartCatalogCourse courseId={course.id} />}
            </li>
          ))}
        </ul>
      )}
    </LearnerShell>
  );
}
