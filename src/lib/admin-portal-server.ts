import "server-only";
import { requireOrganizationPermission } from "@/lib/authorization";
import { createPrismaAdminPortalStore } from "@/lib/admin-portal-prisma-store";
import { resolveAdminPortalAccess } from "@/lib/admin-portal-core";
import { courseStore } from "@/lib/course-store";
import { requireTenantContext } from "@/lib/tenant-context";

async function getStore() {
  const { db } = await import("@/lib/db");
  return createPrismaAdminPortalStore(db);
}

export async function getAdminPortalAccess() {
  return resolveAdminPortalAccess({
    requireTenantContext,
    requirePermission: requireOrganizationPermission,
    store: {
      async getProfile(userId, organizationId) {
        return (await getStore()).getProfile(userId, organizationId);
      },
    },
  });
}

export async function getAdminDashboardCounts(organizationId: string) {
  return (await getStore()).getCourseCounts(organizationId);
}

export async function getAdminCourses(organizationId: string) {
  return courseStore.list(organizationId);
}
