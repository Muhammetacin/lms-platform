import Form from "next/form";
import Link from "next/link";
import { progressLabels } from "@/lib/learning-progress";
import { REPORT_SEARCH_LIMIT, reportHref, type ReportFilters as Filters } from "@/lib/reporting-core";

export function ReportFilters({ path, filters, detail = false }: { path: string; filters: Filters; detail?: boolean }) {
  return (
    <Form action={path} className="report-filters" key={reportHref(path, filters)} aria-label="Rapportfilters">
      {detail && filters.course ? <input type="hidden" name="course" value={filters.course} /> : null}
      {detail ? null : (
        <label className="form-field">
          Cursusnaam
          <input name="course" type="search" maxLength={REPORT_SEARCH_LIMIT} defaultValue={filters.course} />
        </label>
      )}
      <label className="form-field">
        Teamnaam
        <input name="team" type="search" maxLength={REPORT_SEARCH_LIMIT} defaultValue={filters.team} />
      </label>
      <label className="form-field">
        Voortgangsstatus
        <select name="status" defaultValue={filters.status}>
          <option value="">Alle statussen</option>
          {Object.entries(progressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="report-filter-actions">
        <button className="primary-action" type="submit">Filters toepassen</button>
        <Link className="secondary-action" href={detail ? reportHref(path, { ...filters, team: "", status: "" }) : path}>Wissen</Link>
      </div>
    </Form>
  );
}

export function ReportPagination({ path, filters, hasNext }: { path: string; filters: Filters; hasNext: boolean }) {
  if (filters.page === 1 && !hasNext) return null;
  return (
    <nav className="report-pagination" aria-label="Rapportpagina’s">
      {filters.page > 1 ? <Link href={reportHref(path, filters, filters.page - 1)}>Vorige</Link> : null}
      <span>Pagina {filters.page}</span>
      {hasNext ? <Link href={reportHref(path, filters, filters.page + 1)}>Volgende</Link> : null}
    </nav>
  );
}
