"use client";

import { usePathname } from "next/navigation";
import { AdminNavigationView } from "@/components/admin-portal-view";

export function AdminNavigation() {
  const pathname = usePathname() ?? "";
  return <AdminNavigationView pathname={pathname} />;
}
