import { redirect } from "next/navigation";
import {
  AccessUnavailableView,
  AdminDashboardView,
  AdminDataUnavailableView,
} from "@/components/admin-portal-view";
import { getAdminDashboardCounts, getAdminPortalAccess } from "@/lib/admin-portal-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminDashboardPage() {
  const access = await getAdminPortalAccess();
  if (access.kind === "unauthenticated") redirect("/login");
  if (access.kind === "forbidden") return <AccessUnavailableView />;
  if (access.kind === "unavailable") return <AdminDataUnavailableView />;

  let counts: Awaited<ReturnType<typeof getAdminDashboardCounts>>;
  try {
    counts = await getAdminDashboardCounts(access.tenant.organizationId);
  } catch {
    return <AdminDataUnavailableView />;
  }
  return <AdminDashboardView profile={access.profile} counts={counts} />;
}
