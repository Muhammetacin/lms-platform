import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { LearnerShell } from "@/components/learner-shell";
import { PortalAccessNotice } from "@/components/portal-access-notice";
import { QuizPlayer } from "@/components/quiz-player";
import type { LearnerQuiz } from "@/lib/learner-quiz-core";
import { getLearnerQuizStore } from "@/lib/learner-quiz-server";
import { resolvePortalAccess } from "@/lib/portal-access";
import type { QuizAddress } from "@/lib/quiz-author-core";
import { getTenantContext } from "@/lib/tenant-context";
import "@/components/quiz.css";

export const dynamic = "force-dynamic";

export default async function LearnerQuizPage({ params }: { params: Promise<QuizAddress> }) {
  const access = await resolvePortalAccess(getTenantContext);
  const { destination } = access;
  if (destination === "forbidden" || destination === "unavailable") {
    return <PortalAccessNotice reason={destination} />;
  }
  if (destination !== "/learn") redirect(destination);

  const address = await params;
  let quiz: LearnerQuiz | null;
  try {
    quiz = await (await getLearnerQuizStore()).get(access.tenant, address);
  } catch {
    return <PortalAccessNotice reason="unavailable" />;
  }
  if (!quiz) notFound();
  return (
    <LearnerShell>
      <div className="quiz-page">
        <Link className="back-link" href={`/learn/courses/${address.courseId}`}>← Terug naar cursus</Link>
        <h1>{quiz.title}</h1>
        <QuizPlayer address={address} quiz={quiz} />
      </div>
    </LearnerShell>
  );
}
