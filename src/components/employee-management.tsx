"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CourseBuilderDialog } from "@/components/course-builder-dialog";
import { CourseBuilderToastRegion } from "@/components/course-builder-toast-region";
import { announceCourseBuilderToast } from "@/components/course-builder-toast-region";
import type { Employee } from "@/lib/employee-management-core";
import {
  employeeApiErrorMessage,
  employeeDisplayName,
  employeeImportApiErrorMessage,
  isRecord,
  profileDraftFrom,
  profilePatchFrom,
  validateEmployeeProfileDraft,
  type EmployeeProfileDraft,
} from "@/lib/employee-management-ui-core";
import type { EmployeeProfile } from "@/lib/employee-profile-core";

const employeesEndpoint = "/api/organizations/employees";
const maxImportBytes = 1024 * 1024;
const maxImportRows = 500;

async function readResponseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function employeeListFrom(value: unknown): Employee[] | null {
  if (!isRecord(value) || !Array.isArray(value.employees)) return null;
  if (!value.employees.every((item) => isRecord(item)
      && typeof item.id === "string" && typeof item.email === "string"
      && (typeof item.name === "string" || item.name === null)
      && typeof item.active === "boolean" && ["OWNER", "ADMIN", "MEMBER"].includes(String(item.role))
      && (item.jobTitle === undefined || typeof item.jobTitle === "string" || item.jobTitle === null)
      && (item.department === undefined || typeof item.department === "string" || item.department === null))) return null;
  return value.employees as Employee[];
}

function profileFrom(value: unknown): EmployeeProfile | null {
  if (!isRecord(value) || !isRecord(value.profile)) return null;
  const profile = value.profile;
  if (typeof profile.id !== "string" || typeof profile.email !== "string"
      || typeof profile.active !== "boolean" || !["OWNER", "ADMIN", "MEMBER"].includes(String(profile.role))
      || !["employeeName", "jobTitle", "department", "phone", "employeeNumber"].every((field) =>
        profile[field] === undefined || profile[field] === null || typeof profile[field] === "string")) return null;
  return profile as unknown as EmployeeProfile;
}

function redirectForSession(router: ReturnType<typeof useRouter>) {
  router.replace("/login");
  router.refresh();
}

function InvitationDeliveryNotice() {
  return (
    <aside className="employee-invitation-notice" aria-label="Invitation email delivery">
      <span className="employee-notice-mark" aria-hidden="true">i</span>
      <p><strong>Invitation email delivery is not configured yet.</strong> Employees can be managed here; email delivery depends on LMS-052.</p>
    </aside>
  );
}

