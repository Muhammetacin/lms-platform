import { redirect } from "next/navigation";
import {
  AccessUnavailableView,
  AdminDataUnavailableView,
} from "@/components/admin-portal-view";
import { CreateCoursePageView } from "@/components/course-management-view";
import { CourseForm } from "@/components/course-form";
import { getAdminPortalAccess } from "@/lib/admin-portal-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewCoursePage() {
  const access = await getAdminPortalAccess();
  if (access.kind === "unauthenticated") redirect("/login");
  if (access.kind === "forbidden") return <AccessUnavailableView />;
  if (access.kind === "unavailable") return <AdminDataUnavailableView />;

  return <CreateCoursePageView form={<CourseForm mode="create" />} />;
}
