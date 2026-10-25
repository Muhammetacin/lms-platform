import type { Employee } from "./employee-management-core.ts";
import type { EmployeeProfile } from "./employee-profile-core.ts";

export type EmployeeProfileDraft = {
  employeeName: string;
  jobTitle: string;
  department: string;
  phone: string;
  employeeNumber: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function employeeApiErrorMessage(status: number, body: unknown): string {
  const code = isRecord(body) && typeof body.error === "string" ? body.error : "";
  if (status === 401) return "Your session has ended. Sign in again to continue.";
  if (status === 403) return "You no longer have permission to manage employees.";
  if (status === 404) return "This employee is no longer available in your organization.";
  if (code === "employee_already_exists") return "An employee with this email already exists in your organization.";
  if (code === "employee_number_already_exists") return "That employee number is already used in your organization.";
  if (code === "last_owner_required") return "The last active owner cannot be deactivated.";
  if (status === 400) return "Check the employee details and try again.";
  if (status >= 500) return "Employee management is temporarily unavailable. Try again shortly.";
  return "The employee change could not be completed. Review the details and try again.";
}

const importCodes: Record<string, string> = {
  invalid_multipart: "Choose a CSV file and try again.",
  invalid_file: "The upload must contain one CSV file.",
  file_too_large: "The CSV file must be no larger than 1 MiB.",
  invalid_utf8: "The CSV file must use valid UTF-8 text.",
  empty_file: "The selected CSV file is empty.",
  no_employee_rows: "Add at least one employee row below the header.",
  malformed_csv: "The CSV structure is invalid. Check its quoting and row widths.",
  too_many_rows: "A CSV import can contain at most 500 employees.",
  duplicate_header: "Each CSV column header can appear only once.",
  unsupported_header: "Remove unsupported columns. Use email, name, jobTitle, department, phone, and employeeNumber.",
  missing_required_header: "The CSV must include email and name columns.",
  column_count_mismatch: "This row has a different number of cells than the header.",
  invalid_email: "Enter a valid email address.",
  duplicate_email: "This email appears more than once in the CSV.",
  employee_already_exists: "An employee with this email already exists in your organization.",
  invalid_name: "Enter a name between 2 and 120 characters.",
  invalid_jobTitle: "Use up to 120 characters for the job title, without control characters.",
  invalid_department: "Use up to 120 characters for the department, without control characters.",
  invalid_phone: "Use up to 120 characters for the phone number, without control characters.",
  invalid_employeeNumber: "Use up to 120 characters for the employee number, without control characters.",
  duplicate_employee_number: "This employee number appears more than once in the CSV.",
  employee_number_conflict: "This employee number is already used in your organization.",
};

export function employeeImportErrorMessages(body: unknown): string[] {
  if (!isRecord(body) || !Array.isArray(body.errors)) {
    return ["The import could not be validated. Check the CSV format and try again."];
  }

  return body.errors.slice(0, 12).flatMap((item) => {
    if (!isRecord(item)) return [];
    const row = typeof item.row === "number" ? item.row : 0;
    const field = typeof item.field === "string" ? item.field : "file";
    const code = typeof item.code === "string" ? item.code : "";
    const message = importCodes[code] ?? "Review this value and try again.";
    const location = row > 1 ? `Row ${row}, ${field}` : field === "file" ? "File" : `Header, ${field}`;
    return [`${location}: ${message}`];
  });
}

export function employeeImportApiErrorMessage(status: number, body: unknown): string[] {
  if (status === 401 || status === 403) return [employeeApiErrorMessage(status, body)];
  if (isRecord(body) && (body.error === "employee_import_invalid" || body.error === "employee_import_conflict")) {
    return employeeImportErrorMessages(body);
  }
  if (status === 413) return ["The CSV file must be no larger than 1 MiB."];
  if (status >= 500) return ["Employee import is temporarily unavailable. No employees were imported. Try again shortly."];
  return ["The CSV could not be imported. Check the file and try again."];
}

export function profileDraftFrom(profile: EmployeeProfile): EmployeeProfileDraft {
  return {
    employeeName: profile.employeeName ?? "",
    jobTitle: profile.jobTitle ?? "",
    department: profile.department ?? "",
    phone: profile.phone ?? "",
    employeeNumber: profile.employeeNumber ?? "",
  };
}

export function validateEmployeeProfileDraft(draft: EmployeeProfileDraft): Partial<Record<keyof EmployeeProfileDraft, string>> {
  const errors: Partial<Record<keyof EmployeeProfileDraft, string>> = {};
  const nameLength = [...draft.employeeName.trim()].length;
  if (nameLength < 2 || nameLength > 120 || /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(draft.employeeName.trim())) {
    errors.employeeName = "Enter a name between 2 and 120 characters.";
  }
  for (const field of ["jobTitle", "department", "phone", "employeeNumber"] as const) {
    const value = draft[field].trim();
    if ([...value].length > 120 || /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(value)) {
      errors[field] = "Use up to 120 characters without control characters.";
    }
  }
  return errors;
}

export function profilePatchFrom(draft: EmployeeProfileDraft): Record<string, string | null> {
  const optional = (value: string) => value.trim() || null;
  return {
    employeeName: draft.employeeName.trim(),
    jobTitle: optional(draft.jobTitle),
    department: optional(draft.department),
    phone: optional(draft.phone),
    employeeNumber: optional(draft.employeeNumber),
  };
}

export function employeeDisplayName(employee: Pick<Employee, "name" | "email">): string {
  return employee.name?.trim() || employee.email;
}
