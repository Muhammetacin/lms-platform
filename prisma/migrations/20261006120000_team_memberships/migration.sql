CREATE TABLE "TeamMembership" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamMembership_organizationId_teamId_idx" ON "TeamMembership"("organizationId", "teamId");

CREATE INDEX "TeamMembership_organizationId_membershipId_idx" ON "TeamMembership"("organizationId", "membershipId");

CREATE UNIQUE INDEX "TeamMembership_teamId_membershipId_key" ON "TeamMembership"("teamId", "membershipId");

CREATE UNIQUE INDEX "OrganizationMembership_id_organizationId_key" ON "OrganizationMembership"("id", "organizationId");

CREATE UNIQUE INDEX "Team_id_organizationId_key" ON "Team"("id", "organizationId");

ALTER TABLE "TeamMembership"
ADD CONSTRAINT "TeamMembership_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMembership"
ADD CONSTRAINT "TeamMembership_teamId_organizationId_fkey"
FOREIGN KEY ("teamId", "organizationId") REFERENCES "Team"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TeamMembership"
ADD CONSTRAINT "TeamMembership_membershipId_organizationId_fkey"
FOREIGN KEY ("membershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
