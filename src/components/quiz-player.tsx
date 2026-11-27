"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LearnerQuiz, QuizSubmission } from "@/lib/learner-quiz-core";
import type { QuizAddress } from "@/lib/quiz-author-core";
import { sameQuizSelections, type QuizResult } from "@/lib/quiz-core";

export function QuizPlayer({ address, quiz }: { address: QuizAddress; quiz: LearnerQuiz }) {
  const router = useRouter();
  const [selections, setSelections] = useState<number[]>(() => quiz.questions.map(() => -1));
  const [result, setResult] = useState(quiz.latestResult);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const submissionRef = useRef<QuizSubmission | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (result) resultHeading.current?.focus();
  }, [result]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;
    if (selections.some((selection) => selection < 0)) {
      setError("Beantwoord alle vragen voordat je de quiz indient.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      if (!submissionRef.current || !sameQuizSelections(submissionRef.current.selections, selections)) {
        submissionRef.current = { submissionId: crypto.randomUUID(), selections };
      }
      const response = await fetch(`/api/learn/courses/${address.courseId}/quizzes/${address.lessonId}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submissionRef.current),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (response.status === 403 || response.status === 404) {
        setError("Deze quiz is niet meer beschikbaar voor jouw account.");
        return;
      }
      if (response.status === 409) submissionRef.current = null;
      if (!response.ok) {
        setError("De quiz kon niet worden ingediend. Probeer het opnieuw.");
        return;
      }
      const body = await response.json() as { result: QuizResult };
      setResult(body.result);
    } catch {
      setError("Indienen kon niet worden bevestigd. Probeer het opnieuw.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  if (result) return (
    <section className="quiz-card" aria-labelledby="quiz-result-title">
      <h2 id="quiz-result-title" ref={resultHeading} tabIndex={-1}>Je score</h2>
      <p role="status">{result.score} van {result.totalQuestions} punten</p>
      <button type="button" className="secondary-action" onClick={() => {
        setResult(null);
        setSelections(quiz.questions.map(() => -1));
        submissionRef.current = null;
      }}>Opnieuw proberen</button>
    </section>
  );

  return (
    <form className="quiz-form" onSubmit={submit} noValidate>
      <p>Kies één antwoord per vraag.</p>
      {quiz.questions.map((question, index) => (
        <fieldset className="quiz-card" key={index} disabled={pending}>
          <legend>{index + 1}. {question.prompt}</legend>
          {question.options.map((option, optionIndex) => (
            <label className="quiz-radio" key={optionIndex}>
              <input type="radio" name={`question-${index}`} checked={selections[index] === optionIndex} onChange={() => {
                setSelections((current) => current.map((value, i) => i === index ? optionIndex : value));
                setError("");
              }} />
              {option}
            </label>
          ))}
        </fieldset>
      ))}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <div className="quiz-actions">
        <button type="submit" className="primary-action" disabled={pending}>{pending ? "Bezig met indienen…" : "Quiz indienen"}</button>
      </div>
    </form>
  );
}
