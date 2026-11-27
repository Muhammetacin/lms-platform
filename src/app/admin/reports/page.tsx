import Link from "next/link";
import { redirect } from "next/navigation";
import { AccessUnavailableView, AdminDataUnavailableView } from "@/components/admin-portal-view";
import { ReportFilters, ReportPagination } from "@/components/report-controls";
import { builderPageAccessMessage } from "@/lib/course-builder-core";
import { readReportFilters, reportHref } from "@/lib/reporting-core";
import { getCourseReports } from "@/lib/reporting-server";
import "./reports.css";

export const dynamic = "force-dynamic";

const path = "/admin/reports";

export default async function ReportsPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const filters = readReportFilters(await searchParams);
  let result: Awaited<ReturnType<typeof getCourseReports>>;
  try {
    result = await getCourseReports(filters);
  } catch (error) {
    const access = builderPageAccessMessage(error);
    if (access === "login") redirect("/login");
    if (access === "denied") return <AccessUnavailableView />;
    return <AdminDataUnavailableView />;
  }

  return (
    <div className="admin-page reports-page" lang="nl">
      <h1>Rapportage</h1>
      <p className="reports-context">Voortgang van actief toegewezen medewerkers per gepubliceerde cursus.</p>
      <ReportFilters path={path} filters={filters} />
      {result.rows.length ? (
        <div className="report-table" role="region" aria-label="Cursusrapporten" tabIndex={0}>
          <table aria-label="Voortgang per cursus">
            <thead>
              <tr>
                <th scope="col">Cursus</th>
                <th scope="col">Toegewezen</th>
                <th scope="col">Nog niet gestart</th>
                <th scope="col">Bezig</th>
                <th scope="col">Afgerond</th>
                <th scope="col">Quizdeelnemers</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((course) => (
                <tr key={course.id}>
                  <th scope="row"><Link href={reportHref(`${path}/${course.id}`, filters)} prefetch={false}>{course.title}</Link></th>
                  <td>{course.assigned}</td>
                  <td>{course.notStarted}</td>
                  <td>{course.inProgress}</td>
                  <td>{course.completed}</td>
                  <td>{course.quizParticipants}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="report-empty">
          {filters.page > 1 ? <>Geen cursussen op deze pagina. <Link href={reportHref(path, filters)}>Naar de eerste pagina</Link></>
            : "Geen gepubliceerde cursussen voor deze filters."}
        </p>
      )}
      <ReportPagination path={path} filters={filters} hasNext={result.hasNext} />
    </div>
  );
}
