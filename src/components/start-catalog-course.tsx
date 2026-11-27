"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function StartCatalogCourse({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "pending" | "closed" | "error">("idle");

  async function start() {
    setStatus("pending");
    try {
      const result = await fetch(`/api/learn/courses/${courseId}/enrollment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!result.ok) {
        setStatus(result.status === 404 ? "closed" : "error");
        return;
      }
      router.push(`/learn/courses/${courseId}`);
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="learner-lesson-action">
      <button className="primary-action" type="button" onClick={start} disabled={status === "pending" || status === "closed"}>
        {status === "pending" ? "Cursus starten…" : "Start cursus"}
      </button>
      {status === "closed" ? <p role="alert">Deze cursus staat niet meer open voor inschrijving.</p> : null}
      {status === "error" ? <p role="alert">De cursus kon niet worden gestart. Probeer opnieuw.</p> : null}
    </div>
  );
}
