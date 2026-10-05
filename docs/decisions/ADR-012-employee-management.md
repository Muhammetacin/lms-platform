# ADR-012: Employee Management

- **Status:** Accepted
- **Date:** 2026-10-05
- **Ticket:** LMS-012

## Context

LMS-007 through LMS-009 provide the authenticated `User`, organization membership roles, and trusted tenant context. The smallest organization-owned employee representation is the existing `OrganizationMembership`: a user can be an employee in several organizations with different roles and active states. The global `User.email` is an exact-value unique authentication identity, and `User.name` is shared across organizations. At LMS-012 implementation time, LMS-010 was blocked on a real resource; LMS-010 subsequently added and passed PostgreSQL integration tests for the membership boundary.

## Decisions

1. Reuse `OrganizationMembership`; do not add an authentication model. Add nullable `employeeName` for organization-specific managed display name and `active BOOLEAN NOT NULL DEFAULT true` for per-organization lifecycle state. Keep the established UUID, timestamps, foreign keys, and `(userId, organizationId)` uniqueness. Add `(organizationId, createdAt, id)` for deterministic employee listing.
2. Resolve each request with LMS-009 `requireTenantContext()` and perform all employee persistence reads and writes with the trusted `organizationId`. Detail and mutation predicates include both membership ID and organization ID. No endpoint accepts tenant or role input.
3. Email and authentication identity remain global and read-only. Create finds or creates the user by exact trimmed email while preserving case, then creates its MEMBER membership atomically. An existing user's profile and other memberships are not changed. A new identity has no credential and cannot sign in; credential setup and invitation delivery belong to LMS-014.
4. Updating employee information changes only `employeeName`. Deactivation sets membership `active=false`; it does not delete the membership, user, credentials, sessions, or other organization relationships. LMS-008 authorization and LMS-009 tenant resolution exclude inactive memberships.
5. Reuse `VIEW_ORGANIZATION` for reads and `MANAGE_MEMBERS` for ordinary management. Deactivating an OWNER additionally requires `MANAGE_ORGANIZATION_OWNERSHIP`. The last active OWNER cannot be deactivated; count and state update run at serializable isolation. Do not expose role mutation or ownership transfer in this ticket.
6. Keep API responses limited to `{ id, email, name, role, active }`, validate strict bounded bodies and UUID IDs, return the same 404 for missing and cross-organization employee IDs, and map unexpected database errors to generic responses.
7. Do not implement RLS or general query middleware. LMS-012 gives LMS-010 a concrete organization-owned membership boundary and operation set to assess, but does not resolve the prior database-role/transaction concerns or claim LMS-010 complete.

## Consequences

Employee active state, display name, and role are organization-specific. The same identity can remain active in one organization while inactive in another. Existing memberships migrate as active with no employee display name; the employee API returns null until an administrator sets it, and never falls back to the shared `User.name`. Users with an inactive membership remain authenticated identities, but that organization no longer resolves as their active tenant.

The invitation workflow is incomplete by design: a newly provisioned identity has no password credential and no email delivery. LMS-014 must define secure claim/account-activation behavior. Employee role assignment and reactivation are also deferred rather than implicitly changing ownership rules.

The LMS-012 behavioral tests use an injected in-memory store. LMS-010 subsequently added a real PostgreSQL suite for the production employee store and handlers. Those application-level selectors do not constitute general automatic tenant scoping or RLS.

## Alternatives considered

- **Add an `Employee` model linked to `User` and `Organization`:** rejected because membership already encodes this relation and role; another model would duplicate membership identity without solving the shared email identity.
- **Write managed employee names to `User.name`:** rejected because a change in one organization would mutate profile data observed in other organizations.
- **Deactivate the global `User`:** rejected because that identity may have memberships in other organizations.
- **Change roles in employee PATCH:** deferred because an OWNER change alters ownership semantics, while existing general member-management permission is also granted to ADMIN.
- **Create an invitation token or password through this endpoint:** rejected because LMS-007 explicitly leaves credential provisioning and invitations to a trusted future flow, and LMS-014 owns invitation behavior.
- **Add RLS now:** rejected because LMS-010 documents unresolved transaction-local tenant context and runtime role guarantees; LMS-012 is not the RLS ticket.
