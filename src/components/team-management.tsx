"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CourseBuilderDialog } from "@/components/course-builder-dialog";
import { announceCourseBuilderToast, CourseBuilderToastRegion } from "@/components/course-builder-toast-region";
import {
  filterAddableEmployees,
  filterTeams,
  teamApiErrorMessage,
  validateTeamDraft,
  type TeamDraftErrors,
  type TeamEmployeeOption,
  type TeamListItem,
  type TeamMemberItem,
} from "@/lib/team-management-ui-core";

const teamsEndpoint = "/api/organizations/teams";
const employeesEndpoint = "/api/organizations/employees";

class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super("Team API request failed.");
  }
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function teamFromBody(body: unknown): TeamListItem | null {
  if (!isRecord(body) || !isRecord(body.team)) return null;
  const team = body.team;
  if (typeof team.id !== "string" || typeof team.name !== "string") return null;
  return {
    id: team.id,
    name: team.name,
    description: typeof team.description === "string" ? team.description : null,
  };
}

function teamsFromBody(body: unknown): TeamListItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.teams)) return null;
  return body.teams.flatMap((team): TeamListItem[] => {
    if (!isRecord(team) || typeof team.id !== "string" || typeof team.name !== "string") return [];
    return [{
      id: team.id,
      name: team.name,
      description: typeof team.description === "string" ? team.description : null,
    }];
  }).slice(0, 100);
}

function membersFromBody(body: unknown): TeamMemberItem[] | null {
  if (!isRecord(body) || !Array.isArray(body.members)) return null;
  return body.members.flatMap((member): TeamMemberItem[] => {
    if (!isRecord(member) || typeof member.id !== "string" || typeof member.email !== "string") return [];
    return [{
      id: member.id,
      email: member.email,
      employeeName: typeof member.employeeName === "string" ? member.employeeName : null,
      ...(typeof member.jobTitle === "string" || member.jobTitle === null ? { jobTitle: member.jobTitle } : {}),
      ...(typeof member.department === "string" || member.department === null ? { department: member.department } : {}),
    }];
  }).slice(0, 100);
}

function employeesFromBody(body: unknown): TeamEmployeeOption[] | null {
  if (!isRecord(body) || !Array.isArray(body.employees)) return null;
  return body.employees.flatMap((employee): TeamEmployeeOption[] => {
    if (!isRecord(employee) || typeof employee.id !== "string" || typeof employee.email !== "string") return [];
    return [{
      id: employee.id,
      email: employee.email,
      name: typeof employee.name === "string" ? employee.name : null,
      active: employee.active === true,
    }];
  }).slice(0, 100);
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiFailure) return teamApiErrorMessage(error.status, error.body);
  return teamApiErrorMessage(0, null);
}

function readName(name: string | null, email: string): string {
  return name?.trim() || email;
}

