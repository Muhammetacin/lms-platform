# Employee CSV Import (LMS-017)

`POST /api/organizations/employees/import` accepts one `multipart/form-data` file field named `file`. It creates employees in the authenticated user's trusted active organization using the existing `User` and `OrganizationMembership` models. The request-scoped file is not stored after processing.

## CSV format

The first record is a header. Canonical header names are exact and case-sensitive; their order may vary.

Required:

```csv
email,name
```

Optional: `jobTitle`, `department`, `phone`, and `employeeNumber`.

```csv
email,name,jobTitle,department,phone,employeeNumber
jane@example.com,"Doe, Jane",Teacher,Learning,+32 2 555 01 23,EMP-001
```

The parser accepts RFC4180 quoting, escaped quotes, commas inside quoted values, LF or CRLF line endings, UTF-8, and a UTF-8 BOM. It rejects malformed CSV, wrong row widths, duplicate headers, unknown headers, and missing required headers. Headers are not trimmed or case-folded. `role`, `active`, organization/tenant identifiers, team fields, password, and invitation fields are not supported.

Email uses LMS-012 semantics: trim surrounding whitespace, preserve case, validate using the existing employee-creation rule, and use the exact stored value as the global identity. Name uses LMS-012's trimmed 2–120 Unicode code point rule. Nonblank optional profile values use LMS-013's trimmed, case-preserving, control-character-free, 120-code-point validation. Blank optional cells become `null`; phone values are not format-parsed.

The first employee record is reported as row 2 because row 1 is the header. Row numbers count CSV records, including records whose quoted values span physical lines. Row 0 identifies a file-level problem.

## Authorization and tenant boundary

The endpoint requires the existing same-origin trusted-request check for `multipart/form-data`, authenticated tenant context, and `MANAGE_MEMBERS`. OWNER and ADMIN can import; MEMBER receives 403 and an unauthenticated caller receives 401. The organization ID comes only from `requireTenantContext()`; multipart fields, headers, query values, and filenames do not select or change the tenant.

All imported memberships are created under that trusted organization with `role = MEMBER` and `active = true`. A global `User` with the exact email is reused without changing its name, credentials, or other memberships. An existing membership in the current organization is a row conflict. An employee number conflicts only with another membership in the same organization.

## Validation and transaction behavior

The maximum CSV file size is 1 MiB and the maximum batch is 500 employee records. The multipart body is read with a bounded byte limit before parsing. Empty files, header-only files, malformed content, unsupported fields, invalid rows, duplicate emails, duplicate nonblank employee numbers, and existing organization conflicts are rejected before import writes whenever the conflict is visible during validation.

The complete batch is validated before the store starts writes. The production store then runs conflict checks, creates missing global users, and creates all memberships in one PostgreSQL serializable transaction. Database uniqueness remains authoritative for races with another import or manual creation; a constraint or serialization failure rolls back the batch, maps concurrent row conflicts to safe row errors where possible, and retries a serialization conflict once. No employee in the batch is silently updated or reactivated.

Invalid CSV rows return `employee_import_invalid` with at most 100 `{ row, field, code }` entries. Conflicts discovered against current-organization memberships return 409 with `employee_import_conflict`. Responses never echo CSV values or database details and use `Cache-Control: no-store`.

## Side effects and retention

Import creates only missing `User` records and new `OrganizationMembership` records. It does not create credentials, invitations, TeamMembership rows, an import-history record, or an audit subsystem. It sends no email. The uploaded CSV exists only for request processing and is not persisted.

`csv-parse@7.0.3` is the direct CSV parser dependency. Its sync API is used only after the request has been bounded to 1 MiB; it handles CSV quoting and record structure. The package is MIT-licensed and has no runtime dependencies.

## Verification

`pnpm test:employee-import` covers parsing, validation, authorization, multipart handling, and safe errors. `pnpm test:employee-import:db` exercises the production Prisma store and handler against the dedicated PostgreSQL CI database, including tenant A/B isolation, identity reuse, organization-local uniqueness, conflicts, rollback, and concurrent imports.
