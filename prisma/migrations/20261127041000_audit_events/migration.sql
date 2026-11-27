-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('EMPLOYEE_CREATED', 'EMPLOYEE_UPDATED', 'EMPLOYEE_DEACTIVATED', 'EMPLOYEES_IMPORTED', 'TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_DELETED', 'TEAM_MEMBER_ADDED', 'TEAM_MEMBER_REMOVED', 'INVITATION_CREATED', 'INVITATION_ACTIVATED', 'COURSE_MEMBER_GRANTED', 'COURSE_MEMBER_REVOKED', 'COURSE_TEAM_GRANTED', 'COURSE_TEAM_REVOKED');

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "targetId" UUID NOT NULL,
    "relatedId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_id_idx" ON "AuditEvent"("organizationId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
