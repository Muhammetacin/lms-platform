CREATE TABLE "CourseModule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseModule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CourseModule_position_check" CHECK ("position" >= 1)
);

CREATE UNIQUE INDEX "CourseModule_id_organizationId_key"
    ON "CourseModule"("id", "organizationId");

CREATE UNIQUE INDEX "CourseModule_courseId_position_key"
    ON "CourseModule"("courseId", "position");

CREATE INDEX "CourseModule_organizationId_courseId_position_idx"
    ON "CourseModule"("organizationId", "courseId", "position");

ALTER TABLE "CourseModule"
ADD CONSTRAINT "CourseModule_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CourseModule"
ADD CONSTRAINT "CourseModule_courseId_organizationId_fkey"
FOREIGN KEY ("courseId", "organizationId") REFERENCES "Course"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
