export type TeamListItem = {
  id: string;
  name: string;
  description: string | null;
};

export type TeamMemberItem = {
  id: string;
  email: string;
  employeeName: string | null;
  jobTitle?: string | null;
  department?: string | null;
};

export type TeamEmployeeOption = {
  id: string;
  email: string;
  name: string | null;
  active: boolean;
};

export type TeamDraftErrors = { name?: string; description?: string };

const controlCharacterPattern = /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u;

export function validateTeamDraft(nameValue: string, descriptionValue: string): TeamDraftErrors {
  const errors: TeamDraftErrors = {};
  const name = nameValue.trim();
  const description = descriptionValue.trim();
  const nameLength = [...name].length;
  if (nameLength < 2 || nameLength > 120 || controlCharacterPattern.test(name)) {
    errors.name = "Enter a team name between 2 and 120 characters without control characters.";
  }
  if ([...description].length > 500 || controlCharacterPattern.test(description)) {
    errors.description = "Use up to 500 characters without control characters.";
  }
  return errors;
}

export function filterTeams(teams: TeamListItem[], query: string): TeamListItem[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return teams;
  return teams.filter((team) =>
    team.name.toLocaleLowerCase().includes(normalized)
    || (team.description ?? "").toLocaleLowerCase().includes(normalized),
  );
}

export function filterAddableEmployees(
  employees: TeamEmployeeOption[],
  members: TeamMemberItem[],
  query: string,
): TeamEmployeeOption[] {
  const normalized = query.trim().toLocaleLowerCase();
  const existingIds = new Set(members.map((member) => member.id));
  return employees.filter((employee) => {
    if (!employee.active || existingIds.has(employee.id)) return false;
    if (!normalized) return true;
    return (employee.name ?? "").toLocaleLowerCase().includes(normalized)
      || employee.email.toLocaleLowerCase().includes(normalized);
  });
}

export function teamApiErrorMessage(status: number, body: unknown): string {
  const code = typeof body === "object" && body !== null && !Array.isArray(body)
    && "error" in body && typeof body.error === "string"
    ? body.error
    : "";
  if (status === 0) return "The request could not reach the server. Check your connection and try again.";
  if (status === 401) return "Your session has ended. Sign in again to continue.";
  if (status === 403) return "You no longer have permission to manage teams.";
  if (code === "team_name_conflict") return "A team with this exact name already exists in your organization.";
  if (code === "team_membership_conflict") return "This employee is already a member of this team.";
  if (code === "employee_not_found") return "Only active employees in your organization can be added. This employee may be inactive or unavailable.";
  if (code === "team_membership_not_found") return "This employee is no longer an active member of this team.";
  if (code === "team_not_found" || status === 404) return "This team is no longer available in your organization.";
  if (status === 400) return "Check the team details and try again.";
  if (status >= 500) return "Team management is temporarily unavailable. Try again shortly.";
  return "The team change could not be completed. Review the details and try again.";
}
