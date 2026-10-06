import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationError } from "../src/lib/authorization-core.ts";
import {
  createEmployeeImportHandler,
  EMPLOYEE_IMPORT_MAX_FILE_BYTES,
  parseEmployeeImportCsv,
  type EmployeeImportRow,
  type EmployeeImportStore,
} from "../src/lib/employee-import-core.ts";
import { TenantContextError } from "../src/lib/tenant-context-core.ts";

const organizationId = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const ownerTenant = {
  userId: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  organizationId,
  role: "OWNER" as const,
};

class MemoryImportStore implements EmployeeImportStore {
  readonly imports: { organizationId: string; rows: EmployeeImportRow[] }[] = [];
  fail = false;

  async import(tenantId: string, rows: EmployeeImportRow[]) {
    if (this.fail) throw new Error("database internals must not escape");
    this.imports.push({ organizationId: tenantId, rows: structuredClone(rows) });
    return rows.length;
  }
}

function multipartRequest(
  csv: string | Uint8Array,
  options: { role?: "OWNER" | "ADMIN" | "MEMBER" | null; extraFields?: Record<string, string>; filename?: string } = {},
) {
  const form = new FormData();
  let blobPart: BlobPart;
  if (typeof csv === "string") {
    blobPart = csv;
  } else {
    const bytes = new ArrayBuffer(csv.byteLength);
    new Uint8Array(bytes).set(csv);
    blobPart = bytes;
  }
  form.append("file", new Blob([blobPart], { type: "text/csv" }), options.filename ?? "employees.csv");
  for (const [key, value] of Object.entries(options.extraFields ?? {})) form.append(key, value);
  return new Request("https://lms.example.test/api/organizations/employees/import", {
    method: "POST",
    body: form,
  });
}

function makeHandler(
  store: MemoryImportStore,
  role: "OWNER" | "ADMIN" | "MEMBER" | null = "OWNER",
  trusted = true,
) {
  return createEmployeeImportHandler({
    async requireTenantContext() {
      if (role === null) throw new TenantContextError("unauthenticated");
      return { ...ownerTenant, role };
    },
    async requirePermission(tenantId, permission) {
      assert.equal(tenantId, organizationId);
      assert.equal(permission, "MANAGE_MEMBERS");
      if (role === null) throw new AuthorizationError("unauthenticated");
      if (role === "MEMBER") throw new AuthorizationError("forbidden");
    },
    store,
    isTrustedRequest: () => trusted,
    logError: () => {},
  });
}

test("RFC4180 parsing supports quotes, escaped quotes, commas, CRLF, LF, BOM, and reordered columns", () => {
  const crlf = parseEmployeeImportCsv(
    '\uFEFFname,department,email,jobTitle,phone,employeeNumber\r\n"Doe, Jane","R&D","jane@example.com","Teacher, Sr.","+32 2 555 01 23","EMP-1"\r\n"O""Neil, Pat",People,pat@example.com,,,',
  );
  assert.deepEqual(crlf.errors, []);
  assert.deepEqual(crlf.rows, [
    {
      row: 2,
      email: "jane@example.com",
      name: "Doe, Jane",
      department: "R&D",
      jobTitle: "Teacher, Sr.",
      phone: "+32 2 555 01 23",
      employeeNumber: "EMP-1",
    },
    {
      row: 3,
      email: "pat@example.com",
      name: 'O"Neil, Pat',
      department: "People",
      jobTitle: null,
      phone: null,
      employeeNumber: null,
    },
  ]);

  const lf = parseEmployeeImportCsv("email,name\nélise@example.com,Élise Example\n");
  assert.deepEqual(lf.errors, []);
  assert.equal(lf.rows[0]?.name, "Élise Example");
});

