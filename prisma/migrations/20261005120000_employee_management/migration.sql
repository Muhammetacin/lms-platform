-- Add organization-scoped employee state to the existing membership boundary.
ALTER TABLE "OrganizationMembership"
  ADD COLUMN "employeeName" TEXT,
  ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- Supports the bounded organization employee list's deterministic ordering.
CREATE INDEX "OrganizationMembership_organizationId_createdAt_id_idx"
  ON "OrganizationMembership"("organizationId", "createdAt", "id");
