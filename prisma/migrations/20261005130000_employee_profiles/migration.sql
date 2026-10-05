ALTER TABLE "OrganizationMembership"
ADD COLUMN "jobTitle" TEXT,
ADD COLUMN "department" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "employeeNumber" TEXT;

CREATE UNIQUE INDEX "OrganizationMembership_organizationId_employeeNumber_key"
ON "OrganizationMembership"("organizationId", "employeeNumber");