export function TeamOverview() {
  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingTeam, setEditingTeam] = useState<TeamListItem | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [teamErrors, setTeamErrors] = useState<TeamDraftErrors>({});
  const [teamError, setTeamError] = useState<string | null>(null);
  const [teamPending, setTeamPending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TeamListItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);

  function retryTeams() {
    setLoading(true);
    setLoadError(null);
    setReloadVersion((value) => value + 1);
  }

  useEffect(() => {
    let cancelled = false;
    void fetch(teamsEndpoint, { cache: "no-store" })
      .then(async (response) => {
        const body = await responseBody(response);
        if (!response.ok) throw new ApiFailure(response.status, body);
        const list = teamsFromBody(body);
        if (!list) throw new ApiFailure(503, null);
        if (!cancelled) setTeams(list);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(failureMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadVersion]);

  const filteredTeams = useMemo(() => filterTeams(teams, search), [teams, search]);
  const teamDirty = dialogMode === "create"
    ? Boolean(teamName || teamDescription)
    : dialogMode === "edit" && editingTeam !== null
      ? teamName !== editingTeam.name || teamDescription !== (editingTeam.description ?? "")
      : false;

  function openCreate() {
    setEditingTeam(null);
    setTeamName("");
    setTeamDescription("");
    setTeamErrors({});
    setTeamError(null);
    setDialogMode("create");
  }

  function openEdit(team: TeamListItem) {
    setEditingTeam(team);
    setTeamName(team.name);
    setTeamDescription(team.description ?? "");
    setTeamErrors({});
    setTeamError(null);
    setDialogMode("edit");
  }

  function closeTeamDialog() {
    if (teamPending) return;
    setDialogMode(null);
    setEditingTeam(null);
    setTeamName("");
    setTeamDescription("");
    setTeamErrors({});
    setTeamError(null);
  }

  async function submitTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (teamPending || !dialogMode) return;
    const validation = validateTeamDraft(teamName, teamDescription);
    setTeamErrors(validation);
    setTeamError(null);
    if (Object.keys(validation).length > 0) return;
    setTeamPending(true);
    try {
      const isEditing = dialogMode === "edit" && editingTeam !== null;
      const url = isEditing ? teamsEndpoint + "/" + encodeURIComponent(editingTeam.id) : teamsEndpoint;
      const response = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: teamName.trim(),
          description: teamDescription.trim() || null,
        }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new ApiFailure(response.status, body);
      const savedTeam = teamFromBody(body);
      if (!savedTeam) throw new ApiFailure(503, null);
      setTeams((current) => isEditing
        ? current.map((team) => team.id === savedTeam.id ? savedTeam : team)
        : [...current, savedTeam].sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)).slice(0, 100));
      closeTeamDialog();
      announceCourseBuilderToast({
        title: isEditing ? "Team updated" : "Team created",
        message: savedTeam.name + " is ready to manage.",
      });
    } catch (error) {
      setTeamError(failureMessage(error));
    } finally {
      setTeamPending(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || deletePending) return;
    setDeleteError(null);
    setDeletePending(true);
    try {
      const response = await fetch(teamsEndpoint + "/" + encodeURIComponent(deleteTarget.id), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const body = await responseBody(response);
      if (!response.ok) throw new ApiFailure(response.status, body);
      setTeams((current) => current.filter((team) => team.id !== deleteTarget.id));
      announceCourseBuilderToast({
        title: "Team deleted",
        message: deleteTarget.name + " and its team memberships were removed.",
      });
      setDeleteTarget(null);
    } catch (error) {
      setDeleteError(failureMessage(error));
    } finally {
      setDeletePending(false);
    }
  }

  return (
    <div className="admin-page team-page">
      <header className="admin-page-header team-page-header">
        <div>
          <p className="admin-eyebrow">Organization</p>
          <h1>Teams</h1>
          <p className="team-page-intro">Group employees by the teams they work with. Employees can belong to more than one team.</p>
        </div>
        <button className="primary-action" type="button" onClick={openCreate}>Create team</button>
      </header>

      {loading ? <p className="team-state" role="status">Loading teams…</p> : null}
      {!loading && loadError ? (
        <section className="team-error-panel" role="alert">
          <h2>Teams are unavailable</h2>
          <p>{loadError}</p>
          <button className="secondary-action" type="button" onClick={retryTeams}>Try again</button>
        </section>
      ) : null}

      {!loading && !loadError && teams.length === 0 ? (
        <section className="admin-empty-state team-empty-state" aria-labelledby="empty-teams-title">
          <div className="employee-empty-icon" aria-hidden="true">◇</div>
          <h2 id="empty-teams-title">No teams yet</h2>
          <p>Create a team to start organizing employees across your organization.</p>
          <button className="primary-action" type="button" onClick={openCreate}>Create your first team</button>
        </section>
      ) : null}

      {!loading && !loadError && teams.length > 0 ? (
        <section className="employee-list-panel team-list-panel" aria-labelledby="team-list-heading">
          <div className="employee-list-panel__heading">
            <div>
              <h2 id="team-list-heading">Organization teams</h2>
              <p>The API returns up to 100 teams. Search checks only the teams loaded here.</p>
            </div>
            <span className="employee-count">{teams.length} loaded</span>
          </div>
          <div className="employee-filters team-filters">
            <div className="form-field">
              <label htmlFor="team-search">Search loaded teams</label>
              <input id="team-search" type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Name or description" />
            </div>
          </div>
          {filteredTeams.length === 0 ? <p className="employee-state" role="status">No teams match this search in the loaded list.</p> : (
            <ul className="employee-list team-list" aria-label="Teams">
              {filteredTeams.map((team) => (
                <li key={team.id}>
                  <article className="employee-card team-card">
                    <div className="team-card__identity">
                      <span className="team-card__mark" aria-hidden="true">◇</span>
                      <div className="employee-card__name">
                        <h3>{team.name}</h3>
                        <p>{team.description || "No description"}</p>
                      </div>
                    </div>
                    <div className="team-card__actions">
                      <Link className="secondary-action" href={"/admin/teams/" + encodeURIComponent(team.id)}>Manage team</Link>
                      <button className="secondary-action" type="button" onClick={() => openEdit(team)}>Edit</button>
                      <button className="employee-inline-danger" type="button" onClick={() => { setDeleteError(null); setDeleteTarget(team); }}>Delete</button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <CourseBuilderDialog
        open={dialogMode !== null}
        title={dialogMode === "edit" ? "Edit team" : "Create team"}
        description={dialogMode === "edit" ? "Update the team name and description." : "Create a team for employees in your organization."}
        dirty={teamDirty}
        pending={teamPending}
        onClose={closeTeamDialog}
      >
        {(requestClose) => <form className="employee-form team-form" onSubmit={submitTeam} noValidate>
          <div className="form-field">
            <label htmlFor="team-name">Team name</label>
            <input id="team-name" name="name" autoFocus value={teamName} maxLength={120} aria-invalid={teamErrors.name ? "true" : undefined} aria-describedby={teamErrors.name ? "team-name-error" : undefined} onChange={(event) => setTeamName(event.currentTarget.value)} required />
            {teamErrors.name ? <p className="field-error" id="team-name-error" role="alert">{teamErrors.name}</p> : null}
          </div>
          <div className="form-field">
            <label htmlFor="team-description">Description <span>(optional)</span></label>
            <textarea id="team-description" name="description" rows={4} maxLength={500} aria-invalid={teamErrors.description ? "true" : undefined} aria-describedby={teamErrors.description ? "team-description-error" : "team-description-hint"} onChange={(event) => setTeamDescription(event.currentTarget.value)} value={teamDescription} />
            {teamErrors.description ? <p className="field-error" id="team-description-error" role="alert">{teamErrors.description}</p> : <p className="field-hint" id="team-description-hint">Up to 500 characters.</p>}
          </div>
          {teamError ? <p className="team-form-error" role="alert">{teamError}</p> : null}
          <div className="form-actions">
            <button className="secondary-action" type="button" disabled={teamPending} onClick={requestClose}>Cancel</button>
            <button className="primary-action" type="submit" disabled={teamPending}>{teamPending ? "Saving…" : dialogMode === "edit" ? "Save changes" : "Create team"}</button>
          </div>
        </form>}
      </CourseBuilderDialog>

      <CourseBuilderDialog
        open={deleteTarget !== null}
        title="Delete team?"
        description="Deleting this team permanently removes its team memberships. Employee accounts are not deleted."
        size="confirmation"
        pending={deletePending}
        onClose={() => { if (!deletePending) { setDeleteTarget(null); setDeleteError(null); } }}
      >
        <div className="team-confirmation">
          <p>Delete <strong>{deleteTarget?.name}</strong> and remove its team memberships? Employees will remain in your organization and may belong to other teams.</p>
          {deleteError ? <p className="team-form-error" role="alert">{deleteError}</p> : null}
          <div className="form-actions">
            <button className="secondary-action" type="button" disabled={deletePending} onClick={() => setDeleteTarget(null)}>Cancel</button>
            <button className="destructive-action" type="button" disabled={deletePending} onClick={() => void confirmDelete()}>{deletePending ? "Deleting…" : "Delete team"}</button>
          </div>
        </div>
      </CourseBuilderDialog>
      <CourseBuilderToastRegion />
    </div>
  );
}

export function TeamDetailPage({ teamId }: { teamId: string }) {
  const [team, setTeam] = useState<TeamListItem | null>(null);
  const [members, setMembers] = useState<TeamMemberItem[]>([]);
  const [employees, setEmployees] = useState<TeamEmployeeOption[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(true);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [addPending, setAddPending] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<TeamMemberItem | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);

  function retryLoad() {
    setTeamLoading(true);
    setMembersLoading(true);
    setEmployeesLoading(true);
    setTeamError(null);
    setMembersError(null);
    setEmployeesError(null);
    setReloadVersion((value) => value + 1);
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const results = await Promise.allSettled([
        fetch(teamsEndpoint + "/" + encodeURIComponent(teamId), { cache: "no-store" }),
        fetch(teamsEndpoint + "/" + encodeURIComponent(teamId) + "/members", { cache: "no-store" }),
        fetch(employeesEndpoint, { cache: "no-store" }),
      ]);
      if (cancelled) return;
      const [teamResult, membersResult, employeesResult] = results;
      if (teamResult.status === "rejected") {
        setTeamError(failureMessage(teamResult.reason));
        setTeam(null);
      } else {
        const body = await responseBody(teamResult.value);
        if (!teamResult.value.ok) {
          setTeamError(teamApiErrorMessage(teamResult.value.status, body));
          setTeam(null);
        } else {
          const loadedTeam = teamFromBody(body);
          if (loadedTeam) setTeam(loadedTeam);
          else { setTeamError("This team is no longer available in your organization."); setTeam(null); }
        }
      }
      setTeamLoading(false);

      if (membersResult.status === "rejected") {
        setMembersError(failureMessage(membersResult.reason));
      } else {
        const body = await responseBody(membersResult.value);
        if (!membersResult.value.ok) setMembersError(membersResult.value.status >= 500
          ? "Team membership is temporarily unavailable. Try again."
          : teamApiErrorMessage(membersResult.value.status, body));
        else {
          const loadedMembers = membersFromBody(body);
          if (loadedMembers) setMembers(loadedMembers);
          else setMembersError("Team members are temporarily unavailable. Try again.");
        }
      }
      setMembersLoading(false);

      if (employeesResult.status === "rejected") {
        setEmployeesError("The employee list could not be reached. Try again shortly.");
      } else {
        const body = await responseBody(employeesResult.value);
        if (!employeesResult.value.ok) {
          setEmployeesError(employeesResult.value.status === 403
            ? "You no longer have permission to view organization employees."
            : "The employee list is temporarily unavailable. Try again shortly.");
        } else {
          const loadedEmployees = employeesFromBody(body);
          if (loadedEmployees) setEmployees(loadedEmployees);
          else setEmployeesError("The employee list is temporarily unavailable. Try again shortly.");
        }
      }
      setEmployeesLoading(false);
    };
    void load().catch(() => {
      if (cancelled) return;
      setTeamError("This team could not be loaded. Try again shortly.");
      setMembersError("Team members are temporarily unavailable. Try again shortly.");
      setEmployeesError("The employee list is temporarily unavailable. Try again shortly.");
      setTeamLoading(false);
      setMembersLoading(false);
      setEmployeesLoading(false);
    });
    return () => { cancelled = true; };
  }, [teamId, reloadVersion]);

  const addableEmployees = useMemo(
    () => filterAddableEmployees(employees, members, employeeSearch),
    [employees, members, employeeSearch],
  );
  const selectedEmployee = employees.find((employee) => employee.id === employeeId);

  function openAdd() {
    setEmployeeSearch("");
    setEmployeeId("");
    setAddError(null);
    setAddOpen(true);
  }

  function closeAdd() {
    if (addPending) return;
    setAddOpen(false);
    setEmployeeSearch("");
    setEmployeeId("");
    setAddError(null);
  }

  async function submitAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addPending) return;
    if (!selectedEmployee || !selectedEmployee.active || !addableEmployees.some((item) => item.id === employeeId)) {
      setAddError("Choose an active employee who is not already on this team.");
      return;
    }
    setAddPending(true);
    setAddError(null);
    try {
      const response = await fetch(teamsEndpoint + "/" + encodeURIComponent(teamId) + "/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      const body = await responseBody(response);
      if (!response.ok) throw new ApiFailure(response.status, body);
      if (!isRecord(body) || !isRecord(body.member)) throw new ApiFailure(503, null);
      const added = membersFromBody({ members: [body.member] })?.[0];
      if (!added) throw new ApiFailure(503, null);
      setMembers((current) => [...current, added].sort((left, right) => readName(left.employeeName, left.email).localeCompare(readName(right.employeeName, right.email)) || left.id.localeCompare(right.id)).slice(0, 100));
      closeAdd();
      announceCourseBuilderToast({ title: "Employee added to team", message: readName(added.employeeName, added.email) + " is now a member of " + (team?.name ?? "this team") + "." });
    } catch (error) {
      setAddError(failureMessage(error));
    } finally {
      setAddPending(false);
    }
  }

  async function confirmRemove() {
    if (!removeTarget || removePending) return;
    setRemovePending(true);
    setRemoveError(null);
    try {
      const response = await fetch(
        teamsEndpoint + "/" + encodeURIComponent(teamId) + "/members/" + encodeURIComponent(removeTarget.id),
        { method: "DELETE", headers: { "Content-Type": "application/json" } },
      );
      const body = await responseBody(response);
      if (!response.ok) throw new ApiFailure(response.status, body);
      setMembers((current) => current.filter((member) => member.id !== removeTarget.id));
      announceCourseBuilderToast({ title: "Employee removed from team", message: readName(removeTarget.employeeName, removeTarget.email) + " remains in your organization and any other teams." });
      setRemoveTarget(null);
    } catch (error) {
      setRemoveError(failureMessage(error));
    } finally {
      setRemovePending(false);
    }
  }

  if (teamLoading) return <div className="admin-page team-detail-page"><p className="team-state" role="status">Loading team…</p></div>;
  if (teamError || !team) {
    return (
      <div className="admin-page team-detail-page">
        <Link className="back-link" href="/admin/teams">← Back to teams</Link>
        <section className="team-error-panel" role="alert">
          <h1>Team unavailable</h1>
          <p>{teamError ?? "This team is no longer available in your organization."}</p>
          <button className="secondary-action" type="button" onClick={retryLoad}>Try again</button>
        </section>
      </div>
    );
  }

  return (
    <div className="admin-page team-detail-page">
      <Link className="back-link" href="/admin/teams">← Back to teams</Link>
      <header className="team-detail-header">
        <div className="team-detail-heading">
          <p className="admin-eyebrow">Team</p>
          <h1>{team.name}</h1>
          <p>{team.description || "No description"}</p>
        </div>
      </header>

      <section className="employee-profile-panel team-members-panel" aria-labelledby="team-members-heading">
        <div className="employee-panel-heading">
          <div>
            <p className="admin-eyebrow">Membership</p>
            <h2 id="team-members-heading">Current active members</h2>
            <p className="team-section-note">The API displays up to 100 active members. Inactive employees are hidden from this list.</p>
          </div>
          <button className="primary-action" type="button" onClick={openAdd} disabled={membersLoading || Boolean(membersError) || employeesLoading || Boolean(employeesError)}>
            Add employee
          </button>
        </div>

        {membersLoading ? <p className="team-state" role="status">Loading team members…</p> : null}
        {!membersLoading && membersError ? (
          <section className="team-error-panel" role="alert">
            <p>{membersError}</p>
            <button className="secondary-action" type="button" onClick={retryLoad}>Try again</button>
          </section>
        ) : null}
        {!membersLoading && !membersError && members.length === 0 ? <p className="employee-state" role="status">This team has no active members yet.</p> : null}
        {!membersLoading && !membersError && members.length > 0 ? (
          <ul className="employee-list team-member-list" aria-label="Active team members">
            {members.map((member) => (
              <li key={member.id}>
                <article className="employee-card team-member-card">
                  <div className="employee-card__identity">
                    <span className="employee-avatar" aria-hidden="true">{readName(member.employeeName, member.email).slice(0, 1).toLocaleUpperCase()}</span>
                    <div className="employee-card__name">
                      <h3>{readName(member.employeeName, member.email)}</h3>
                      <p>{member.email}</p>
                    </div>
                  </div>
                  <dl className="team-member-meta">
                    <div><dt>Job title</dt><dd>{member.jobTitle || "—"}</dd></div>
                    <div><dt>Department</dt><dd>{member.department || "—"}</dd></div>
                  </dl>
                  <div className="team-member-actions">
                    <button className="employee-inline-danger" type="button" onClick={() => { setRemoveError(null); setRemoveTarget(member); }}>Remove</button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        ) : null}
        {employeesError ? (
          <div className="team-inline-warning" role="status">
            <span>{employeesError}</span>
            <button className="secondary-action" type="button" onClick={retryLoad}>Retry employee list</button>
          </div>
        ) : null}
      </section>

      <CourseBuilderDialog
        open={addOpen}
        title="Add employee to team"
        description="Choose an active employee. An employee can belong to multiple teams."
        dirty={Boolean(employeeId)}
        pending={addPending}
        onClose={closeAdd}
      >
        {(requestClose) => <form className="employee-form team-form" onSubmit={submitAdd} noValidate>
          <p className="team-picker-limit">The employee API returns up to 100 employees. Search checks only this loaded list.</p>
          {employeesError ? <p className="team-form-error" role="alert">{employeesError}</p> : null}
          <div className="form-field">
            <label htmlFor="team-employee-search">Search loaded active employees</label>
            <input id="team-employee-search" type="search" value={employeeSearch} onChange={(event) => { setEmployeeSearch(event.currentTarget.value); setEmployeeId(""); }} placeholder="Name or email" />
          </div>
          <div className="form-field">
            <label htmlFor="team-employee-select">Active employee</label>
            <select id="team-employee-select" value={employeeId} onChange={(event) => setEmployeeId(event.currentTarget.value)} disabled={employeesLoading || Boolean(employeesError)} required>
              <option value="">Select an employee</option>
              {addableEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>{readName(employee.name, employee.email)} — {employee.email}</option>
              ))}
            </select>
            {!employeesLoading && !employeesError && addableEmployees.length === 0 ? <p className="field-hint">No active employees in the loaded list are available to add.</p> : null}
          </div>
          {addError ? <p className="team-form-error" role="alert">{addError}</p> : null}
          <div className="form-actions">
            <button className="secondary-action" type="button" disabled={addPending} onClick={requestClose}>Cancel</button>
            <button className="primary-action" type="submit" disabled={addPending || employeesLoading || Boolean(employeesError)}>{addPending ? "Adding…" : "Add to team"}</button>
          </div>
        </form>}
      </CourseBuilderDialog>

      <CourseBuilderDialog
        open={removeTarget !== null}
        title="Remove employee from team?"
        description="This only removes the membership in this team. It does not deactivate or delete the employee."
        size="confirmation"
        pending={removePending}
        onClose={() => { if (!removePending) { setRemoveTarget(null); setRemoveError(null); } }}
      >
        <div className="team-confirmation">
          <p>Remove <strong>{removeTarget ? readName(removeTarget.employeeName, removeTarget.email) : "this employee"}</strong> from {team.name}? They may still belong to other teams.</p>
          {removeError ? <p className="team-form-error" role="alert">{removeError}</p> : null}
          <div className="form-actions">
            <button className="secondary-action" type="button" disabled={removePending} onClick={() => setRemoveTarget(null)}>Cancel</button>
            <button className="destructive-action" type="button" disabled={removePending} onClick={() => void confirmRemove()}>{removePending ? "Removing…" : "Remove from team"}</button>
          </div>
        </div>
      </CourseBuilderDialog>
      <CourseBuilderToastRegion />
    </div>
  );
}
