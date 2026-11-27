-- CreateTable
CREATE TABLE "Quiz" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "lessonId" UUID NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" TEXT[] NOT NULL,
    "correctIndex" INTEGER NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuizQuestion_bounds_check" CHECK (
        "position" BETWEEN 1 AND 20
        AND char_length(btrim("prompt")) BETWEEN 1 AND 300
        AND cardinality("options") BETWEEN 2 AND 6
        AND array_position("options", NULL) IS NULL
        AND "correctIndex" BETWEEN 0 AND cardinality("options") - 1
    )
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "selections" INTEGER[] NOT NULL,
    "score" INTEGER NOT NULL,
    "totalQuestions" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuizAttempt_score_check" CHECK (
        "totalQuestions" BETWEEN 1 AND 20
        AND "score" BETWEEN 0 AND "totalQuestions"
        AND cardinality("selections") = "totalQuestions"
        AND array_position("selections", NULL) IS NULL
        AND 0 <= ALL ("selections") AND 5 >= ALL ("selections")
    )
);

-- CreateIndex
CREATE INDEX "Quiz_organizationId_idx" ON "Quiz"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Quiz_id_organizationId_key" ON "Quiz"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Quiz_lessonId_organizationId_key" ON "Quiz"("lessonId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizQuestion_quizId_position_key" ON "QuizQuestion"("quizId", "position");

-- CreateIndex
CREATE INDEX "QuizAttempt_quizId_membershipId_createdAt_idx" ON "QuizAttempt"("quizId", "membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "QuizAttempt_organizationId_membershipId_idx" ON "QuizAttempt"("organizationId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_quizId_membershipId_submissionId_key" ON "QuizAttempt"("quizId", "membershipId", "submissionId");

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_lessonId_organizationId_fkey" FOREIGN KEY ("lessonId", "organizationId") REFERENCES "Lesson"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_quizId_organizationId_fkey" FOREIGN KEY ("quizId", "organizationId") REFERENCES "Quiz"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_organizationId_fkey" FOREIGN KEY ("quizId", "organizationId") REFERENCES "Quiz"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_membershipId_organizationId_fkey" FOREIGN KEY ("membershipId", "organizationId") REFERENCES "OrganizationMembership"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