test("CSV values reuse employee and profile normalization rules", () => {
  const parsed = parseEmployeeImportCsv(
    "email,name,jobTitle,department,phone,employeeNumber\n  Case@example.com ,  Employee Name  ,  Engineer  ,   , +32 2 , EMP-02 \n",
  );
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows[0], {
    row: 2,
    email: "Case@example.com",
    name: "Employee Name",
    jobTitle: "Engineer",
    department: null,
    phone: "+32 2",
    employeeNumber: "EMP-02",
  });

  const invalid = parseEmployeeImportCsv(
    `email,name,jobTitle\nbad-email, A ,${"x".repeat(121)}\nvalid@example.com,B\u0000ad Name,\n`,
  );
  assert.deepEqual(invalid.errors, [
    { row: 2, field: "email", code: "invalid_email" },
    { row: 2, field: "name", code: "invalid_name" },
    { row: 2, field: "jobTitle", code: "invalid_jobTitle" },
    { row: 3, field: "name", code: "invalid_name" },
  ]);

  const codePoints = parseEmployeeImportCsv(`email,name\na@example.com,${"😀".repeat(120)}\nb@example.com,${"😀".repeat(121)}\n`);
  assert.equal(codePoints.errors.length, 1);
  assert.deepEqual(codePoints.errors[0], { row: 3, field: "name", code: "invalid_name" });
});

test("duplicate emails and employee numbers reject every matching CSV row", () => {
  const parsed = parseEmployeeImportCsv(
    "email,name,employeeNumber\nA@example.com,First Name,EMP-1\nA@example.com,Second Name,EMP-2\nb@example.com,Third Name,EMP-1\n",
  );
  assert.equal(parsed.rows.length, 0);
  assert.deepEqual(parsed.errors, [
    { row: 2, field: "email", code: "duplicate_email" },
    { row: 3, field: "email", code: "duplicate_email" },
    { row: 2, field: "employeeNumber", code: "duplicate_employee_number" },
    { row: 4, field: "employeeNumber", code: "duplicate_employee_number" },
  ]);

  const caseDistinct = parseEmployeeImportCsv(
    "email,name,employeeNumber\nA@example.com,First Name,emp-1\na@example.com,Second Name,EMP-1\n",
  );
  assert.deepEqual(caseDistinct.errors, []);
});

test("headers are exact, case-sensitive, unique, and restricted to the supported fields", () => {
  assert.deepEqual(parseEmployeeImportCsv("Email,name\na@example.com,Valid Name\n").errors, [
    { row: 1, field: "header", code: "unsupported_header" },
    { row: 1, field: "email", code: "missing_required_header" },
  ]);
  assert.deepEqual(parseEmployeeImportCsv("email,name,role\na@example.com,Valid Name,MEMBER\n").errors, [
    { row: 1, field: "header", code: "unsupported_header" },
  ]);
  assert.deepEqual(parseEmployeeImportCsv("email,name,name\na@example.com,Valid Name,Other Name\n").errors, [
    { row: 1, field: "header", code: "duplicate_header" },
  ]);
  assert.deepEqual(parseEmployeeImportCsv("name\nValid Name\n").errors, [
    { row: 1, field: "email", code: "missing_required_header" },
  ]);
  assert.deepEqual(parseEmployeeImportCsv("email,name,teamId\na@example.com,Valid Name,team\n").errors, [
    { row: 1, field: "header", code: "unsupported_header" },
  ]);
});

test("empty, header-only, malformed, wrong-column, oversized, and over-limit CSV is rejected", () => {
  assert.deepEqual(parseEmployeeImportCsv("").errors, [
    { row: 0, field: "file", code: "empty_file" },
  ]);
  assert.deepEqual(parseEmployeeImportCsv("email,name\n\n").errors, [
    { row: 0, field: "file", code: "no_employee_rows" },
  ]);
  assert.deepEqual(parseEmployeeImportCsv('email,name\na@example.com,"Unclosed\n').errors, [
    { row: 0, field: "file", code: "malformed_csv" },
  ]);
  assert.deepEqual(parseEmployeeImportCsv("email,name\na@example.com,Valid Name,extra\n").errors, [
    { row: 2, field: "row", code: "column_count_mismatch" },
  ]);
  assert.deepEqual(parseEmployeeImportCsv("x".repeat(EMPLOYEE_IMPORT_MAX_FILE_BYTES + 1)).errors, [
    { row: 0, field: "file", code: "file_too_large" },
  ]);

  const exactly500 = Array.from({ length: 500 }, (_, index) => `person${index}@example.com,Person ${index}`);
  const atLimit = parseEmployeeImportCsv(`email,name\n${exactly500.join("\n")}`);
  assert.deepEqual(atLimit.errors, []);
  assert.equal(atLimit.rows.length, 500);

  const rows = Array.from({ length: 501 }, (_, index) => `person${index}@example.com,Person ${index}`);
  const tooMany = parseEmployeeImportCsv(`email,name\n${rows.join("\n")}`);
  assert.deepEqual(tooMany.errors, [
    { row: 502, field: "file", code: "too_many_rows" },
  ]);
});

