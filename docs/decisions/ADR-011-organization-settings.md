# ADR-011: Organization Settings

- **Status:** Accepted
- **Date:** 2026-10-05
- **Ticket:** LMS-011

## Context

The repository has a foundational `Organization` model with `name`, unique
`slug`, timestamps, and memberships, but no organization settings route or
organization-owned product operations. LMS-007, LMS-008, and LMS-009 provide
the authentication, authorization, and trusted tenant context foundations.
At the time of this ADR, LMS-010 was awaiting a concrete resource; LMS-012
subsequently introduced organization-scoped employee operations, and LMS-010
now documents and tests that employee boundary.

The earlier organization-model decision explicitly deferred slug normalization,
case semantics, and slug update APIs. The database has an exact unique index on
the stored slug and no case-folded uniqueness invariant. No current application
code uses slugs for routing or lookup.

## Decisions

1. Reuse the existing `Organization` model and expose only `name` and `slug`.
   Do not add a settings table, columns, or migration.
2. Use `GET` and `PATCH /api/organizations/settings`. Resolve the organization
   with LMS-009's `requireTenantContext()` called without any request-supplied
   candidate. Apply LMS-008's existing view/manage settings permissions, then
   query the organization by the trusted `tenant.organizationId`.
3. Allow updates to the trimmed organization name only. Keep slug read-only in
   this ticket. Choosing a slug update policy without established normalization
   and case-insensitive uniqueness semantics risks URL identity ambiguity and
   collisions the existing exact database index may not prevent. Define those
   semantics and their database invariant in a future ticket before exposing
   slug mutation.
4. Return only `{ name, slug }`, validate a strict bounded name payload, reject
   unexpected keys, use explicit update fields, disable response caching, and
   preserve generic fail-closed error behavior.
5. Keep RLS, client organization switching, and all unrelated product features
   out of scope. This endpoint uses the trusted tenant ID. Its tenant boundary
   remains subject to the application-layer model documented in ADR-010.

## Consequences

OWNER, ADMIN, and MEMBER can read settings. OWNER and ADMIN can update the name;
MEMBER is denied. The endpoint does not accept organization IDs or roles from
the client. The existing schema and migration history remain unchanged.
Slug-update tests are not applicable because slug mutation is intentionally not
part of the API; tests verify that unexpected slug fields are rejected.

## Alternatives considered

- **Create a separate settings table:** rejected because all in-scope fields
  already exist on `Organization`.
- **Accept an organization ID from the client:** rejected because LMS-009
  provides a deterministic server-selected membership and this feature does
  not need organization switching.
- **Normalize and update slugs now:** deferred because the repository has no
  canonicalization/case decision or matching case-insensitive database
  invariant. A preflight query alone would not protect concurrent conflicting
  writes.
- **Implement general automatic scoping or RLS here:** rejected because this
  settings route does not provide the database role and transaction design
  required for safe RLS. LMS-010 separately verifies the employee operations
  against PostgreSQL; future tenant-owned query paths still require review.
