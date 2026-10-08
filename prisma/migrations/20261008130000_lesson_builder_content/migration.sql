ALTER TABLE "Lesson"
ADD COLUMN "textContent" TEXT,
ADD COLUMN "contentUrl" TEXT;

ALTER TABLE "Lesson"
ADD CONSTRAINT "Lesson_type_content_consistency_check"
CHECK (
  ("type" = 'TEXT' AND "contentUrl" IS NULL)
  OR ("type" IN ('VIDEO', 'PDF', 'IMAGE', 'LINK') AND "textContent" IS NULL)
  OR ("type" = 'QUIZ' AND "textContent" IS NULL AND "contentUrl" IS NULL)
);
