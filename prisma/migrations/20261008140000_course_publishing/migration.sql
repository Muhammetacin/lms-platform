ALTER TABLE "Course"
ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "Course"
SET "publishedAt" = "updatedAt"
WHERE "status" = 'PUBLISHED'
  AND "publishedAt" IS NULL;

ALTER TABLE "Course"
ADD CONSTRAINT "Course_status_publishedAt_check"
CHECK (
  ("status" = 'DRAFT' AND "publishedAt" IS NULL)
  OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
);
