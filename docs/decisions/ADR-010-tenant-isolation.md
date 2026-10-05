# ADR-010: Tenant Isolation

- **Status:** Accepted design; implementation verification blocked pending PostgreSQL run
- **Date:** 2026-10-05
- **Ticket:** LMS-010

## Context

LMS-007 authenticates a global `User`; LMS-008 authorizes from an active membership; LMS-009 derives trusted tenant context from server-side membership. LMS-012 added the first organization-scoped employee operations using `OrganizationMembership`, so LMS-010 can now secure a real resource boundary without inventing a new product model.

The schema's global identity/authentication models are `User`, `PasswordCredential`, and `Session`. `Organization` is the tenant root. `OrganizationMembership` is tenant-owned and its `organizationId`, `role`, `employeeName`, and `active` values are specific to its single organization. A user may have memberships in multiple organizations.

## Decision

Protect employee management with trusted tenant context and tenant-scoped Prisma predicates in the production store. Each list, detail, update, and deactivate query receives `tenant.organizationId`; mutations include that organization in their mutation predicate. A foreign or missing membership ID resolves to the same 404. Request body tenant and role properties are rejected by strict allowlists; query tenant values are not consulted by the route. Employee IDs from URL paths are only membership identifiers and every lookup also constrains `organizationId`.

Creation deliberately performs an exact global email upsert to reuse the global identity. It does not mutate an existing identity. It then creates a new membership with the trusted organization ID and the database-default MEMBER role in one transaction. A globally found email cannot select, overwrite, or change another organization's membership.

Deactivation checks last-active-owner safety within one serializable transaction. The target, owner count, update, and returned row are all scoped to the same organization. Inactive memberships are excluded by authorization and tenant-context lookups.

The store factory accepts the Prisma client so the actual production query implementation can be exercised against PostgreSQL. Production continues to use the repository's shared client. The integration suite invokes real employee handlers, the production store, and persisted PostgreSQL state from a dedicated CI database.

## Database-level enforcement and RLS

PostgreSQL RLS is not implemented. The shared Prisma client uses the PostgreSQL driver adapter and pooled connections. Tenant data queries are not uniformly enclosed in a tenant-aware transaction and do not set tenant-local session state. The repository does not define or verify production runtime role privileges (owner, superuser, `BYPASSRLS`) or a safe membership bootstrap exception. Applying partial policies now could fail open under the wrong role or block authentication-context lookup. Application-layer checks and PostgreSQL-backed query tests are useful, but are not equivalent to RLS.

Future RLS requires a reviewed role split (privileged migration role and non-owner runtime role with no bypass), a safe membership bootstrap policy/function, transaction-local context bound to the same connection as every protected operation, comprehensive transaction coverage (including background jobs), and integration tests for rollback and connection reuse. Until those prerequisites exist, retain application-level scoping without session variables or partial RLS.

## Consequences

- The employee query boundary is explicit, readable, and checked against PostgreSQL with two organizations.
- Global identity stays global; membership-specific employee data and lifecycle remain organization-specific.
- The shared Prisma client is not automatically tenant-scoped. Future tenant-owned query paths must be reviewed and tested; omission of an organization predicate remains possible outside the employee store.
- Organization settings continue to use trusted tenant ID in their Organization query, though the new integration suite is focused on employee membership operations.
- No schema change or migration was required for LMS-010.
- A successful PostgreSQL run is required before the ticket can be marked CODE COMPLETE, followed by independent external QA/security review. This ADR does not mark LMS-010 DONE.

## Alternatives considered

1. Add PostgreSQL RLS now — rejected because connection-scoped tenant context, runtime roles, and membership bootstrap are not safely established.
2. Add a generic tenant-aware Prisma framework — rejected because a small existing employee store boundary is sufficient; broad client wrapping would add complexity without covering every database path reliably.
3. Rely on the existing injected in-memory tests — rejected as sole evidence because they do not execute PostgreSQL queries.
4. Keep LMS-010 blocked until a future resource — superseded by LMS-012, which added the real organization-scoped employee boundary.

## Verification

`tests/tenant-isolation-postgres.test.ts` is configured to run against PostgreSQL 16 in CI after migrations are deployed. It is intended to prove tenant-filtered lists and ID lookups, cross-tenant update/deactivate rejection, persisted state after attacks, client field tampering, multi-organization membership field separation, global-email creation behavior, inactive-context rejection, last-owner protection, and concurrent owner deactivation safety. The current workspace has no PostgreSQL service or `TEST_DATABASE_URL`, so this suite was skipped locally and remains unverified. CI has not run for the current uncommitted changes.
