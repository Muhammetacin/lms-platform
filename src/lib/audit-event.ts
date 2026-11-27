import type { Prisma } from "../generated/prisma/client.ts";
import type { AuditAction } from "../generated/prisma/enums.ts";

export async function recordAuditEvent(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  actorUserId: string | undefined,
  action: AuditAction,
  targetId: string,
  relatedId?: string,
) {
  // Internal fixture and bootstrap calls do not have an authenticated actor.
  if (actorUserId === undefined) return;
  const actor = await transaction.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: actorUserId, organizationId } },
    select: { id: true },
  });
  if (!actor) throw new Error("Audit actor does not belong to the organization.");
  await transaction.auditEvent.create({
    data: { organizationId, actorUserId, action, targetId, relatedId },
  });
}
