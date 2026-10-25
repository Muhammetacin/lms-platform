import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminNavigationView } from "../src/components/admin-portal-view.ts";
import {
  employeeApiErrorMessage,
  employeeImportApiErrorMessage,
  employeeImportErrorMessages,
  profileDraftFrom,
  profilePatchFrom,
  validateEmployeeProfileDraft,
} from "../src/lib/employee-management-ui-core.ts";
import type { EmployeeProfile } from "../src/lib/employee-profile-core.ts";

const profile: EmployeeProfile = {
  id: "bc14fd7e-dd80-4c69-8b61-b1816c6627c6",
  email: "employee@example.test",
  employeeName: "Sam Employee",
  jobTitle: "Instructor",
  department: "Learning",
  phone: "+32 2 555 01 23",
  employeeNumber: "EMP-001",
  role: "MEMBER",
  active: true,
};

test("Admin navigation exposes Employees and marks list and profile routes active", () => {
  const list = renderToStaticMarkup(createElement(AdminNavigationView, { pathname: "/admin/employees" }));
  const profileRoute = renderToStaticMarkup(createElement(AdminNavigationView, { pathname: `/admin/employees/${profile.id}` }));
  assert.match(list, /href="\/admin\/employees"[^>]*aria-current="page"[^>]*>Employees/);
  assert.match(profileRoute, /href="\/admin\/employees"[^>]*aria-current="page"[^>]*>Employees/);
});

test("profile editor matches the organization profile contract and keeps identity fields read only", () => {
  const draft = profileDraftFrom(profile);
  assert.deepEqual(draft, {
    employeeName: "Sam Employee",
    jobTitle: "Instructor",
    department: "Learning",
    phone: "+32 2 555 01 23",
    employeeNumber: "EMP-001",
  });
  assert.deepEqual(validateEmployeeProfileDraft(draft), {});
  assert.deepEqual(profilePatchFrom({ ...draft, jobTitle: " ", employeeNumber: "  " }), {
    employeeName: "Sam Employee",
    jobTitle: null,
    department: "Learning",
    phone: "+32 2 555 01 23",
    employeeNumber: null,
  });
  assert.equal(validateEmployeeProfileDraft({ ...draft, employeeName: "A" }).employeeName, "Enter a name between 2 and 120 characters.");
  assert.equal(validateEmployeeProfileDraft({ ...draft, department: "x".repeat(121) }).department, "Use up to 120 characters without control characters.");
});

test("API and CSV failures show actionable safe messages without leaking backend details", () => {
  assert.equal(employeeApiErrorMessage(409, { error: "last_owner_required" }), "The last active owner cannot be deactivated.");
  assert.equal(employeeApiErrorMessage(409, { error: "employee_number_already_exists" }), "That employee number is already used in your organization.");
  assert.equal(employeeApiErrorMessage(503, { error: "private_sql", message: "database password" }), "Employee management is temporarily unavailable. Try again shortly.");
  assert.deepEqual(employeeImportErrorMessages({ errors: [
    { row: 1, field: "email", code: "missing_required_header" },
    { row: 3, field: "email", code: "duplicate_email", value: "private@example.test" },
    { row: 0, field: "file", code: "file_too_large" },
  ] }), [
    "Header, email: The CSV must include email and name columns.",
    "Row 3, email: This email appears more than once in the CSV.",
    "File: The CSV file must be no larger than 1 MiB.",
  ]);
  assert.deepEqual(employeeImportApiErrorMessage(503, { error: "employee_import_unavailable", message: "private database details" }), [
    "Employee import is temporarily unavailable. No employees were imported. Try again shortly.",
  ]);
  assert.doesNotMatch(JSON.stringify(employeeImportErrorMessages({ errors: [{ row: 2, field: "email", code: "duplicate_email", value: "private@example.test" }] })), /private@example\.test/);
});

test("employee UI calls only the existing tenant-scoped endpoints and never attempts delivery", async () => {
  const source = await readFile(new URL("../src/components/employee-management.tsx", import.meta.url), "utf8");
  assert.match(source, /const employeesEndpoint = "\/api\/organizations\/employees"/);
  assert.match(source, /JSON\.stringify\(\{ email: createEmail, name: createName \}\)/);
  assert.match(source, /form\.append\("file", importFile\)/);
  assert.match(source, /fetch\(`\$\{employeesEndpoint\}\/\$\{encodeURIComponent\(profile\.id\)\}\/profile`,\s*\{\s*method: "PATCH"/);
  assert.match(source, /\/deactivate/);
  assert.match(source, /slice\(0, 100\)/);
  assert.match(source, /Search and filters apply to this loaded list/);
  assert.match(source, /Invitation email delivery is not configured yet/);
  assert.doesNotMatch(source, /\/invitation|activationToken|inviteToken|sendInvitation/);
});
