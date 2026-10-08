import type { PrismaClient } from "../generated/prisma/client.ts";
import type {
  AdminDashboardCounts,
  AdminPortalProfile,
  AdminPortalStore,
} from "./admin-portal-core.ts";

export function createPrismaAdminPortalStore(db: PrismaClient): AdminPortalStore {
  return {
    async getProfile(userId, organizationId): Promise<AdminPortalProfile | null> {
      const [user, organization] = await Promise.all([
        db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
        db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      ]);
      if (!user || !organization) return null;
      return {
        email: user.email,
        name: user.name,
        organizationName: organization.name,
      };
    },

    async getCourseCounts(organizationId): Promise<AdminDashboardCounts> {
      const groups = await db.course.groupBy({
        by: ["status"],
        where: { organizationId },
        _count: { _all: true },
      });
      const counts: AdminDashboardCounts = { total: 0, draft: 0, published: 0 };
      for (const group of groups) {
        const count = group._count._all;
        counts.total += count;
        if (group.status === "DRAFT") counts.draft = count;
        if (group.status === "PUBLISHED") counts.published = count;
      }
      return counts;
    },
  };
}
