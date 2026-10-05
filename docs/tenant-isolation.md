# Tenant Isolation

**Status: BLOCKED pending a successful PostgreSQL integration run.** The implementation and CI service configuration are present, but this workspace has no PostgreSQL service or `TEST_DATABASE_URL`; the local integration test was skipped. Do not treat the database boundary as verified until the configured CI suite passes.

This guide records the intended protected tenant boundary: organization employee management backed by `OrganizationMembership`. It is application-layer query scoping with PostgreSQL verification configured but not yet executed for the current changes. PostgreSQL RLS is not enabled, and this design does not claim that application checks are equivalent to RLS.

## Data classification

| Model | Classification | Boundary |
| --- | --- | --- |
| `User` | Global identity | A single identity and exact-value unique email may be associated with several organizations. |
| `PasswordCredential` | Global authentication data | Belongs to a `User`; never scoped to an organization. |
| `Session` | Global authentication data | Belongs to a `User`; never scoped to an organization. |
| `Organization` | Tenant root | Organization settings are read or changed only for the trusted context's organization. |
| `OrganizationMembership` | Tenant-owned association | Each row belongs to exactly one `organizationId`. Its `organizationId`, `role`, `employeeName`, and `active` are organization-specific. |

Employee management uses the existing membership relation. It does not create a duplicate employee or user identity model. Email remains on the global `User`; employee display name, role, and active state remain on the membership for that organization.

## Trusted tenant derivation

The employee routes call `requireTenantContext()` without a client candidate. LMS-007 supplies the authenticated identity. LMS-009 resolves that identity's active membership from the server-side store; if the identity has multiple active memberships, the current product behavior selects its deterministic default. A client-supplied organization ID, role, or membership state does not become the effective tenant.

Employee handlers then check LMS-008 permissions against that tenant ID and pass the same trusted ID to the employee store. No organization switch feature is introduced. Body fields are allowlisted: create accepts only email and name, and update accepts only name. Detail/deactivate IDs identify a membership, never its organization.

## Enforced employee operations

The production Prisma store applies the tenant predicate in each resource operation:

- List: `OrganizationMembership.findMany({ where: { organizationId } })`.
- Detail: `findFirst({ where: { id: employeeId, organizationId } })`.
- Name update: `updateMany({ where: { id: employeeId, organizationId } })`, followed by a read with the same predicate.
- Deactivation: target read, active-owner count, update, and result read all run in a serializable transaction and are constrained to that organization. The owner count includes the same `organizationId`.
- Create: the global exact-email upsert only obtains or creates the global identity. Membership creation is an atomic insert with the trusted `organizationId`, default MEMBER role, and only the caller's employee name. It does not update an existing user's global identity or any other organization's membership.

Foreign membership IDs return the same `employee_not_found` 404 as unknown IDs. List results contain only current-tenant rows. Employee response fields are explicitly selected; database exceptions are reduced to a generic unavailable response. This limits IDOR/BOLA, horizontal mutation, and existence/data disclosure at this boundary.

## Database enforcement and RLS assessment

Database-backed integration tests instantiate the production Prisma store using the PostgreSQL driver adapter and call the employee handlers against a dedicated `lms_platform_test` database. The CI PostgreSQL 16 service applies committed migrations before tests. The tests inspect persisted membership rows after rejected foreign reads, updates, deactivations, forged input, employee creation for an email already present in another organization, and concurrent owner deactivation.

RLS is **not used**. `src/lib/db.ts` owns one Prisma client using `PrismaPg`; the adapter obtains pooled PostgreSQL connections. Interactive Prisma transactions pin a connection for a transaction, but protected calls currently do not establish transaction-local tenant settings, and list/detail operations can run outside a transaction. No runtime database-role grants/ownership attributes are defined or verified here, nor is there a separate policy-safe membership bootstrap path. A session setting on a pooled connection could leak between requests if it were not strictly transaction-local. RLS policies added without all of those guarantees could be bypassed or prevent tenant-context lookup. No RLS policy or equivalent database enforcement claim is made.

The current application role has the schema privileges needed by CI migrations and is not evidence of production least-privilege/RLS behavior. Future RLS work requires a dedicated migration role and non-owner runtime role without superuser or `BYPASSRLS`, a reviewed bootstrap policy/function, transaction-local tenant context set and consumed on the same connection, complete transaction coverage for every tenant query, and tests that prove rollback/pool reuse cannot retain context.

## Multi-organization identities and inactive memberships

Membership is the tenant-specific employee record. A global user may have distinct names, roles, and active state in organizations A and B. Updating or deactivating membership A does not update membership B. A global email match during creation does not grant membership or permission in the organization where the identity already exists.

Authorization and tenant-context stores require `active: true`. An inactive-only identity cannot establish a tenant context or access the employee APIs. Active membership in one organization does not activate or authorize a different membership.

## Owner safety and transactions

Owner deactivation reads the target, counts active owners, changes membership state, and selects the result inside one serializable Prisma transaction. Every query includes the target `organizationId`. Concurrent last-owner changes may cause PostgreSQL serialization failure; that fails closed and cannot remove the final active owner. A foreign organization's owners are not included in the calculation.

## PostgreSQL integration tests

CI is configured to provision a PostgreSQL 16 service and set `TEST_DATABASE_URL` to the dedicated `lms_platform_test` database. The test refuses a database with any other name, writes uniquely identified fixture rows, exercises actual production Prisma store queries through the employee handler boundary, queries persisted state, then removes its organizations and users. It is not a mocked store test. This workflow has not run for the current uncommitted changes.

Locally, provision an isolated PostgreSQL database named `lms_platform_test`, set `TEST_DATABASE_URL` to that database, apply migrations with `pnpm db:migrate:deploy`, then run `pnpm test:tenant-isolation:db`. Without `TEST_DATABASE_URL`, the suite reports skipped; this is not a passing database verification. CI always configures the service and runs the suite.

## Scope and limitations

- `OrganizationMembership` is both the employee record and part of the auth/context bootstrap. RLS has been deferred as described above.
- Application-layer correctness depends on all tenant-owned access continuing to go through reviewed handlers/stores. The shared Prisma client itself is not tenant-aware and does not automatically scope arbitrary future queries.
- Organization settings already use `tenant.organizationId` for their Organization lookup/update, but the new PostgreSQL attack suite specifically exercises employee operations.
- There are no other tenant-owned business models in scope. Each new model/route/action must add tenant-scoped selectors and real PostgreSQL isolation tests; child ownership should be enforced with same-tenant composite foreign keys when its schema supports them.
- The successful PostgreSQL suite is still required before this ticket can become CODE COMPLETE. After that, independent external QA/security review remains required; automated tests do not mark the ticket DONE.

See [ADR-010](decisions/ADR-010-tenant-isolation.md), [LMS-009 Tenant Context](tenant-context.md), [LMS-012 Employee Management](employee-management.md), and [LMS-010](../tickets/LMS-010.md).
