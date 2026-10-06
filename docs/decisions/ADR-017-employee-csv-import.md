# ADR-017: Employee CSV Import

- **Status:** Accepted
- **Date:** 2026-10-06
- **Ticket:** LMS-017

## Context

LMS-012 defines an employee as a global `User` identity plus one tenant-owned `OrganizationMembership`. LMS-013 stores organization-specific profile fields on that membership. Administrators need to create multiple employee memberships from CSV without introducing a duplicate employee model, changing existing employees, trusting a client-selected tenant, or partially applying a batch.

## Decisions

1. Add `POST /api/organizations/employees/import` as a same-origin `multipart/form-data` endpoint with exactly one file field named `file`. It uses the existing authentication, `requireTenantContext()`, and `MANAGE_MEMBERS` rules. OWNER and ADMIN are allowed; MEMBER is denied.
2. Use exact, case-sensitive headers `email`, `name`, `jobTitle`, `department`, `phone`, and `employeeNumber`. Only `email` and `name` are required. Unknown, duplicate, or missing-required headers reject the CSV. Optional blank cells become `null`.
3. Reuse LMS-012 email/name normalization and LMS-013 profile validation. Email is trimmed and case-preserving, and global identity lookup follows the existing exact-value unique constraint. Do not add a second email identity policy.
4. Treat import as create-only. A global User may be reused, but no global User fields or memberships are updated. An existing membership in the trusted organization is a conflict. Duplicate emails or nonblank employee numbers inside the CSV reject the whole file. Existing employee numbers conflict only in the current organization.
5. Validate the full parsed batch, within-request duplicates, and visible organization conflicts before any writes. Then create missing users and all new MEMBER/active memberships in one PostgreSQL serializable transaction. Database uniqueness is the final concurrency guard; a serialization conflict is retried once after rechecking current-tenant conflicts. A failed transaction leaves no imported user/membership set.
6. Every membership uses the `organizationId` from trusted tenant context, `role = MEMBER`, and `active = true`. CSV, filename, query, headers, and additional multipart fields cannot choose tenant, role, activity, team, password, or invitation behavior.
7. Limit files to 1 MiB and batches to 500 data records. Use a bounded request-body reader before multipart and CSV parsing. Keep the CSV request-scoped; do not add import history, storage, credentials, invitations, email, Team membership, or a custom audit subsystem.
8. Use the direct `csv-parse` dependency for RFC4180-compatible parsing rather than a hand-written delimiter parser. The request is bounded before its sync API is used. No database model, schema field, index, or migration is required.
9. Return safe, machine-readable row errors, capped at 100, with no CSV values or database details. Successful responses report only the imported count and use `Cache-Control: no-store`.

## Consequences

CSV imports reuse established identity, membership, profile, and tenant-isolation rules. The per-organization `(organizationId, employeeNumber)` constraint permits an employee number used in another organization. Existing credentials, invitation rows, User profile fields, and Team memberships remain untouched. The transaction makes imported users and memberships atomic, while unique constraints and one serialization retry handle competing import/manual-create operations.

LMS-017 adds operational API behavior and PostgreSQL integration coverage, not employee-management UI or an audit event. Independent QA/security review remains required before merge completion; this ADR does not mark the ticket DONE.

## Alternatives considered

- **Add an `Employee` or import-job model:** rejected because `OrganizationMembership` is the existing employee boundary and MVP imports are request-scoped.
- **Upsert memberships or update conflicting profile values:** rejected because LMS-017 is explicitly create-only and must not reactivate or overwrite an employee.
- **Accept tenant, role, activity, or Team data from CSV:** rejected because it would cross established authorization and tenant boundaries.
- **Write a custom CSV parser or parse by splitting commas:** rejected because RFC4180 quoting, escaped quotes, and multiline fields are parser concerns; a focused maintained dependency is safer.
- **Send invitations or create credentials during import:** rejected because LMS-014 owns activation and import must not create bootstrap authentication state.
- **Add an import history or parallel audit table:** rejected because files are request-scoped and LMS-058 owns shared audit behavior.
