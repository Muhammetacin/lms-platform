# Tenant Isolation

**Status: BLOCKED — no organization-owned product resource or protected data route exists yet.**

This document records the LMS-010 inspection and the implementation boundary found in the current repository. It does not claim that application or database tenant isolation is implemented.

## Security model

For every organization-owned resource, a protected operation must require all of the following, in order:

1. LMS-007 authentication supplies the server-validated user identity.
2. LMS-008 authorization checks the capability and role stored for that user in the organization.
3. LMS-009 supplies a trusted `TenantContext` after verifying the user's membership in the selected organization.
4. The data operation scopes its target to `tenant.organizationId` and, for child data, proves the entire ownership chain.
5. Database constraints and, where a safe connection and bootstrap design exists, database policies protect the same invariants.

An organization ID from a URL, request body, query, header, cookie, form field, or client state is only an untrusted candidate. It cannot set the effective tenant, grant a role, or substitute for a resource ownership check. Resource access failures should use the application's generic authorization/not-found convention and must not disclose foreign-resource existence or database details.

## Current data classification

| Current model | Classification | Tenant-isolation implication |
| --- | --- | --- |
| `User` | Global identity | Not owned by one organization. |
| `PasswordCredential`, `Session` | Global authentication records associated with a user | Access is by authenticated identity or session token; these are not organization-owned resources. |
| `Organization` | Tenant root | An organization is the boundary itself. Any future organization-profile operation must verify membership/permission for that exact organization. |
| `OrganizationMembership` | Organization-scoped association between a global user and one organization | The row contains `organizationId`, is unique on `(userId, organizationId)`, and has foreign keys to its user and organization. Future reads or writes about a membership must additionally scope by the trusted organization and enforce the relevant permission. |

There are no organization-owned business models or child models in the Prisma schema today. There are no teams, courses, assignments, enrollments, reports, certificates, organization settings, or audit records. There are also no organization-scoped product API routes or server actions. Current database call sites access global authentication records and the membership store used to resolve authorization and tenant context.

The membership lookup is part of the bootstrap chain: the application must read membership data to establish the trusted tenant context. It is deliberately constrained by the authenticated `userId` and, for an explicit organization candidate, the exact candidate `organizationId`. Applying a tenant policy to this lookup without a separate, reviewed bootstrap path could prevent context resolution or create an exception that bypasses the policy.

## Trusted tenant context and authorization

`src/lib/tenant-context.ts` composes `getAuthenticatedUser()` with the shared `organizationMembershipStore`. Explicit organization candidates are validated against the authenticated user's membership; an invalid candidate fails without falling back. The context contains `{ userId, organizationId, role }`, with the role read from the stored membership.

Tenant context identifies the verified organization, but does not scope database queries or authorize an operation. Future protected operations must reuse the centralized LMS-008 `require*` authorization functions and LMS-009 context. A member role cannot be upgraded by client input or by merely matching the organization ID.

## Application-level enforcement

No central tenant-aware database access API exists yet, and no product resource operation exists where such an API could be applied and behaviorally verified. The current repository therefore has no application-level guarantee that arbitrary future Prisma reads or writes are tenant-scoped. The shared Prisma client remains a general database client used by authentication and membership-context code.

When an approved tenant-owned model and operation are introduced, the implementation must make the trusted tenant mandatory in the operation boundary. Parent reads and mutations must include the tenant predicate. Child reads and mutations must constrain the child through its parent chain, rather than trusting a child ID alone. Updates and deletes must use a tenant-scoped predicate in the mutation itself; a separate authorization lookup followed by an ID-only mutation is not sufficient.

No current product endpoint permits the listed cross-tenant course, team, employee, lesson, or certificate attacks because those endpoints and records do not exist. This absence is not evidence that tenant isolation has been implemented; it means LMS-010 cannot yet demonstrate or enforce the requested product-level boundary against actual resources.

## Database-level enforcement and RLS assessment

PostgreSQL RLS is **not implemented**. The repository uses one shared Prisma client backed by the PostgreSQL driver adapter. There is no tenant-scoped transaction API, no application database role/RLS policy setup, and no separate membership-context bootstrap policy or function. The repository configuration does not establish whether the runtime role is a table owner, superuser, or has `BYPASSRLS`; a policy alone would not prove that the application connection is subject to enforcement.

A safe RLS design would need to set a verified tenant value transaction-locally on the same connection as every protected query, ensure every path (including raw SQL and nested operations) uses that transaction, ensure the runtime database role cannot bypass RLS, and define how the application reads the membership needed to establish tenant context without opening an unsafe bypass. None of those controls exists or is verified in the current architecture. Adding policies only to membership or hypothetical future tables would be incomplete and could create a false security claim, so RLS is deferred pending a concrete resource and reviewed bootstrap/role design.

## Ownership integrity and performance

The current membership model has foreign keys to `User` and `Organization`, a unique `(userId, organizationId)` constraint, and an `(organizationId, role)` index. These enforce membership referential integrity and support existing organization/role lookup patterns; they do not enforce isolation for future data records.

For future tenant-owned parents, evaluate a unique `(organizationId, id)` key where needed for composite references. For each child-parent link, prefer a composite foreign key containing the same `organizationId` on both sides so a child cannot reference a parent in a different tenant. Add tenant-leading indexes only for actual lookup, join, sort, or mutation workloads. Each model addition must include a deterministic migration and tests for these database invariants.

## Cross-tenant attack scenarios

The required future guarantees include:

- A user in Organization A cannot retrieve, update, or delete an Organization B resource by substituting its ID.
- A user cannot enumerate another tenant's resources by changing IDs or supplying a foreign tenant ID in the URL, body, query, header, or form.
- A user cannot access a foreign child by its ID or by traversing a parent/child route with mismatched ownership.
- A client-provided role or organization ID cannot override the membership-backed authorization and tenant context.
- Missing identity, membership, context, permission, or database availability fails closed.

The present repository has no product resource endpoints on which to run these attack cases. Existing authorization and tenant-context tests exercise in-memory stores and do not prove database-level isolation.

## Test strategy and limitations

LMS-007 through LMS-009 tests cover authentication, role checks, membership validation, forged tenant candidates, and fail-closed behavior. These are relevant prerequisites but are not cross-tenant data-isolation tests. Current CI has no tenant-isolation suite and no database integration test setup. No RLS claim or real-database isolation claim is made.

LMS-010 needs an approved organization-owned model and an actual protected read/write/delete boundary before meaningful integration tests can verify cross-tenant reads, updates, deletes, enumeration, client tampering, and nested ownership. A test of a standalone helper against only an in-memory store would not satisfy that requirement.

## Blocker and next step

The ticket requires end-to-end isolation for organization-owned resources but also prohibits implementing the product resources that would make that requirement concrete. The current schema and routes provide no such resources. Inventing an organization setting, generic key/value table, sample business model, or synthetic production API would silently select product semantics outside this ticket.

**Recommended resolution:** keep LMS-010 blocked until an approved product ticket defines the first organization-owned model and its protected operations, then implement and test the tenant boundary at that concrete access layer. Alternatively, the product owner can explicitly narrow LMS-010 to a named existing resource or approve the smallest concrete resource/API to include. After that decision, revisit a central tenant-aware database access pattern and RLS using the actual query and membership-bootstrap requirements.

See [ADR-010](decisions/ADR-010-tenant-isolation.md) and [LMS-010](../tickets/LMS-010.md) for the options and required decision.
