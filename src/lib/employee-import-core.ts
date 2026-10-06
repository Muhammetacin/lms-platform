import { parse as parseCsv } from "csv-parse/sync";
import { AuthorizationError } from "./authorization-core.ts";
import {
  normalizeEmployeeEmail,
  normalizeEmployeeName,
} from "./employee-management-core.ts";
import { parseEmployeeProfileUpdate } from "./employee-profile-core.ts";
import type { TenantContext } from "./tenant-context-core.ts";
import { TenantContextError } from "./tenant-context-core.ts";

export const EMPLOYEE_IMPORT_MAX_FILE_BYTES = 1024 * 1024;
export const EMPLOYEE_IMPORT_MAX_ROWS = 500;
export const EMPLOYEE_IMPORT_MAX_ERRORS = 100;

const MAX_MULTIPART_OVERHEAD_BYTES = 16 * 1024;
const MAX_REQUEST_BYTES = EMPLOYEE_IMPORT_MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES;
const MAX_CSV_RECORD_BYTES = 4096;

export const EMPLOYEE_IMPORT_HEADERS = [
  "email",
  "name",
  "jobTitle",
  "department",
  "phone",
  "employeeNumber",
] as const;

export type EmployeeImportField = (typeof EMPLOYEE_IMPORT_HEADERS)[number];
export type EmployeeImportErrorField = EmployeeImportField | "file" | "header" | "row";

export type EmployeeImportRowError = {
  row: number;
  field: EmployeeImportErrorField;
  code: string;
};

export type EmployeeImportRow = {
  row: number;
  email: string;
  name: string;
  jobTitle: string | null;
  department: string | null;
  phone: string | null;
  employeeNumber: string | null;
};

export interface EmployeeImportStore {
  import(organizationId: string, rows: EmployeeImportRow[]): Promise<number>;
}

export class EmployeeImportConflictError extends Error {
  readonly errors: EmployeeImportRowError[];

  constructor(errors: EmployeeImportRowError[]) {
    super("Employee import conflicts with existing organization data.");
    this.name = "EmployeeImportConflictError";
    this.errors = errors;
  }
}

export type EmployeeImportDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: "MANAGE_MEMBERS"): Promise<unknown>;
  store: EmployeeImportStore;
  isTrustedRequest(request: Request): boolean;
  logError?(operation: "import"): void;
};

const privateJsonHeaders = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: privateJsonHeaders });

type EmployeeImportParseResult =
  | { rows: EmployeeImportRow[]; errors: [] }
  | { rows: []; errors: EmployeeImportRowError[] };

type MultipartReadResult =
  | { fileText: string; error: null }
  | { fileText: null; error: { status: number; code: string } };

function fileError(code: string): EmployeeImportRowError {
  // Row zero denotes a file-level issue; employee rows start at CSV record 2.
  return { row: 0, field: "file", code };
}

function boundedErrors(errors: EmployeeImportRowError[]): EmployeeImportRowError[] {
  return errors.slice(0, EMPLOYEE_IMPORT_MAX_ERRORS);
}

function invalidCsv(errors: EmployeeImportRowError[], status = 400): Response {
  return json({ error: "employee_import_invalid", errors: boundedErrors(errors) }, status);
}

/**
 * Read no more than the CSV limit plus bounded multipart framing before asking
 * the Web API multipart parser to materialize the form. This also caps uploads
 * with no Content-Length header.
 */
async function readMultipartFile(request: Request): Promise<MultipartReadResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return { fileText: null, error: { status: 400, code: "invalid_multipart" } };
    }
    if (Number(contentLength) > MAX_REQUEST_BYTES) {
      return { fileText: null, error: { status: 413, code: "file_too_large" } };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { fileText: null, error: { status: 400, code: "invalid_multipart" } };

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return { fileText: null, error: { status: 413, code: "file_too_large" } };
      }
      chunks.push(value);
    }
  } catch {
    return { fileText: null, error: { status: 400, code: "invalid_multipart" } };
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let formData: FormData;
  try {
    const boundedRequest = new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    });
    formData = await boundedRequest.formData();
  } catch {
    return { fileText: null, error: { status: 400, code: "invalid_multipart" } };
  }

  const entries = [...formData.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "file") {
    return { fileText: null, error: { status: 400, code: "invalid_multipart" } };
  }
  const value = entries[0][1];
  if (!(value instanceof File)) {
    return { fileText: null, error: { status: 400, code: "invalid_file" } };
  }
  if (value.size > EMPLOYEE_IMPORT_MAX_FILE_BYTES) {
    return { fileText: null, error: { status: 413, code: "file_too_large" } };
  }

  try {
    const bytes = new Uint8Array(await value.arrayBuffer());
    return { fileText: new TextDecoder("utf-8", { fatal: true }).decode(bytes), error: null };
  } catch {
    return { fileText: null, error: { status: 400, code: "invalid_utf8" } };
  }
}

function parseProfileField(
  field: "jobTitle" | "department" | "phone" | "employeeNumber",
  rawValue: string,
): { value: string | null; error: null } | { value: null; error: EmployeeImportRowError["code"] } {
  if (rawValue.trim() === "") return { value: null, error: null };
  const parsed = parseEmployeeProfileUpdate({ [field]: rawValue }, true);
  const value = parsed?.[field];
  if (typeof value !== "string") return { value: null, error: `invalid_${field}` };
  return { value, error: null };
}