test("OWNER and ADMIN can import; MEMBER and unauthenticated callers cannot write", async () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    const store = new MemoryImportStore();
    const response = await makeHandler(store, role)(multipartRequest("email,name\na@example.com,Valid Name\n"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { imported: 1 });
    assert.equal(store.imports.length, 1);
  }

  const memberStore = new MemoryImportStore();
  const memberResponse = await makeHandler(memberStore, "MEMBER")(
    multipartRequest("email,name\na@example.com,Valid Name\n"),
  );
  assert.equal(memberResponse.status, 403);
  assert.equal(memberStore.imports.length, 0);

  const anonymousStore = new MemoryImportStore();
  const anonymousResponse = await makeHandler(anonymousStore, null)(
    multipartRequest("email,name\na@example.com,Valid Name\n"),
  );
  assert.equal(anonymousResponse.status, 401);
  assert.equal(anonymousStore.imports.length, 0);
});

test("handler rejects forged fields, extra multipart fields, malformed requests, and untrusted origins before writes", async () => {
  const store = new MemoryImportStore();
  const handler = makeHandler(store);
  const response = await handler(multipartRequest(
    "email,name,organizationId,role,active\na@example.com,Valid Name,other,OWNER,false\n",
  ));
  assert.equal(response.status, 400);
  const invalidHeaders = await response.json() as { error: string; errors: { code: string }[] };
  assert.equal(invalidHeaders.error, "employee_import_invalid");
  assert.equal(invalidHeaders.errors.length, 3);
  assert.ok(invalidHeaders.errors.every(({ code }) => code === "unsupported_header"));
  assert.equal(store.imports.length, 0);

  const extraField = await handler(multipartRequest(
    "email,name\na@example.com,Valid Name\n",
    { extraFields: { organizationId } },
  ));
  assert.equal(extraField.status, 400);
  assert.equal(store.imports.length, 0);

  const crossOrigin = await makeHandler(store, "OWNER", false)(
    multipartRequest("email,name\na@example.com,Valid Name\n"),
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal(store.imports.length, 0);

  const invalidBytes = await handler(multipartRequest(new Uint8Array([0xff, 0xfe, 0xfd])));
  assert.equal(invalidBytes.status, 400);
  assert.deepEqual(await invalidBytes.json(), {
    error: "employee_import_invalid",
    errors: [{ row: 0, field: "file", code: "invalid_utf8" }],
  });

  const wrongFileField = new FormData();
  wrongFileField.append("upload", new Blob(["email,name\na@example.com,Valid Name\n"]), "employees.csv");
  const wrongFieldResponse = await handler(new Request(
    "https://lms.example.test/api/organizations/employees/import",
    { method: "POST", body: wrongFileField },
  ));
  assert.equal(wrongFieldResponse.status, 400);

  const fileTooLarge = await handler(multipartRequest("x".repeat(EMPLOYEE_IMPORT_MAX_FILE_BYTES + 1)));
  assert.equal(fileTooLarge.status, 413);
  assert.deepEqual(await fileTooLarge.json(), {
    error: "employee_import_invalid",
    errors: [{ row: 0, field: "file", code: "file_too_large" }],
  });
  assert.equal(store.imports.length, 0);
});

test("filename is not used as security input, and storage errors do not leak internals", async () => {
  const store = new MemoryImportStore();
  const filename = await makeHandler(store)(multipartRequest(
    "email,name\na@example.com,Valid Name\n",
    { filename: "../../organization-owner.csv" },
  ));
  assert.equal(filename.status, 200);
  assert.equal(store.imports.length, 1);

  store.fail = true;
  const failed = await makeHandler(store)(multipartRequest("email,name\nb@example.com,Valid Name\n"));
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: "employee_import_unavailable" });
});
