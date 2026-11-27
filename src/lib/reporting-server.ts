import "server-only";
import { requireOrganizationPermission } from "@/lib/authorization";
import type { ReportFilters } from "@/lib/reporting-core";
import { listCourseReports, readCourseReport } from "@/lib/reporting-prisma-store";
import { requireTenantContext } from "@/lib/tenant-context";

async function requireReportOrganization() {
  const { organizationId } = await requireTenantContext();
  await requireOrganizationPermission(organizationId, "VIEW_ORGANIZATION_REPORTS");
  return organizationId;
}

export async function getCourseReports(filters: ReportFilters) {
  const organizationId = await requireReportOrganization();
  const { db } = await import("@/lib/db");
  return listCourseReports(db, organizationId, filters);
}

export async function getCourseReport(courseId: string, filters: ReportFilters) {
  const organizationId = await requireReportOrganization();
  const { db } = await import("@/lib/db");
  return readCourseReport(db, organizationId, courseId, filters);
}
