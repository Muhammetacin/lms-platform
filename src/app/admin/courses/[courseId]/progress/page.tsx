import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccessUnavailableView, AdminDataUnavailableView } from "@/components/admin-portal-view";
import { builderPageAccessMessage } from "@/lib/course-builder-core";
import { progressCount, progressStatus } from "@/lib/learning-progress";
import { getAssignedCourseProgress } from "@/lib/learning-progress-server";
import "./progress.css";

export const dynamic = "force-dynamic";

export default async function CourseProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { courseId } = await params;
  const { page: pageParameter } = await searchParams;
  const requestedPage = typeof pageParameter === "string" && /^\d+$/.test(pageParameter) ? Number(pageParameter) : 1;
  let result: Awaited<ReturnType<typeof getAssignedCourseProgress>>;
  try {
    result = await getAssignedCourseProgress(courseId, requestedPage > 0 ? requestedPage : 1);
  } catch (error) {
    const access = builderPageAccessMessage(error);
    if (access === "login") redirect("/login");
    if (access === "denied") return <AccessUnavailableView />;
    return <AdminDataUnavailableView />;
  }
  if (!result) notFound();

  const { course, members, page, pageCount } = result;
  const pageUrl = `/admin/courses/${course.id}/progress`;
  return (
    <div className="admin-page course-progress-page" lang="nl">
      <Link className="back-link" href={`/admin/courses/${course.id}`}>← Terug naar cursus</Link>
      <h1>Leervoortgang</h1>
      <p>{course.title}</p>
      {members.length === 0 ? <p>Er zijn geen actieve medewerkers met toegang tot deze cursus.</p> : (
        <>
          <div className="course-progress-table">
            <table aria-label="Voortgang per medewerker">
              <thead>
                <tr><th scope="col">Medewerker</th><th scope="col">Status</th><th scope="col">Lessen</th></tr>
              </thead>
              <tbody>
                {members.map(({ id, name, email, progress }) => (
                  <tr key={id}>
                    <th scope="row">
                      {name}
                      {name !== email ? <span>{email}</span> : null}
                    </th>
                    <td>{progressStatus(progress)}</td>
                    <td>{progressCount(progress)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pageCount > 1 ? (
            <nav className="course-progress-pages" aria-label="Pagina’s leervoortgang">
              {page > 1 ? <Link href={`${pageUrl}?page=${page - 1}`}>Vorige</Link> : null}
              <span>Pagina {page} van {pageCount}</span>
              {page < pageCount ? <Link href={`${pageUrl}?page=${page + 1}`}>Volgende</Link> : null}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
