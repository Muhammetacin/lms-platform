import "server-only";

export const organizationMembershipStore = {
  async findOrganizationRole(userId: string, organizationId: string) {
    const { db } = await import("@/lib/db");
    const membership = await db.organizationMembership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  },

  async findDefaultOrganizationMembership(userId: string) {
    const { db } = await import("@/lib/db");
    return db.organizationMembership.findFirst({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
      select: { organizationId: true, role: true },
    });
  },
};
