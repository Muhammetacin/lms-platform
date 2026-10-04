# ADR-008: Centralized Organization Authorization

- **Status:** Accepted
- **Date:** 2026-10-04
- **Ticket:** LMS-008

## Context

LMS-007 provides a server-side `getAuthenticatedUser()` identity boundary. The existing database already stores `OWNER`, `ADMIN`, or `MEMBER` on the explicit `OrganizationMembership` relation. No organization-scoped product routes or mutations currently exist. Authorization must use trusted membership data without changing the existing role model or taking on tenant context/isolation work.

## Decision

- Add a server-only authorization interface that composes the existing authentication function with the shared server-only Prisma client. Authentication remains responsible for sessions and identity; authorization does not parse cookies or session tokens.
- Resolve a user's role from the exact `(userId, organizationId)` membership pair for each organization-scoped decision. A user identity or client-supplied role alone is never sufficient.
- Keep role rank and the initial capability-to-minimum-role mapping in one pure authorization core. `OWNER` satisfies `ADMIN` and `MEMBER`; `ADMIN` satisfies `MEMBER`.
- Require an explicit, valid organization ID. Return generic 403 failures for absent membership, invalid organization context, and insufficient role. Distinguish unauthenticated requests with 401. Convert authorization lookup failures and unknown stored roles into a generic fail-closed 503 result.
- Expose `can()` as a non-throwing UX query only. Mandatory reads and writes must use server-side `require*` checks at the protected operation.
- Keep tenant context in LMS-009 and data isolation in LMS-010. The membership lookup does not select an active organization or isolate data queries.

## Consequences

The Prisma schema and migration history remain unchanged. Future organization routes can share one auditable role and permission policy, and tests can exercise the policy without a live database. Future operations still must call the guard themselves; LMS-008 does not add middleware, alter existing authentication routes, or claim that data is tenant-isolated.

## Alternatives considered

- **Put a global role on `User`:** rejected because the established role describes membership in a particular organization and one user can have different roles in different organizations.
- **Trust a role in client state or a session claim:** rejected because the role must reflect trusted server-side membership data and may differ by organization.
- **Use only UI checks or route-wide middleware:** rejected because direct requests to protected operations still require an authorization check next to the operation.
- **Add platform roles or tenant isolation now:** rejected because those concepts belong to separately scoped architecture decisions in future tickets.
