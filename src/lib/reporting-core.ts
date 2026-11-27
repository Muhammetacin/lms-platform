import { progressLabels } from "./learning-progress.ts";

export type ReportStatus = keyof typeof progressLabels;
export type ReportFilters = { course: string; team: string; status: ReportStatus | ""; page: number };

export const REPORT_PAGE_SIZE = 25;
export const REPORT_SEARCH_LIMIT = 120;

export function readReportFilters(params: Record<string, string | string[] | undefined>): ReportFilters {
  const text = (value: string | string[] | undefined) =>
    typeof value === "string" ? value.replaceAll("\0", "").trim().slice(0, REPORT_SEARCH_LIMIT) : "";
  const status = params.status;
  const page = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  return {
    course: text(params.course),
    team: text(params.team),
    status: status === "notStarted" || status === "inProgress" || status === "completed" ? status : "",
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

export function reportHref(path: string, filters: ReportFilters, page = 1) {
  const query = new URLSearchParams();
  if (filters.course) query.set("course", filters.course);
  if (filters.team) query.set("team", filters.team);
  if (filters.status) query.set("status", filters.status);
  if (page > 1) query.set("page", String(page));
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
