CREATE TABLE "EmployeeInvitation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmployeeInvitation_tokenHash_key" ON "EmployeeInvitation"("tokenHash");
CREATE INDEX "EmployeeInvitation_organizationId_membershipId_idx" ON "EmployeeInvitation"("organizationId", "membershipId");
CREATE INDEX "EmployeeInvitation_userId_idx" ON "EmployeeInvitation"("userId");
CREATE INDEX "EmployeeInvitation_expiresAt_idx" ON "EmployeeInvitation"("expiresAt");

ALTER TABLE "EmployeeInvitation"
ADD CONSTRAINT "EmployeeInvitation_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeInvitation"
ADD CONSTRAINT "EmployeeInvitation_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmployeeInvitation"
ADD CONSTRAINT "EmployeeInvitation_membershipId_fkey"
FOREIGN KEY ("membershipId") REFERENCES "OrganizationMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
