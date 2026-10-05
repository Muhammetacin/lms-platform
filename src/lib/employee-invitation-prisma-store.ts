import { Prisma } from "../generated/prisma/client.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";
import type {
  EmployeeInvitationStore,
  InvitationCreation,
  InvitationStatus,
  StoredEmployeeInvitation,
} from "./employee-invitation-core.ts";
import { getEmployeeInvitationStatus } from "./employee-invitation-core.ts";

function prismaCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}

function toStoredInvitation(
  invitation: {
    id: string;
    userId: string;
    organizationId: string;
    membershipId: string;
    expiresAt: Date;
    consumedAt: Date | null;
    user: { passwordCredential: { id: string } | null };
    membership: {
      id: string;
      userId: string;
      organizationId: string;
      active: boolean;
      role: string;
    } | null;
  },
): StoredEmployeeInvitation {
  return {
    id: invitation.id,
    userId: invitation.userId,
    organizationId: invitation.organizationId,
    membershipId: invitation.membershipId,
    expiresAt: invitation.expiresAt,
    consumedAt: invitation.consumedAt,
    hasPasswordCredential: invitation.user.passwordCredential !== null,
    membership: invitation.membership,
  };
}

/** Production persistence for the LMS-014 invitation lifecycle. */
export function createPrismaEmployeeInvitationStore(db: PrismaClient): EmployeeInvitationStore {
  return {
    async createInvitation(organizationId, membershipId, tokenHash, expiresAt, now): Promise<InvitationCreation> {
      return db.$transaction(async (transaction) => {
        const membership = await transaction.organizationMembership.findFirst({
          where: { id: membershipId, organizationId },
          select: {
            id: true,
            userId: true,
            organizationId: true,
            active: true,
            role: true,
            user: {
              select: {
                email: true,
                passwordCredential: { select: { id: true } },
              },
            },
          },
        });
        if (!membership) return { status: "not_found" };
        if (!membership.active) return { status: "inactive" };
        if (membership.role !== "MEMBER") return { status: "wrong_role" };
        if (membership.user.passwordCredential) return { status: "existing_credential" };

        await transaction.employeeInvitation.updateMany({
          where: {
            organizationId,
            membershipId,
            userId: membership.userId,
            consumedAt: null,
          },
          data: { consumedAt: now },
        });
        const invitation = await transaction.employeeInvitation.create({
          data: {
            userId: membership.userId,
            organizationId,
            membershipId,
            tokenHash,
            expiresAt,
          },
          select: { id: true },
        });
        return {
          status: "created",
          invitationId: invitation.id,
          email: membership.user.email,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    },

    async invalidateInvitation(invitationId, now) {
      await db.employeeInvitation.updateMany({
        where: { id: invitationId, consumedAt: null },
        data: { consumedAt: now },
      });
    },

    async findInvitation(tokenHash) {
      const invitation = await db.employeeInvitation.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          organizationId: true,
          membershipId: true,
          expiresAt: true,
          consumedAt: true,
          user: { select: { passwordCredential: { select: { id: true } } } },
          membership: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              active: true,
              role: true,
            },
          },
        },
      });
      return invitation ? toStoredInvitation(invitation) : null;
    },

    async activate(tokenHash, passwordHash, now): Promise<InvitationStatus> {
      try {
        return await db.$transaction(async (transaction) => {
          const invitation = await transaction.employeeInvitation.findUnique({
            where: { tokenHash },
            select: {
              id: true,
              userId: true,
              organizationId: true,
              membershipId: true,
              expiresAt: true,
              consumedAt: true,
              user: { select: { passwordCredential: { select: { id: true } } } },
              membership: {
                select: {
                  id: true,
                  userId: true,
                  organizationId: true,
                  active: true,
                  role: true,
                },
              },
            },
          });
          const stored = invitation ? toStoredInvitation(invitation) : null;
          const status = getEmployeeInvitationStatus(stored, now);
          if (status !== "valid" || !invitation) return status;

          const consumed = await transaction.employeeInvitation.updateMany({
            where: { id: invitation.id, consumedAt: null, expiresAt: { gt: now } },
            data: { consumedAt: now },
          });
          if (consumed.count !== 1) return "consumed";

          await transaction.passwordCredential.create({
            data: { userId: invitation.userId, passwordHash },
          });
          return "valid";
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (prismaCode(error) !== "P2002" && prismaCode(error) !== "P2034") throw error;
        const latest = await this.findInvitation(tokenHash);
        return getEmployeeInvitationStatus(latest, now);
      }
    },
  };
}
