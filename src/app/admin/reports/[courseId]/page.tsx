import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccessUnavailableView, AdminDataUnavailableView } from "@/components/admin-portal-view";
import { ReportFilters, ReportPagination } from "@/components/report-controls";
import { builderPageAccessMessage } from "@/lib/course-builder-core";
import { progressCount, progressStatus } from "@/lib/learning-progress";
import { readReportFilters, reportHref } from "@/lib/reporting-core";
import { getCourseReport } from "@/lib/reporting-server";
import "../reports.css";

export const dynamic = "force-dynamic";

export default async function CourseReportPage({ params, searchParams }: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { courseId } = await params;
  const filters = readReportFilters(await searchParams);
  let result: Awaited<ReturnType<typeof getCourseReport>>;
  try {
    result = await getCourseReport(courseId, filters);
  } catch (error) {
    const access = builderPageAccessMessage(error);
    if (access === "login") redirect("/login");
    if (access === "denied") return <AccessUnavailableView />;
    return <AdminDataUnavailableView />;
  }
  if (!result) notFound();

  const path = `/admin/reports/${result.course.id}`;
  return (
    <div className="admin-page reports-page" lang="nl">
      <Link className="back-link" href={reportHref("/admin/reports", filters)}>← Rapportage</Link>
      <h1>{result.course.title}</h1>
      <ReportFilters path={path} filters={filters} detail />
      <dl className="report-metrics">
        <div><dt>Toegewezen medewerkers</dt><dd>{result.assigned}</dd></div>
        <div><dt>Medewerkers met minstens één quizinzending</dt><dd>{result.quizParticipants}</dd></div>
      </dl>
      {result.members.length ? (
        <div className="report-table" role="region" aria-label="Rapport per medewerker" tabIndex={0}>
          <table aria-label="Voortgang en quizscores per medewerker">
            <thead>
              <tr>
                <th scope="col">Medewerker</th>
                <th scope="col">Status</th>
                <th scope="col">Lessen</th>
                <th scope="col">Laatste score per quiz</th>
              </tr>
            </thead>
            <tbody>
              {result.members.map(({ membershipId, name, email, completed, total, scores }) => (
                <tr key={membershipId}>
                  <th scope="row">{name}{name !== email ? <span className="report-member-email">{email}</span> : null}</th>
                  <td>{progressStatus({ completed, total })}</td>
                  <td>{progressCount({ completed, total })}</td>
                  <td>
                    {scores.length ? (
                      <ul className="report-quiz-scores">
                        {scores.map(({ lessonId, quizTitle, score, totalQuestions }) => (
                          <li key={lessonId}><strong>{quizTitle}</strong> · {score} van {totalQuestions}</li>
                        ))}
                      </ul>
                    ) : "Geen quizinzending"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="report-empty">
          {filters.page > 1 ? <>Geen medewerkers op deze pagina. <Link href={reportHref(path, filters)}>Naar de eerste pagina</Link></>
            : "Geen toegewezen medewerkers voor deze filters."}
        </p>
      )}
      <ReportPagination path={path} filters={filters} hasNext={result.hasNext} />
    </div>
  );
}