export function EmployeeOverview() {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const createPendingRef = useRef(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const importPendingRef = useRef(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [deactivateTarget, setDeactivateTarget] = useState<Employee | null>(null);
  const [deactivatePending, setDeactivatePending] = useState(false);
  const deactivatePendingRef = useRef(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  function reloadEmployees() {
    setLoading(true);
    setLoadError(null);
    setReloadVersion((version) => version + 1);
  }

  useEffect(() => {
    let current = true;
    void fetch(employeesEndpoint, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!current) return;
        if (response.status === 401) {
          redirectForSession(router);
          return;
        }
        const loaded = employeeListFrom(body);
        if (!response.ok || loaded === null) {
          setLoadError(response.status === 403
            ? "You do not have access to view employees in this organization."
            : "Employee data is temporarily unavailable. Try again shortly.");
          return;
        }
        setEmployees(loaded.slice(0, 100));
      })
      .catch(() => {
        if (current) setLoadError("Employee data is temporarily unavailable. Check your connection and try again.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [reloadVersion, router]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredEmployees = employees.filter((employee) => {
    const searchMatches = normalizedSearch === "" || [
      employee.name,
      employee.email,
      employee.jobTitle,
      employee.department,
    ].some((value) => value?.toLocaleLowerCase().includes(normalizedSearch));
    const statusMatches = statusFilter === "all"
      || (statusFilter === "active" ? employee.active : !employee.active);
    const roleMatches = roleFilter === "all" || employee.role === roleFilter;
    return searchMatches && statusMatches && roleMatches;
  });

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createPendingRef.current) return;
    setCreateError(null);
    createPendingRef.current = true;
    setCreatePending(true);
    try {
      const response = await fetch(employeesEndpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: createEmail, name: createName }),
      });
      const body = await readResponseBody(response);
      if (response.status === 401) {
        redirectForSession(router);
        return;
      }
      if (!response.ok) {
        setCreateError(employeeApiErrorMessage(response.status, body));
        return;
      }
      setCreateOpen(false);
      setCreateEmail("");
      setCreateName("");
      reloadEmployees();
      announceCourseBuilderToast({ title: "Employee added", message: "New employees have the MEMBER role. Invitation email delivery is not configured yet." });
    } catch {
      setCreateError("The employee could not be added. Check your connection and try again.");
    } finally {
      createPendingRef.current = false;
      setCreatePending(false);
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importPendingRef.current) return;
    setImportErrors([]);
    if (!importFile) {
      setImportErrors(["Choose a CSV file to continue."]);
      return;
    }
    if (importFile.size > maxImportBytes) {
      setImportErrors(["The CSV file must be no larger than 1 MiB."]);
      return;
    }
    importPendingRef.current = true;
    setImportPending(true);
    try {
      const form = new FormData();
      form.append("file", importFile);
      const response = await fetch(`${employeesEndpoint}/import`, {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const body = await readResponseBody(response);
      if (response.status === 401) {
        redirectForSession(router);
        return;
      }
      if (!response.ok) {
        setImportErrors(employeeImportApiErrorMessage(response.status, body));
        return;
      }
      const imported = isRecord(body) && typeof body.imported === "number" ? body.imported : null;
      if (imported === null) {
        setImportErrors(["The import response could not be confirmed. Reload the employee list before retrying."]);
        return;
      }
      setImportOpen(false);
      setImportFile(null);
      reloadEmployees();
      announceCourseBuilderToast({ title: "Employees imported", message: `${imported} ${imported === 1 ? "employee was" : "employees were"} imported. No invitation emails were sent.` });
    } catch {
      setImportErrors(["The import outcome could not be confirmed. Check the employee list before retrying."]);
    } finally {
      importPendingRef.current = false;
      setImportPending(false);
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget || deactivatePendingRef.current) return;
    deactivatePendingRef.current = true;
    setDeactivatePending(true);
    setDeactivateError(null);
    try {
      const response = await fetch(`${employeesEndpoint}/${encodeURIComponent(deactivateTarget.id)}/deactivate`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await readResponseBody(response);
      if (response.status === 401) {
        redirectForSession(router);
        return;
      }
      if (!response.ok) {
        setDeactivateError(employeeApiErrorMessage(response.status, body));
        return;
      }
      setDeactivateTarget(null);
      reloadEmployees();
      announceCourseBuilderToast({ title: "Employee deactivated", message: `${employeeDisplayName(deactivateTarget)} no longer has access to this organization.` });
    } catch {
      setDeactivateError("The employee could not be deactivated. Check your connection and try again.");
    } finally {
      deactivatePendingRef.current = false;
      setDeactivatePending(false);
    }
  }

  return (
    <>
    <div className="admin-page employee-page">
      <header className="admin-page-header">
        <div>
          <p className="admin-eyebrow">Administration</p>
          <h1>Employees</h1>
          <p className="employee-page-intro">Manage the people and profiles in your organization.</p>
        </div>
        <div className="employee-page-actions">
          <button className="secondary-action" type="button" onClick={() => { setImportFile(null); setImportErrors([]); if (importFileInputRef.current) importFileInputRef.current.value = ""; setImportOpen(true); }}>Import CSV</button>
          <button className="primary-action" type="button" onClick={() => { setCreateError(null); setCreateOpen(true); }}>Add employee</button>
        </div>
      </header>

      <InvitationDeliveryNotice />

      <section className="employee-list-panel" aria-labelledby="employee-list-heading">
        <div className="employee-list-panel__heading">
          <div>
            <h2 id="employee-list-heading">Organization employees</h2>
            <p>Up to 100 employees are loaded. Search and filters apply to this loaded list.</p>
          </div>
          <span className="employee-count">{employees.length} loaded</span>
        </div>

        <div className="employee-filters" aria-label="Employee search and filters">
          <div className="form-field employee-search-field">
            <label htmlFor="employee-search">Search employees</label>
            <input id="employee-search" type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} placeholder="Name, email, title, or department" />
          </div>
          <div className="form-field">
            <label htmlFor="employee-status-filter">Status</label>
            <select id="employee-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}>
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="employee-role-filter">Role</label>
            <select id="employee-role-filter" value={roleFilter} onChange={(event) => setRoleFilter(event.currentTarget.value)}>
              <option value="all">All roles</option>
              <option value="OWNER">Owner</option>
              <option value="ADMIN">Admin</option>
              <option value="MEMBER">Member</option>
            </select>
          </div>
        </div>

        {loading ? <p className="employee-state" role="status">Loading employees…</p> : null}
        {loadError ? (
          <div className="employee-error-panel" role="alert">
            <p>{loadError}</p>
            <button className="secondary-action" type="button" onClick={reloadEmployees}>Try again</button>
          </div>
        ) : null}
        {!loading && !loadError && employees.length === 0 ? (
          <section className="admin-empty-state employee-empty-state" aria-labelledby="empty-employees-title">
            <div className="employee-empty-icon" aria-hidden="true">＋</div>
            <h2 id="empty-employees-title">No employees yet</h2>
            <p>Add an employee or import a CSV to get your organization started.</p>
            <button className="primary-action" type="button" onClick={() => setCreateOpen(true)}>Add your first employee</button>
          </section>
        ) : null}
        {!loading && !loadError && employees.length > 0 && filteredEmployees.length === 0 ? (
          <p className="employee-state" role="status">No employees match these search and filter settings.</p>
        ) : null}
        {!loading && !loadError && filteredEmployees.length > 0 ? (
          <ul className="employee-list" aria-label="Employees">
            {filteredEmployees.map((employee) => (
              <li key={employee.id}>
                <article className="employee-card">
                  <div className="employee-card__identity">
                    <span className="employee-avatar" aria-hidden="true">{employeeDisplayName(employee).slice(0, 1).toLocaleUpperCase()}</span>
                    <div className="employee-card__name">
                      <h3>{employeeDisplayName(employee)}</h3>
                      <p>{employee.email}</p>
                    </div>
                  </div>
                  <dl className="employee-card__meta">
                    <div><dt>Role</dt><dd>{employee.role}</dd></div>
                    <div><dt>Status</dt><dd><span className={`employee-status-badge ${employee.active ? "is-active" : "is-inactive"}`}>{employee.active ? "Active" : "Inactive"}</span></dd></div>
                    <div><dt>Job title</dt><dd>{employee.jobTitle || "—"}</dd></div>
                    <div><dt>Department</dt><dd>{employee.department || "—"}</dd></div>
                  </dl>
                  <div className="employee-card__actions">
                    <Link className="secondary-action" href={`/admin/employees/${encodeURIComponent(employee.id)}`}>View profile</Link>
                    {employee.active ? <button className="employee-inline-danger" type="button" onClick={() => { setDeactivateError(null); setDeactivateTarget(employee); }}>Deactivate</button> : null}
                  </div>
                </article>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <CourseBuilderDialog
        open={createOpen}
        title="Add employee"
        description="Create an organization membership using the employee’s email and name. New employees receive the Member role."
        dirty={Boolean(createEmail || createName)}
        pending={createPending}
        onClose={() => { setCreateOpen(false); setCreateEmail(""); setCreateName(""); setCreateError(null); }}
      >
        {(requestClose) => (
          <form className="employee-form" onSubmit={submitCreate}>
            {createError ? <p className="error-message" role="alert">{createError}</p> : null}
            <div className="form-field">
              <label htmlFor="new-employee-name">Employee name</label>
              <input id="new-employee-name" name="name" value={createName} onChange={(event) => setCreateName(event.currentTarget.value)} minLength={2} maxLength={120} required autoComplete="name" />
            </div>
            <div className="form-field">
              <label htmlFor="new-employee-email">Email</label>
              <input id="new-employee-email" name="email" type="email" value={createEmail} onChange={(event) => setCreateEmail(event.currentTarget.value)} maxLength={254} required autoComplete="email" />
              <p className="form-hint">Email and name are used to create the account. No invitation email will be sent.</p>
            </div>
            <div className="form-actions">
              <button className="secondary-action" type="button" disabled={createPending} onClick={requestClose}>Cancel</button>
              <button className="primary-action" type="submit" disabled={createPending}>{createPending ? "Adding…" : "Add employee"}</button>
            </div>
          </form>
        )}
      </CourseBuilderDialog>

      <CourseBuilderDialog
        open={importOpen}
        title="Import employees"
        description="Upload one CSV. The complete batch is validated before any employee is added."
        dirty={importFile !== null}
        pending={importPending}
        onClose={() => {
          setImportOpen(false);
          setImportFile(null);
          setImportErrors([]);
          if (importFileInputRef.current) importFileInputRef.current.value = "";
        }}
      >
        {(requestClose) => (
          <form className="employee-form" onSubmit={submitImport}>
            {importErrors.length > 0 ? <div className="employee-import-errors" role="alert" aria-label="Import errors"><p>Review the import status and any issues below before retrying:</p><ul>{importErrors.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul></div> : null}
            <div className="form-field">
              <label htmlFor="employee-csv-file">CSV file</label>
              <input ref={importFileInputRef} id="employee-csv-file" name="file" type="file" accept=".csv,text/csv" required disabled={importPending} onChange={(event) => { setImportFile(event.currentTarget.files?.[0] ?? null); setImportErrors([]); }} />
              <p className="form-hint">Required headers: email,name. Optional: jobTitle,department,phone,employeeNumber. Maximum 1 MiB and {maxImportRows} employees.</p>
            </div>
            <div className="form-actions">
              <button className="secondary-action" type="button" disabled={importPending} onClick={requestClose}>Cancel</button>
              <button className="primary-action" type="submit" disabled={importPending || !importFile}>{importPending ? "Importing…" : "Import employees"}</button>
            </div>
          </form>
        )}
      </CourseBuilderDialog>

      <CourseBuilderDialog
        open={deactivateTarget !== null}
        title="Deactivate employee?"
        description={deactivateTarget ? `${employeeDisplayName(deactivateTarget)} will lose access to this organization. Their account and other organization memberships are not deleted.` : undefined}
        size="confirmation"
        pending={deactivatePending}
        onClose={() => { setDeactivateTarget(null); setDeactivateError(null); }}
      >
        <div className="employee-confirmation">
          {deactivateError ? <p className="error-message" role="alert">{deactivateError}</p> : null}
          <div className="form-actions">
            <button className="secondary-action" type="button" disabled={deactivatePending} onClick={() => setDeactivateTarget(null)}>Cancel</button>
            <button className="destructive-action" type="button" disabled={deactivatePending} onClick={() => void confirmDeactivate()}>{deactivatePending ? "Deactivating…" : "Deactivate employee"}</button>
          </div>
        </div>
      </CourseBuilderDialog>
    </div>
    <CourseBuilderToastRegion />
    </>
  );
}

export function EmployeeProfilePage({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EmployeeProfileDraft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof EmployeeProfileDraft, string>>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const savePendingRef = useRef(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivatePending, setDeactivatePending] = useState(false);
  const deactivatePendingRef = useRef(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  function reloadProfile() {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    setReloadVersion((version) => version + 1);
  }

  useEffect(() => {
    let current = true;
    void fetch(`${employeesEndpoint}/${encodeURIComponent(employeeId)}/profile`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const body = await readResponseBody(response);
        if (!current) return;
        if (response.status === 401) {
          redirectForSession(router);
          return;
        }
        if (response.status === 404) {
          setNotFound(true);
          return;
        }
        const loaded = profileFrom(body);
        if (!response.ok || loaded === null) {
          setLoadError(response.status === 403
            ? "You do not have access to this employee profile."
            : "Employee profile is temporarily unavailable. Try again shortly.");
          return;
        }
        setProfile(loaded);
      })
      .catch(() => { if (current) setLoadError("Employee profile is temporarily unavailable. Check your connection and try again."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [employeeId, reloadVersion, router]);

  const cleanDraft = profile ? profileDraftFrom(profile) : null;
  const dirty = Boolean(draft && cleanDraft && JSON.stringify(draft) !== JSON.stringify(cleanDraft));

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !draft || savePendingRef.current) return;
    const validation = validateEmployeeProfileDraft(draft, profile.employeeName !== null);
    setFieldErrors(validation);
    setSaveError(null);
    if (Object.keys(validation).length > 0) return;
    savePendingRef.current = true;
    setSavePending(true);
    try {
      const response = await fetch(`${employeesEndpoint}/${encodeURIComponent(profile.id)}/profile`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profilePatchFrom(draft)),
      });
      const body = await readResponseBody(response);
      if (response.status === 401) {
        redirectForSession(router);
        return;
      }
      if (!response.ok) {
        setSaveError(employeeApiErrorMessage(response.status, body));
        return;
      }
      const updated = profileFrom(body);
      if (!updated) {
        setSaveError("The profile was saved, but the updated details could not be confirmed. Reload this page.");
        return;
      }
      setProfile(updated);
      setDraft(profileDraftFrom(updated));
      setEditing(false);
      announceCourseBuilderToast({ title: "Profile saved", message: "Employee profile changes were saved." });
    } catch {
      setSaveError("The employee profile could not be saved. Check your connection and try again.");
    } finally {
      savePendingRef.current = false;
      setSavePending(false);
    }
  }

  async function confirmDeactivate() {
    if (!profile || deactivatePendingRef.current) return;
    deactivatePendingRef.current = true;
    setDeactivatePending(true);
    setDeactivateError(null);
    try {
      const response = await fetch(`${employeesEndpoint}/${encodeURIComponent(profile.id)}/deactivate`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await readResponseBody(response);
      if (response.status === 401) {
        redirectForSession(router);
        return;
      }
      if (!response.ok) {
        setDeactivateError(employeeApiErrorMessage(response.status, body));
        return;
      }
      setProfile({ ...profile, active: false });
      setConfirmingDeactivate(false);
      announceCourseBuilderToast({ title: "Employee deactivated", message: `${profile.employeeName || profile.email} no longer has access to this organization.` });
    } catch {
      setDeactivateError("The employee could not be deactivated. Check your connection and try again.");
    } finally {
      deactivatePendingRef.current = false;
      setDeactivatePending(false);
    }
  }

  if (loading) return <div className="admin-page employee-profile-page"><p className="employee-state" role="status">Loading employee profile…</p></div>;
  if (notFound) return (
    <div className="admin-page employee-profile-page">
      <Link className="back-link" href="/admin/employees">← Back to employees</Link>
      <section className="employee-error-panel" role="status"><h1>Employee unavailable</h1><p>This employee is not available in your organization.</p></section>
    </div>
  );
  if (loadError || !profile) return (
    <div className="admin-page employee-profile-page">
      <Link className="back-link" href="/admin/employees">← Back to employees</Link>
      <section className="employee-error-panel" role="alert"><h1>Profile unavailable</h1><p>{loadError ?? "Employee profile is unavailable."}</p><button className="secondary-action" type="button" onClick={reloadProfile}>Try again</button></section>
    </div>
  );

  const displayName = profile.employeeName?.trim() || profile.email;
  return (
    <div className="admin-page employee-profile-page">
      <Link className="back-link" href="/admin/employees">← Back to employees</Link>
      <header className="employee-profile-header">
        <div className="employee-profile-title">
          <p className="admin-eyebrow">Employee profile</p>
          <h1>{displayName}</h1>
          <p className="employee-profile-email">{profile.email}</p>
        </div>
        <div className="employee-profile-actions">
          <button className="secondary-action" type="button" onClick={() => { setDraft(profileDraftFrom(profile)); setFieldErrors({}); setSaveError(null); setEditing(true); }}>Edit profile</button>
        </div>
      </header>

      <InvitationDeliveryNotice />

      <section className="employee-profile-panel" aria-labelledby="employee-profile-details-heading">
        <div className="employee-panel-heading"><div><p className="admin-eyebrow">Organization details</p><h2 id="employee-profile-details-heading">Profile details</h2></div><span className={`employee-status-badge ${profile.active ? "is-active" : "is-inactive"}`}>{profile.active ? "Active" : "Inactive"}</span></div>
        <dl className="employee-profile-grid">
          <div><dt>Employee name</dt><dd>{profile.employeeName || "—"}</dd></div>
          <div><dt>Job title</dt><dd>{profile.jobTitle || "—"}</dd></div>
          <div><dt>Department</dt><dd>{profile.department || "—"}</dd></div>
          <div><dt>Phone</dt><dd>{profile.phone || "—"}</dd></div>
          <div><dt>Employee number</dt><dd>{profile.employeeNumber || "—"}</dd></div>
          <div><dt>Email</dt><dd>{profile.email}</dd></div>
          <div><dt>Role</dt><dd>{profile.role}</dd></div>
          <div><dt>Account status</dt><dd>{profile.active ? "Active" : "Inactive"}</dd></div>
        </dl>
      </section>

      <section className="employee-profile-panel employee-profile-notes" aria-labelledby="employee-access-heading">
        <div><p className="admin-eyebrow">Access</p><h2 id="employee-access-heading">Organization access</h2><p>{profile.active ? "This employee currently has access to this organization." : "This employee is inactive and cannot access this organization."}</p></div>
        {profile.active ? <button className="destructive-action" type="button" onClick={() => { setDeactivateError(null); setConfirmingDeactivate(true); }}>Deactivate employee</button> : null}
      </section>

      <CourseBuilderDialog
        open={editing && draft !== null}
        title="Edit employee profile"
        description="These details apply to this employee in your organization. Email, role, and status are read-only."
        dirty={dirty}
        pending={savePending}
        onClose={() => setEditing(false)}
      >
        {(requestClose) => draft ? (
          <form className="employee-form" onSubmit={submitProfile} noValidate>
            {saveError ? <p className="error-message" role="alert">{saveError}</p> : null}
            <div className="form-field">
              <label htmlFor="profile-employee-name">Employee name</label>
              <input id="profile-employee-name" value={draft.employeeName} maxLength={120} aria-invalid={fieldErrors.employeeName ? "true" : undefined} aria-describedby={fieldErrors.employeeName ? "profile-employee-name-error" : undefined} onChange={(event) => setDraft({ ...draft, employeeName: event.currentTarget.value })} required={profile.employeeName !== null} />
              {fieldErrors.employeeName ? <p className="field-error" id="profile-employee-name-error" role="alert">{fieldErrors.employeeName}</p> : null}
            </div>
            {(["jobTitle", "department", "phone", "employeeNumber"] as const).map((field) => {
              const label = field === "jobTitle" ? "Job title" : field === "employeeNumber" ? "Employee number" : field === "phone" ? "Phone" : "Department";
              const errorId = `profile-${field}-error`;
              return (
                <div className="form-field" key={field}>
                  <label htmlFor={`profile-${field}`}>{label}</label>
                  <input id={`profile-${field}`} value={draft[field]} maxLength={120} aria-invalid={fieldErrors[field] ? "true" : undefined} aria-describedby={fieldErrors[field] ? errorId : undefined} onChange={(event) => setDraft({ ...draft, [field]: event.currentTarget.value })} />
                  {fieldErrors[field] ? <p className="field-error" id={errorId} role="alert">{fieldErrors[field]}</p> : null}
                </div>
              );
            })}
            <div className="employee-readonly-fields" aria-label="Read-only account details">
              <span>Email <strong>{profile.email}</strong></span><span>Role <strong>{profile.role}</strong></span><span>Status <strong>{profile.active ? "Active" : "Inactive"}</strong></span>
            </div>
            <div className="form-actions">
              <button className="secondary-action" type="button" disabled={savePending} onClick={requestClose}>Cancel</button>
              <button className="primary-action" type="submit" disabled={savePending}>{savePending ? "Saving…" : "Save profile"}</button>
            </div>
          </form>
        ) : null}
      </CourseBuilderDialog>

      <CourseBuilderDialog
        open={confirmingDeactivate}
        title="Deactivate employee?"
        description={`${displayName} will lose access to this organization. Their account and other organization memberships are not deleted.`}
        size="confirmation"
        pending={deactivatePending}
        onClose={() => { setConfirmingDeactivate(false); setDeactivateError(null); }}
      >
        <div className="employee-confirmation">
          {deactivateError ? <p className="error-message" role="alert">{deactivateError}</p> : null}
          <div className="form-actions">
            <button className="secondary-action" type="button" disabled={deactivatePending} onClick={() => setConfirmingDeactivate(false)}>Cancel</button>
            <button className="destructive-action" type="button" disabled={deactivatePending} onClick={() => void confirmDeactivate()}>{deactivatePending ? "Deactivating…" : "Deactivate employee"}</button>
          </div>
        </div>
      </CourseBuilderDialog>
      <CourseBuilderToastRegion />
    </div>
  );
}
