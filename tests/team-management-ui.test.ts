import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminNavigationView } from "../src/components/admin-portal-view.ts";
import {
  filterAddableEmployees,
  filterTeams,
  teamApiErrorMessage,
  validateTeamDraft,
  type TeamEmployeeOption,
  type TeamListItem,
  type TeamMemberItem,
} from "../src/lib/team-management-ui-core.ts";

const teams: TeamListItem[] = [
  { id: "team-1", name: "Learning", description: "Course content" },
  { id: "team-2", name: "Operations", description: null },
];

test("Admin navigation exposes Teams and activates the overview and detail routes", () => {
  const list = renderToStaticMarkup(createElement(AdminNavigationView, { pathname: "/admin/teams" }));
  const detail = renderToStaticMarkup(createElement(AdminNavigationView, { pathname: "/admin/teams/team-1" }));
  assert.match(list, /href="\/admin\/teams"[^>]*aria-current="page"[^>]*>Teams/);
  assert.match(detail, /href="\/admin\/teams"[^>]*aria-current="page"[^>]*>Teams/);
});

test("team form validation follows the Team API limits and trimming rules", () => {
  assert.deepEqual(validateTeamDraft("  Learning ", " Course authoring "), {});
  assert.equal(validateTeamDraft(" ", "").name, "Enter a team name between 2 and 120 characters without control characters.");
  assert.equal(validateTeamDraft("A", "").name, "Enter a team name between 2 and 120 characters without control characters.");
  assert.equal(validateTeamDraft("A".repeat(121), "").name, "Enter a team name between 2 and 120 characters without control characters.");
  assert.equal(validateTeamDraft("Learning\nTeam", "").name, "Enter a team name between 2 and 120 characters without control characters.");
  assert.equal(validateTeamDraft("Learning", "x".repeat(501)).description, "Use up to 500 characters without control characters.");
  assert.equal(validateTeamDraft("Learning", "Bad\u0000text").description, "Use up to 500 characters without control characters.");
});

test("team search is explicitly a local filter over the loaded API response", () => {
  assert.deepEqual(filterTeams(teams, "learning"), [teams[0]]);
  assert.deepEqual(filterTeams(teams, "course"), [teams[0]]);
  assert.deepEqual(filterTeams(teams, "missing"), []);
  assert.deepEqual(filterTeams(teams, "  "), teams);
});

test("member picker excludes inactive and already assigned employees while supporting multiple teams", () => {
  const employees: TeamEmployeeOption[] = [
    { id: "employee-1", name: "Alice", email: "alice@example.test", active: true },
    { id: "employee-2", name: "Bob", email: "bob@example.test", active: true },
    { id: "employee-3", name: "Inactive", email: "inactive@example.test", active: false },
  ];
  const members: TeamMemberItem[] = [{ id: "employee-1", employeeName: "Alice", email: "alice@example.test" }];
  assert.deepEqual(filterAddableEmployees(employees, members, ""), [employees[1]]);
  assert.deepEqual(filterAddableEmployees(employees, [], "BOB@"), [employees[1]]);
  assert.deepEqual(filterAddableEmployees(employees, [], "inactive"), []);
  assert.deepEqual(filterAddableEmployees(employees, [], ""), employees.slice(0, 2));
});

test("API errors stay actionable without exposing server details", () => {
  assert.match(teamApiErrorMessage(409, { error: "team_name_conflict" }), /exact name already exists/);
  assert.match(teamApiErrorMessage(409, { error: "team_membership_conflict" }), /already a member/);
  assert.match(teamApiErrorMessage(404, { error: "employee_not_found" }), /Only active employees/);
  assert.match(teamApiErrorMessage(400, { error: "invalid_request" }), /Check the team details/);
  assert.match(teamApiErrorMessage(503, { error: "private_db", details: "password" }), /temporarily unavailable/);
  assert.doesNotMatch(teamApiErrorMessage(503, { error: "private_db", details: "password" }), /password|private_db/);
});

test("team pages reuse only the tenant-scoped Team, membership, and employee APIs", async () => {
  const source = await readFile(new URL("../src/components/team-management.tsx", import.meta.url), "utf8");
  assert.match(source, /const teamsEndpoint = "\/api\/organizations\/teams"/);
  assert.match(source, /const employeesEndpoint = "\/api\/organizations\/employees"/);
  assert.match(source, /up to 100 teams\. Search checks only the teams loaded here/);
  assert.match(source, /up to 100 active members/);
  assert.match(source, /up to 100 employees\. Search checks only this loaded list/);
  assert.match(source, /permanently removes its team memberships\. Employee accounts are not deleted/);
  assert.match(source, /dirty=\{teamDirty\}/);
  assert.match(source, /dirty=\{Boolean\(employeeId\)\}/);
  assert.equal(
    (source.match(/method:\s*"DELETE",\s*headers:\s*\{\s*"Content-Type":\s*"application\/json"\s*\}/g) ?? []).length,
    2,
    "Team and member deletion send the JSON content type required by the same-origin guard",
  );
  assert.doesNotMatch(source, /\/api\/organizations\/teams\/[^\s"']*\/assignments/);
});
