ALTER TABLE "Course" ADD COLUMN "catalogListed" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CourseEnrollment" (
    "courseId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseEnrollment_pkey" PRIMARY KEY ("courseId", "membershipId")
);

CREATE INDEX "CourseEnrollment_organizationId_membershipId_idx" ON "CourseEnrollment"("organizationId", "membershipId");

ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_courseId_organizationId_fkey"
    FOREIGN KEY ("courseId", "organizationId") REFERENCES "Course"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseEnrollment" ADD CONSTRAINT "CourseEnrollment_membershipId_organizationId_fkey"
    FOREIGN KEY ("membershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
