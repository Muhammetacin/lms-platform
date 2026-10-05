# ADR-009: Trusted Tenant Context

- **Status:** Accepted
- **Date:** 2026-10-04
- **Ticket:** LMS-009

## Context

LMS-007 supplies a server-validated authenticated identity. LMS-008 verifies organization membership and obtains the stored role for an explicit organization. Users can belong to multiple organizations, and no active organization context exists yet. LMS-009 needs to select an organization without trusting browser input or taking on tenant isolation.

## Decision

- Add a server-only tenant-context API that composes `getAuthenticatedUser()` with the shared LMS-008 organization membership store. It does not parse cookies or implement another authentication/session path.
- If the caller provides an organization ID, treat it only as an untrusted candidate. Validate its UUID shape, then look up the exact membership using the authenticated user's ID. Return the role from that membership. An invalid or non-member candidate fails with the same generic 403 and never falls back to another organization.
- If the caller provides no candidate, select the first server-stored membership ordered by `createdAt` ascending, then `organizationId` ascending. A user without memberships receives a stable 403 result.
- Keep the trusted DTO small: `{ userId, organizationId, role }`. The role is read from PostgreSQL and is never accepted from the request.
- Keep tenant context in a dedicated core and server-only module. Distinguish unauthenticated, missing membership, invalid explicit context, and unavailable storage outcomes; do not include internal database errors.
- Do not persist an active organization in a cookie or session claim. No product UI or query/header integration is needed for this foundation ticket.
- Keep tenant isolation and authorization policy separate. Resolving context neither scopes queries nor authorizes an operation; protected operations continue to need LMS-008 checks, and LMS-010 owns tenant isolation.

## Consequences

The Prisma schema and migration history remain unchanged. Multi-organization users have a deterministic default and can resolve any organization for which the server confirms membership. A caller can request a different membership, but a forged ID cannot be elevated into trusted context. Data reads and writes remain unscoped by this ticket; no RLS or tenant-isolation claim is made.

## LMS-012 membership lifecycle extension (2026-10-05)

Employee Management adds organization-scoped `OrganizationMembership.active`. The shared membership store used here and by LMS-008 filters inactive rows in both explicit and default context resolution. Deactivation consequently removes that organization membership's authorization and tenant context without deleting the global user or affecting other organization memberships. This lifecycle extension does not add automatic scoping to other domain data, RLS, or an LMS-010 completion claim.

## Alternatives considered

- **Trust an organization ID from a browser cookie, URL, header, or role claim:** rejected because the input does not establish membership and can be forged.
- **Require an explicit organization on every call:** secure, but it adds avoidable friction to the existing foundation when the stored membership timestamps provide a deterministic MVP default.
- **Persist active organization in a cookie or session claim:** rejected because it adds client-controlled state without removing the need to revalidate membership on every use.
- **Silently fall back after an invalid explicit request:** rejected because it hides stale or forged context and could operate on a different organization than the caller intended.
- **Add RLS, query middleware, or automatic data scoping:** deferred to LMS-010, which owns tenant isolation.
