"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { CourseBuilderDialog } from "@/components/course-builder-dialog";
import type { CourseAssignmentEntry, CourseAssignmentType } from "@/lib/course-assignment-core";

function errorMessage(status: number): string {
  if (status === 403) return "Je hebt geen toegang tot deze toewijzingen.";
  if (status === 404) return "De cursus of het gekozen doel is niet meer beschikbaar.";
  if (status === 409) return "Publiceer de cursus voordat je die toewijst.";
  return "De aanvraag is mislukt. Probeer het opnieuw.";
}

export function CourseAssignments({ courseId }: { courseId: string }) {
  const router = useRouter();
  const endpoint = `/api/organizations/courses/${encodeURIComponent(courseId)}/assignments`;
  const [assignments, setAssignments] = useState<CourseAssignmentEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [listRevision, setListRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{ type: CourseAssignmentType; query: string }>({ type: "member", query: "" });
  const [candidates, setCandidates] = useState<CourseAssignmentEntry[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [revokeTarget, setRevokeTarget] = useState<CourseAssignmentEntry | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, { signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setListError(errorMessage(response.status));
          return;
        }
        const body = await response.json() as { assignments: CourseAssignmentEntry[] };
        if (!controller.signal.aborted) setAssignments(body.assignments);
      } catch {
        if (!controller.signal.aborted) setListError("De toewijzingen konden niet worden geladen.");
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, listRevision, router]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ type: search.type, q: search.query });
    async function load() {
      try {
        const response = await fetch(`${endpoint}?${params}`, { signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        if (!response.ok) {
          setSearchError(errorMessage(response.status));
          return;
        }
        const body = await response.json() as { candidates: CourseAssignmentEntry[] };
        if (!controller.signal.aborted) setCandidates(body.candidates);
      } catch {
        if (!controller.signal.aborted) setSearchError("De zoekresultaten konden niet worden geladen.");
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, router, search]);

  function refreshList() {
    setListError(null);
    setListRevision((revision) => revision + 1);
  }

  function searchFor(type: CourseAssignmentType, text: string) {
    setSelected("");
    setCandidates(null);
    setSearchError(null);
    setMutationError(null);
    setSearch({ type, query: text.trim() });
  }

  async function updateAssignment(method: "PUT" | "DELETE", target: CourseAssignmentEntry) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setMutationError(null);
    setNotice("");
    try {
      const response = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: target.type, targetId: target.targetId }),
      });
      if (response.status === 401) {
        router.replace("/login");
        return;
      }
      if (!response.ok) {
        setMutationError(errorMessage(response.status));
        return;
      }
      setSelected("");
      setRevokeTarget(null);
      setNotice(method === "PUT" ? "Cursus toegewezen." : "Toewijzing ingetrokken.");
      refreshList();
    } catch {
      setMutationError("De wijziging kon niet worden bevestigd. Vernieuw de lijst voordat je het opnieuw probeert.");
      refreshList();
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const assignedIds = new Set(assignments?.filter(({ type }) => type === search.type).map(({ targetId }) => targetId));
  const available = candidates?.filter(({ targetId }) => !assignedIds.has(targetId));
  const selectedTarget = available?.find(({ targetId }) => targetId === selected);

  function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedTarget) void updateAssignment("PUT", selectedTarget);
  }

  return (
    <>
      <section className="assignment-panel" aria-labelledby="grant-assignment-title">
        <h2 id="grant-assignment-title">Cursus toewijzen</h2>
        <form className="assignment-search" onSubmit={(event) => {
          event.preventDefault();
          searchFor(search.type, query);
        }}>
          <div className="form-field">
            <label htmlFor="assignment-type">Toewijzen aan</label>
            <select id="assignment-type" value={search.type} disabled={pending} onChange={(event) => {
              setQuery("");
              searchFor(event.currentTarget.value === "team" ? "team" : "member", "");
            }}>
              <option value="member">Medewerker</option>
              <option value="team">Team</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="assignment-query">Zoeken</label>
            <input id="assignment-query" type="search" maxLength={100} value={query} disabled={pending}
              onChange={(event) => setQuery(event.currentTarget.value)} />
          </div>
          <button className="secondary-action" type="submit" disabled={pending}>Zoeken</button>
        </form>
        {searchError ? <p className="error-message" role="alert">{searchError}</p> : null}
        {!searchError && candidates === null ? <p role="status">Zoekresultaten laden…</p> : null}
        {available?.length === 0 ? <p>Geen beschikbare resultaten. Probeer een andere zoekterm.</p> : null}
        {candidates?.length === 50 ? <p>Verfijn je zoekopdracht om meer resultaten te vinden.</p> : null}
        <form className="assignment-search" onSubmit={grant}>
          <div className="form-field">
            <label htmlFor="assignment-target">{search.type === "member" ? "Kies een medewerker" : "Kies een team"}</label>
            <select id="assignment-target" value={selected} disabled={pending || !assignments || !available?.length}
              onChange={(event) => setSelected(event.currentTarget.value)}>
              <option value="">Maak een keuze</option>
              {available?.map((item) => (
                <option key={item.targetId} value={item.targetId}>
                  {item.email && item.email !== item.name ? `${item.name} (${item.email})` : item.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="primary-action" disabled={pending || !selectedTarget || !assignments || !!listError}>Toewijzen</button>
        </form>
        {!revokeTarget && mutationError ? <p className="error-message" role="alert">{mutationError}</p> : null}
      </section>
      <section className="assignment-panel" aria-labelledby="current-assignments-title">
        <h2 id="current-assignments-title">Huidige toewijzingen</h2>
        <p role="status">{notice}</p>
        {listError ? (
          <div>
            <p className="error-message" role="alert">{listError}</p>
            <button type="button" className="secondary-action" onClick={refreshList}>Opnieuw laden</button>
          </div>
        ) : null}
        {!listError && assignments === null ? <p role="status">Toewijzingen laden…</p> : null}
        {!listError && assignments?.length === 0 ? <p>Deze cursus heeft nog geen toewijzingen.</p> : null}
        {assignments?.length ? (
          <ul className="assignment-list">
            {assignments.map((item) => (
              <li key={`${item.type}:${item.targetId}`}>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.type === "team" ? "Team" : "Medewerker"}{item.active ? "" : " · Inactief"}</p>
                  {item.email && item.email !== item.name ? <p>{item.email}</p> : null}
                </div>
                <button className="secondary-action" type="button" disabled={pending}
                  aria-label={`Toewijzing intrekken voor ${item.name}`}
                  onClick={() => {
                    setMutationError(null);
                    setRevokeTarget(item);
                  }}>Intrekken</button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <CourseBuilderDialog open={revokeTarget !== null} title="Toewijzing intrekken"
        description={revokeTarget ? `De toewijzing voor ${revokeTarget.name} wordt ingetrokken. Andere toewijzingen blijven geldig.` : undefined}
        size="confirmation" pending={pending} onClose={() => { setMutationError(null); setRevokeTarget(null); }}>
        {(close) => (
          <>
            {mutationError ? <p className="error-message" role="alert">{mutationError}</p> : null}
            <div className="form-actions">
              <button className="secondary-action" type="button" disabled={pending} onClick={close}>Annuleren</button>
              <button className="destructive-action" type="button" disabled={pending}
                onClick={() => revokeTarget && void updateAssignment("DELETE", revokeTarget)}>Intrekken bevestigen</button>
            </div>
          </>
        )}
      </CourseBuilderDialog>
    </>
  );
}
