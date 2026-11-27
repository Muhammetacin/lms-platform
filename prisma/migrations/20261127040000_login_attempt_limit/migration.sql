-- CreateTable
CREATE TABLE "LoginAttemptBucket" (
    "key" CHAR(64) NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL,

    CONSTRAINT "LoginAttemptBucket_pkey" PRIMARY KEY ("key","windowEnd")
);

-- CreateIndex
CREATE INDEX "LoginAttemptBucket_windowEnd_idx" ON "LoginAttemptBucket"("windowEnd");

ALTER TABLE "LoginAttemptBucket" ADD CONSTRAINT "LoginAttemptBucket_attempts_check" CHECK ("attempts" >= 0);
