"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { AuthorQuiz, QuizAddress } from "@/lib/quiz-author-core";
import { MAX_QUIZ_OPTIONS, MAX_QUIZ_QUESTIONS, parseQuizDefinition } from "@/lib/quiz-core";

type DraftQuestion = { key: number; prompt: string; options: string[]; correctIndex: number | null };
const blankQuestion = (key: number): DraftQuestion => ({ key, prompt: "", options: ["", ""], correctIndex: null });

export function QuizEditor({ address, quiz }: { address: QuizAddress; quiz: AuthorQuiz }) {
  const router = useRouter();
  const [questions, setQuestions] = useState<DraftQuestion[]>(() =>
    quiz.questions.length ? quiz.questions.map((question, index) => ({ ...question, key: index })) : [blankQuestion(0)],
  );
  const nextKey = useRef(questions.length);
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function updateQuestion(key: number, update: (question: DraftQuestion) => DraftQuestion) {
    setNotice("");
    setError("");
    setQuestions((current) => current.map((question) => question.key === key ? update(question) : question));
  }

  function removeOption(question: DraftQuestion, index: number) {
    return {
      ...question,
      options: question.options.filter((_, optionIndex) => optionIndex !== index),
      correctIndex: question.correctIndex === index ? null
        : question.correctIndex !== null && question.correctIndex > index ? question.correctIndex - 1
          : question.correctIndex,
    };
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quiz.editable || pendingRef.current) return;
    setNotice("");
    const definition = parseQuizDefinition({
      questions: questions.map(({ prompt, options, correctIndex }) => ({ prompt, options, correctIndex })),
    });
    if (!definition) {
      setError("Vul elke vraag en alle unieke antwoordopties in. Kies per vraag één juist antwoord. Gebruik maximaal 300 tekens per vraag en 180 per optie.");
      return;
    }
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/organizations/courses/${address.courseId}/quizzes/${address.lessonId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions: definition }),
      });
      if (response.status === 401) {
        router.replace("/login");
      } else if (response.status === 409) {
        setError("Deze cursus is inmiddels gepubliceerd. De quiz is vergrendeld.");
      } else if (response.status === 404 || response.status === 403) {
        setError("Deze quiz is niet meer beschikbaar voor jouw account.");
      } else if (!response.ok) {
        setError("De quiz kon niet worden opgeslagen. Probeer het opnieuw.");
      } else {
        setQuestions((current) => definition.map((question, index) => ({ ...question, key: current[index]!.key })));
        setNotice("Quiz opgeslagen.");
      }
    } catch {
      setError("Opslaan kon niet worden bevestigd. Controleer de quiz voordat je het opnieuw probeert.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  if (!quiz.editable) return (
    <section aria-label="Gepubliceerde quiz">
      <p>Gepubliceerde quiz · Alleen-lezen</p>
      <ol className="quiz-readonly">
        {quiz.questions.map((question, index) => (
          <li key={index} className="quiz-card">
            <h2>{question.prompt}</h2>
            <ol>
              {question.options.map((option, optionIndex) => (
                <li key={optionIndex}>{option}{question.correctIndex === optionIndex ? " (juist)" : ""}</li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );

  return (
    <form className="quiz-form" onSubmit={save} noValidate>
      <p>Kies per vraag één juist antwoord.</p>
      {questions.map((question, index) => (
        <fieldset className="quiz-card" key={question.key} disabled={pending}>
          <legend>Vraag {index + 1}</legend>
          <div className="form-field">
            <label htmlFor={`quiz-prompt-${question.key}`}>Vraagtekst</label>
            <input id={`quiz-prompt-${question.key}`} value={question.prompt} onChange={(event) => {
              const prompt = event.currentTarget.value;
              updateQuestion(question.key, (current) => ({ ...current, prompt }));
            }} />
          </div>
          {question.options.map((option, optionIndex) => (
            <div key={optionIndex} className="quiz-option">
              <div className="form-field">
                <label htmlFor={`quiz-option-${question.key}-${optionIndex}`}>Optie {optionIndex + 1}</label>
                <input id={`quiz-option-${question.key}-${optionIndex}`} value={option} onChange={(event) => {
                  const text = event.currentTarget.value;
                  updateQuestion(question.key, (current) => ({
                    ...current,
                    options: current.options.map((value, i) => i === optionIndex ? text : value),
                  }));
                }} />
              </div>
              <label className="quiz-radio">
                <input type="radio" name={`quiz-correct-${question.key}`}
                  checked={question.correctIndex === optionIndex}
                  onChange={() => updateQuestion(question.key, (current) => ({ ...current, correctIndex: optionIndex }))} />
                Juist antwoord {optionIndex + 1}
              </label>
              {question.options.length > 2 ? (
                <button type="button" className="secondary-action" onClick={() =>
                  updateQuestion(question.key, (current) => removeOption(current, optionIndex))}>
                  Verwijder optie {optionIndex + 1}
                </button>
              ) : null}
            </div>
          ))}
          <div className="quiz-actions">
            <button type="button" className="secondary-action" disabled={question.options.length >= MAX_QUIZ_OPTIONS}
              onClick={() => updateQuestion(question.key, (current) => ({ ...current, options: [...current.options, ""] }))}>
              Optie toevoegen
            </button>
            {questions.length > 1 ? (
              <button type="button" className="secondary-action" onClick={() => {
                setNotice("");
                setQuestions((current) => current.filter(({ key }) => key !== question.key));
              }}>Verwijder vraag {index + 1}</button>
            ) : null}
          </div>
        </fieldset>
      ))}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <p className="quiz-notice" role="status">{notice}</p>
      <div className="quiz-actions">
        <button type="button" className="secondary-action" disabled={pending || questions.length >= MAX_QUIZ_QUESTIONS}
          onClick={() => {
            const question = blankQuestion(nextKey.current++);
            setNotice("");
            setQuestions((current) => [...current, question]);
          }}>Vraag toevoegen</button>
        <button type="submit" className="primary-action" disabled={pending}>{pending ? "Opslaan…" : "Quiz opslaan"}</button>
      </div>
    </form>
  );
}
