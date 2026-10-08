import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import {
  AccessUnavailableView,
  AdminDataUnavailableView,
  AdminShellView,
} from "@/components/admin-portal-view";
import { AdminNavigation } from "@/components/admin-navigation";
import { LogoutButton } from "@/components/logout-button";
import { getAdminPortalAccess } from "@/lib/admin-portal-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await getAdminPortalAccess();
  if (access.kind === "unauthenticated") redirect("/login");
  if (access.kind === "forbidden") return <AccessUnavailableView />;
  if (access.kind === "unavailable") return <AdminDataUnavailableView />;

  return (
    <AdminShellView
      profile={access.profile}
      role={access.tenant.role}
      navigation={<AdminNavigation />}
      logoutControl={<LogoutButton />}
    >
      {children}
    </AdminShellView>
  );
}
