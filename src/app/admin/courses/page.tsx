import { redirect } from "next/navigation";
import {
  AccessUnavailableView,
  AdminCourseListView,
  AdminDataUnavailableView,
} from "@/components/admin-portal-view";
import { getAdminCourses, getAdminPortalAccess } from "@/lib/admin-portal-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminCoursesPage() {
  const access = await getAdminPortalAccess();
  if (access.kind === "unauthenticated") redirect("/login");
  if (access.kind === "forbidden") return <AccessUnavailableView />;
  if (access.kind === "unavailable") return <AdminDataUnavailableView />;

  let courses: Awaited<ReturnType<typeof getAdminCourses>>;
  try {
    courses = await getAdminCourses(access.tenant.organizationId);
  } catch {
    return <AdminDataUnavailableView />;
  }
  return <AdminCourseListView courses={courses} />;
}
