-- CreateTable
CREATE TABLE "LessonCompletion" (
    "organizationId" UUID NOT NULL,
    "lessonId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonCompletion_pkey" PRIMARY KEY ("lessonId","membershipId")
);

-- CreateIndex
CREATE INDEX "LessonCompletion_organizationId_membershipId_idx" ON "LessonCompletion"("organizationId", "membershipId");

-- AddForeignKey
ALTER TABLE "LessonCompletion" ADD CONSTRAINT "LessonCompletion_lessonId_organizationId_fkey" FOREIGN KEY ("lessonId", "organizationId") REFERENCES "Lesson"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonCompletion" ADD CONSTRAINT "LessonCompletion_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
