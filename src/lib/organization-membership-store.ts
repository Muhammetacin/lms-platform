import "server-only";
import { db } from "@/lib/db";

export const organizationMembershipStore = {
  async findOrganizationRole(userId: string, organizationId: string) {
    const membership = await db.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  },

  async findDefaultOrganizationMembership(userId: string) {
    return db.organizationMembership.findFirst({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
      select: { organizationId: true, role: true },
    });
  },
};
