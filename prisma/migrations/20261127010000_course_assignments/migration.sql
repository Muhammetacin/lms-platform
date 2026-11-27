-- CreateTable
CREATE TABLE "CourseMemberAssignment" (
    "organizationId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseMemberAssignment_pkey" PRIMARY KEY ("courseId","membershipId")
);

-- CreateTable
CREATE TABLE "CourseTeamAssignment" (
    "organizationId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseTeamAssignment_pkey" PRIMARY KEY ("courseId","teamId")
);

-- CreateIndex
CREATE INDEX "CourseMemberAssignment_organizationId_membershipId_idx" ON "CourseMemberAssignment"("organizationId", "membershipId");

-- CreateIndex
CREATE INDEX "CourseTeamAssignment_organizationId_teamId_idx" ON "CourseTeamAssignment"("organizationId", "teamId");

-- AddForeignKey
ALTER TABLE "CourseMemberAssignment" ADD CONSTRAINT "CourseMemberAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMemberAssignment" ADD CONSTRAINT "CourseMemberAssignment_courseId_organizationId_fkey" FOREIGN KEY ("courseId", "organizationId") REFERENCES "Course"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMemberAssignment" ADD CONSTRAINT "CourseMemberAssignment_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTeamAssignment" ADD CONSTRAINT "CourseTeamAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTeamAssignment" ADD CONSTRAINT "CourseTeamAssignment_courseId_organizationId_fkey" FOREIGN KEY ("courseId", "organizationId") REFERENCES "Course"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTeamAssignment" ADD CONSTRAINT "CourseTeamAssignment_teamId_organizationId_fkey" FOREIGN KEY ("teamId", "organizationId") REFERENCES "Team"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
