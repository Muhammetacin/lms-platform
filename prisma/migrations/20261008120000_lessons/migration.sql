CREATE TYPE "LessonType" AS ENUM ('TEXT', 'VIDEO', 'PDF', 'IMAGE', 'LINK', 'QUIZ');

CREATE TABLE "Lesson" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "moduleId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" "LessonType" NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Lesson_position_check" CHECK ("position" >= 1)
);

CREATE UNIQUE INDEX "Lesson_id_organizationId_key"
    ON "Lesson"("id", "organizationId");

CREATE UNIQUE INDEX "Lesson_moduleId_position_key"
    ON "Lesson"("moduleId", "position");

CREATE INDEX "Lesson_organizationId_moduleId_position_idx"
    ON "Lesson"("organizationId", "moduleId", "position");

ALTER TABLE "Lesson"
ADD CONSTRAINT "Lesson_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Lesson"
ADD CONSTRAINT "Lesson_moduleId_organizationId_fkey"
FOREIGN KEY ("moduleId", "organizationId") REFERENCES "CourseModule"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
