"use client";

import { useState } from "react";

export function CourseCatalogControl({ courseId, initialListing }: { courseId: string; initialListing: boolean }) {
  const [listed, setListed] = useState(initialListing);
  const [status, setStatus] = useState<"idle" | "pending" | "error">("idle");

  async function changeListing() {
    setStatus("pending");
    try {
      const result = await fetch(`/api/organizations/courses/${courseId}/catalog`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogListed: !listed }),
      });
      if (!result.ok) {
        setStatus("error");
        return;
      }
      setListed(!listed);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <section className="course-description-panel" aria-labelledby="course-catalog-heading" lang="nl">
      <h2 id="course-catalog-heading">Catalogus</h2>
      <p role="status">{listed ? "Zichtbaar in de catalogus" : "Verborgen in de catalogus"}</p>
      <button className="secondary-action" type="button" disabled={status === "pending"} onClick={changeListing}>
        {status === "pending" ? "Opslaan…" : listed ? "Verberg in catalogus" : "Toon in catalogus"}
      </button>
      {status === "error" ? <p role="alert">De instelling kon niet worden opgeslagen. Probeer opnieuw.</p> : null}
    </section>
  );
}
