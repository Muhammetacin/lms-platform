import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AccessUnavailableView, AdminDataUnavailableView } from "@/components/admin-portal-view";
import { QuizEditor } from "@/components/quiz-editor";
import { builderPageAccessMessage } from "@/lib/course-builder-core";
import type { AuthorQuiz, QuizAddress } from "@/lib/quiz-author-core";
import { getAuthorQuiz } from "@/lib/quiz-author-server";
import "@/components/quiz.css";

export const dynamic = "force-dynamic";

export default async function AuthorQuizPage({ params }: { params: Promise<QuizAddress> }) {
  const address = await params;
  let quiz: AuthorQuiz | null;
  try {
    quiz = await getAuthorQuiz(address);
  } catch (error) {
    const access = builderPageAccessMessage(error);
    if (access === "login") redirect("/login");
    if (access === "denied") return <AccessUnavailableView />;
    return <AdminDataUnavailableView />;
  }
  if (!quiz) notFound();

  return (
    <div className="admin-page quiz-page" lang="nl">
      <Link className="back-link" href={`/admin/courses/${address.courseId}`}>← Terug naar cursus</Link>
      <h1>{quiz.title}</h1>
      <QuizEditor address={address} quiz={quiz} />
    </div>
  );
}
