"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LearnerLessonProgress({ courseId, lessonId, completed }: {
  courseId: string;
  lessonId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "pending" | "saved" | "error">("idle");

  async function completeLesson() {
    setStatus("pending");
    try {
      const result = await fetch(`/api/learn/courses/${courseId}/lessons/${lessonId}/completion`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setStatus("saved");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  if (completed || status === "saved") return <p className="learner-lesson-completed" role="status">Les afgerond</p>;
  return (
    <div className="learner-lesson-action">
      <button className="secondary-action" type="button" disabled={status === "pending"} onClick={completeLesson}>
        {status === "pending" ? "Afronding opslaan…" : "Markeer als afgerond"}
      </button>
      {status === "error" ? <p role="alert">Afronding kon niet worden opgeslagen. Probeer opnieuw.</p> : null}
    </div>
  );
}
