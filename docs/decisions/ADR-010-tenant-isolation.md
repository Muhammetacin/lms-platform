# ADR-010: Tenant Isolation

- **Status:** Proposed — implementation blocked pending scope decision
- **Date:** 2026-10-04
- **Ticket:** LMS-010

## Context

LMS-007 provides authenticated identity, LMS-008 provides centralized organization authorization, and LMS-009 provides a trusted tenant context derived from the authenticated user's stored membership. LMS-010 asks for application and database tenant isolation, including cross-tenant reads, updates, deletes, nested ownership, client-tampering tests, database constraints, and an RLS assessment.

The inspected repository has only `User`, `PasswordCredential`, `Session`, `Organization`, and `OrganizationMembership` models. There are no organization-owned product resources or protected product routes/actions. Current database callers access global authentication records and membership data used to bootstrap authorization and tenant context. The project rules and prior tickets defer settings, teams, courses, employees, reports, and other domain features.

## Decision proposal

Do not claim LMS-010 complete and do not add a placeholder business resource, generic resource store, or incomplete RLS policy to create an artificial test target. Keep LMS-010 blocked until an approved tenant-owned model and at least one protected read/write/delete operation are in scope. Then enforce the trusted tenant in the real operation boundary and test it against that model and database.

The decision to stop is safe for the current codebase because no organization-owned product operation exists to expose another organization's business data. It does not establish isolation for future resources. Any future organization-owned operation must be treated as unprotected until tenant enforcement is implemented and reviewed.

## RLS assessment

RLS is not implemented. The present Prisma architecture uses a shared `PrismaClient` and PostgreSQL adapter without a tenant-scoped transaction boundary. Tenant context itself depends on membership reads, but there is no separate bootstrap policy or function. The repository also does not verify the deployed runtime role's ownership, superuser, or `BYPASSRLS` properties. Creating policies without those verified role and transaction guarantees could be bypassable or could block the membership lookup required to obtain context.

RLS should be reconsidered only with a concrete protected model and a design that proves all of the following: the tenant value derives from server-verified context; it is transaction-local on the same connection as protected work; all protected Prisma and raw SQL paths run under that transaction; runtime credentials cannot bypass the policy; migrations use a distinct privileged role; and the membership bootstrap path remains safe. Until then, RLS would provide a false sense of security.

## Alternatives

1. **Recommended: defer LMS-010 enforcement until a product ticket defines a real tenant-owned model and operation.** This avoids inventing domain semantics and allows meaningful cross-tenant integration tests. The cost is that no future organization-owned resource may be treated as protected until this work is resumed.
2. **Narrow LMS-010 to a specific already-existing tenant-owned resource and its real API.** The current repository has no such resource, so the product owner would need to name an existing target outside this checkout or approve a scope change.
3. **Approve a minimal concrete resource/API within LMS-010.** This could make the boundary testable now, but it adds product data-model and API scope that the current ticket explicitly forbids the implementation from inventing.
4. **Add RLS or generic query middleware without a real resource operation.** Rejected: the implementation would be unproven, would not protect current business data, and risks interfering with membership bootstrap or being bypassed by the shared database role.

## Consequences and follow-up

- `TenantContext` remains context only; it does not scope queries.
- `OrganizationMembership` constraints and its existing indexes remain useful integrity controls but do not isolate future resources.
- No schema migration, query layer, API change, RLS policy, or tenant-isolation test is added by this blocked change.
- The future implementation should reuse LMS-007 through LMS-009, scope reads and mutation predicates to the trusted organization, constrain child ownership in both application queries and database relations where practical, and test with two tenants against the real persistence boundary.
- If a future parent and child both carry `organizationId`, prefer a composite foreign key that enforces matching tenant ownership. Index decisions must follow actual tenant-scoped query patterns.

## Required decision

The product owner must either:

- confirm that LMS-010 waits for the first concrete tenant-owned resource ticket; or
- name the approved existing or newly in-scope model and protected operations that LMS-010 should secure.

Until that decision is made, ticket status remains **BLOCKED**. This ADR does not mark LMS-010 code complete.