/** Parse RFC4180 CSV and validate the complete request without database writes. */
export function parseEmployeeImportCsv(text: string): EmployeeImportParseResult {
  if (Buffer.byteLength(text, "utf8") > EMPLOYEE_IMPORT_MAX_FILE_BYTES) {
    return { rows: [], errors: [fileError("file_too_large")] };
  }
  if (text.length === 0) return { rows: [], errors: [fileError("empty_file")] };

  let records: string[][];
  try {
    records = parseCsv(text, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      max_record_size: MAX_CSV_RECORD_BYTES,
      to: EMPLOYEE_IMPORT_MAX_ROWS + 2,
    }) as string[][];
  } catch {
    return { rows: [], errors: [fileError("malformed_csv")] };
  }

  if (records.length === 0) return { rows: [], errors: [fileError("empty_file")] };
  const headers = records[0];
  const errors: EmployeeImportRowError[] = [];
  const seenHeaders = new Set<string>();
  for (const header of headers) {
    if (seenHeaders.has(header)) errors.push({ row: 1, field: "header", code: "duplicate_header" });
    seenHeaders.add(header);
    if (!(EMPLOYEE_IMPORT_HEADERS as readonly string[]).includes(header)) {
      errors.push({ row: 1, field: "header", code: "unsupported_header" });
    }
  }
  for (const field of ["email", "name"] as const) {
    if (!seenHeaders.has(field)) errors.push({ row: 1, field, code: "missing_required_header" });
  }
  if (errors.length > 0) return { rows: [], errors: boundedErrors(errors) };

  if (records.length === 1) return { rows: [], errors: [fileError("no_employee_rows")] };
  if (records.length > EMPLOYEE_IMPORT_MAX_ROWS + 1) {
    return {
      rows: [],
      errors: [{ row: EMPLOYEE_IMPORT_MAX_ROWS + 2, field: "file", code: "too_many_rows" }],
    };
  }

  const headerIndexes = new Map(headers.map((header, index) => [header, index]));
  const rows: EmployeeImportRow[] = [];
  const emailOccurrences = new Map<string, number[]>();
  const employeeNumberOccurrences = new Map<string, number[]>();

  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    const csvRow = index + 1;
    if (record.length !== headers.length) {
      errors.push({ row: csvRow, field: "row", code: "column_count_mismatch" });
      continue;
    }

    const cell = (field: EmployeeImportField) => {
      const columnIndex = headerIndexes.get(field);
      return columnIndex === undefined ? "" : record[columnIndex] ?? "";
    };

    const email = normalizeEmployeeEmail(cell("email"));
    const name = normalizeEmployeeName(cell("name"));
    let invalid = false;
    if (email === null) {
      errors.push({ row: csvRow, field: "email", code: "invalid_email" });
      invalid = true;
    }
    if (name === null) {
      errors.push({ row: csvRow, field: "name", code: "invalid_name" });
      invalid = true;
    }

    const jobTitle = parseProfileField("jobTitle", cell("jobTitle"));
    const department = parseProfileField("department", cell("department"));
    const phone = parseProfileField("phone", cell("phone"));
    const employeeNumber = parseProfileField("employeeNumber", cell("employeeNumber"));
    for (const [field, parsed] of [
      ["jobTitle", jobTitle],
      ["department", department],
      ["phone", phone],
      ["employeeNumber", employeeNumber],
    ] as const) {
      if (parsed.error !== null) {
        errors.push({ row: csvRow, field, code: parsed.error });
        invalid = true;
      }
    }

    if (email !== null) {
      const occurrences = emailOccurrences.get(email) ?? [];
      occurrences.push(csvRow);
      emailOccurrences.set(email, occurrences);
    }
    if (employeeNumber.value !== null) {
      const occurrences = employeeNumberOccurrences.get(employeeNumber.value) ?? [];
      occurrences.push(csvRow);
      employeeNumberOccurrences.set(employeeNumber.value, occurrences);
    }

    if (!invalid && email !== null && name !== null) {
      rows.push({
        row: csvRow,
        email,
        name,
        jobTitle: jobTitle.value,
        department: department.value,
        phone: phone.value,
        employeeNumber: employeeNumber.value,
      });
    }
  }

  for (const rowNumbers of emailOccurrences.values()) {
    if (rowNumbers.length < 2) continue;
    for (const row of rowNumbers) errors.push({ row, field: "email", code: "duplicate_email" });
  }
  for (const rowNumbers of employeeNumberOccurrences.values()) {
    if (rowNumbers.length < 2) continue;
    for (const row of rowNumbers) {
      errors.push({ row, field: "employeeNumber", code: "duplicate_employee_number" });
    }
  }

  if (errors.length > 0) return { rows: [], errors: boundedErrors(errors) };
  return { rows, errors: [] };
}

function errorResponse(
  error: unknown,
  logError?: EmployeeImportDependencies["logError"],
): Response {
  if (error instanceof AuthorizationError || error instanceof TenantContextError) {
    return json({ error: error.code }, error.status);
  }
  if (error instanceof EmployeeImportConflictError) {
    return json(
      { error: "employee_import_conflict", errors: boundedErrors(error.errors) },
      409,
    );
  }
  if (logError) logError("import");
  else console.error("Employee import request could not be completed.", { operation: "import" });
  return json({ error: "employee_import_unavailable" }, 503);
}

export function createEmployeeImportHandler(dependencies: EmployeeImportDependencies) {
  return async function POST(request: Request): Promise<Response> {
    if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);

    try {
      const tenant = await dependencies.requireTenantContext();
      await dependencies.requirePermission(tenant.organizationId, "MANAGE_MEMBERS");

      const upload = await readMultipartFile(request);
      if (upload.error) {
        return invalidCsv([fileError(upload.error.code)], upload.error.status);
      }

      const parsed = parseEmployeeImportCsv(upload.fileText);
      if (parsed.errors.length > 0) return invalidCsv(parsed.errors);

      const imported = await dependencies.store.import(tenant.organizationId, parsed.rows);
      return json({ imported });
    } catch (error) {
      return errorResponse(error, dependencies.logError);
    }
  };
}
