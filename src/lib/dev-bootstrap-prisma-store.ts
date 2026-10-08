import type { PrismaClient } from "../generated/prisma/client.ts";
import type {
  DevelopmentBootstrapConfig,
  DevelopmentBootstrapStore,
} from "./dev-bootstrap-core.ts";

export function createPrismaDevelopmentBootstrapStore(db: PrismaClient): DevelopmentBootstrapStore {
  return {
    async findSetup(email, organizationSlug) {
      const [user, organization] = await Promise.all([
        db.user.findUnique({
          where: { email },
          select: {
            id: true,
            email: true,
            name: true,
            passwordCredential: { select: { id: true } },
          },
        }),
        db.organization.findUnique({ where: { slug: organizationSlug }, select: { id: true, name: true } }),
      ]);

      const membership = user && organization
        ? await db.organizationMembership.findUnique({
            where: { userId_organizationId: { userId: user.id, organizationId: organization.id } },
            select: { role: true, active: true },
          })
        : null;

      return {
        user: user ? {
          id: user.id,
          email: user.email,
          name: user.name,
          hasPasswordCredential: user.passwordCredential !== null,
        } : null,
        organization,
        membership,
      };
    },

    async createOwnerSetup(config: DevelopmentBootstrapConfig, passwordHash: string) {
      await db.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: { email: config.email, name: config.name },
          select: { id: true },
        });
        const organization = await transaction.organization.create({
          data: { name: config.organizationName, slug: config.organizationSlug },
          select: { id: true },
        });
        await transaction.passwordCredential.create({
          data: { userId: user.id, passwordHash },
        });
        await transaction.organizationMembership.create({
          data: { userId: user.id, organizationId: organization.id, role: "OWNER" },
        });
      }, { isolationLevel: "Serializable" });
    },
  };
}
