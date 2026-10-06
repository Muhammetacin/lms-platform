# Tenant Isolation

**Status: CODE COMPLETE — independent QA/security review required.** The earlier employee isolation implementation passed in CI run [37315646821](https://github.com/Muhammetacin/lms-platform/actions/runs/37315646821) for commit `bc4eeb0144ea0e2ebe73e25dd78b0f9be652dc06`. LMS-015 Team PostgreSQL tests, related regressions, lint, typecheck, and build passed in CI run [31](https://github.com/Muhammetacin/lms-platform/actions/runs/37497930810) for PR #3 head `8df874ebcefb8fe5334fb7f308141accfb48adac`.

This guide records protected tenant boundaries for organization employee management, LMS-015 Teams, and LMS-016 Team membership. Stores use application-layer query scoping; Team membership also has PostgreSQL composite foreign keys that enforce same-tenant parent relationships. PostgreSQL RLS is not enabled, and application checks are not equivalent to RLS.

## Data classification

| Model | Classification | Boundary |
| --- | --- | --- |
| `User` | Global identity | A single identity and exact-value unique email may be associated with several organizations. |
| `PasswordCredential` | Global authentication data | Belongs to a `User`; never scoped to an organization. |
| `Session` | Global authentication data | Belongs to a `User`; never scoped to an organization. |
| `Organization` | Tenant root | Organization settings are read or changed only for the trusted context's organization. |
| `OrganizationMembership` | Tenant-owned association | Each row belongs to exactly one `organizationId`. Its `organizationId`, `role`, `employeeName`, `jobTitle`, `department`, `phone`, `employeeNumber`, and `active` are organization-specific. |
| `EmployeeInvitation` | Tenant-scoped bootstrap credential | Stores a one-way token digest and explicit user, organization, and membership references. Public activation looks up a row by the bearer token digest, then checks all linked identity and tenant keys against the membership. |
| `Team` | Tenant-owned group | Belongs to exactly one organization. The database enforces unique `(organizationId, name)`; every API/store operation scopes by the trusted organization ID. |
| `TeamMembership` | Tenant-owned relationship | Links one Team to one `OrganizationMembership`; the composite foreign keys require the Team, employee membership, and junction row to share `organizationId`. |

Employee management and profiles use the existing membership relation. They do not create a duplicate employee or user identity model. Email remains on the global `User`; employee display name, job title, department, phone, employee number, role, and active state remain on the membership for that organization. Employee-number uniqueness is enforced by `(organizationId, employeeNumber)`, so equal values in different organizations are valid.

LMS-017 import resolves the tenant only through `requireTenantContext()` and requires `MANAGE_MEMBERS` before processing the upload. It does not accept tenant selection from a CSV header, form value, filename, query, or request header. The production import store scopes its preflight membership conflict query to that trusted `organizationId`, then creates global users and organization memberships in the same serializable transaction. Global email reuse does not read or modify another organization's membership or employee number; equal employee numbers across organizations remain valid. Database uniqueness and one retry after a serialization conflict protect concurrent imports and manual creation.

## Trusted tenant derivation

The employee routes call `requireTenantContext()` without a client candidate. LMS-007 supplies the authenticated identity. LMS-009 resolves that identity's active membership from the server-side store; if the identity has multiple active memberships, the current product behavior selects its deterministic default. A client-supplied organization ID, role, or membership state does not become the effective tenant.

Employee handlers then check LMS-008 permissions against that tenant ID and pass the same trusted ID to the employee store. No organization switch feature is introduced. Body fields are allowlisted: create accepts only email and name, and update accepts only name. Detail/deactivate IDs identify a membership, never its organization.

The LMS-014 invitation endpoint likewise uses the authenticated tenant context and selects a target with both membership ID and organization ID. Its request body is empty; forged `organizationId` and `tenantId` fields are rejected. Public activation accepts only the random invitation token (plus password fields at activation); it derives organization and membership from the invitation row and verifies that the referenced user, organization, and membership agree. Activation never takes an employee ID or tenant choice from the browser. Invalid and cross-tenant employee IDs return indistinguishable 404 responses.

The LMS-015 Team routes call `requireTenantContext()` without a client-selected organization. Team creation passes only that trusted organization ID to the store; create and update bodies allow only `name` and `description`. List filters in PostgreSQL on `organizationId`; detail and mutation predicates include both Team ID and organization ID. `organizationId`, `tenantId`, `ownerId`, and role fields are rejected from request bodies, and query/header organization values do not select the tenant. Foreign and missing Team IDs return the same `team_not_found` 404 response.

LMS-016 member routes use the same trusted tenant context. GET checks the Team by `(id, organizationId)` and selects only active organization memberships related to that Team. POST accepts only an `employeeId` that is an `OrganizationMembership.id`; the Team, membership, and new junction row are checked and written in one serializable transaction. DELETE filters by trusted organization, Team ID, and membership ID. Foreign Team/member combinations return safe not-found responses. No request tenant, Team ID, global User ID, or Team role can set the relationship.

## Enforced employee operations

The production Prisma store applies the tenant predicate in each resource operation:

- List: `OrganizationMembership.findMany({ where: { organizationId } })`.
- Detail: `findFirst({ where: { id: employeeId, organizationId } })`.
- Name update: `updateMany({ where: { id: employeeId, organizationId } })`, followed by a read with the same predicate.
- Profile read: select the profile by both employee ID and trusted organization ID. MEMBER requests also compare the membership user ID with the authenticated tenant user ID and return the same 404 for another or missing profile.
- Profile update: `updateMany({ where: { id: employeeId, organizationId } })`, followed by a read with the same predicate. Update data is validated and explicitly mapped; MEMBER can change only their own name, job title, department, or phone. OWNER/ADMIN can also manage employee number.
- Deactivation: target read, active-owner count, update, and result read all run in a serializable transaction and are constrained to that organization. The owner count includes the same `organizationId`.
- Create: the global exact-email upsert only obtains or creates the global identity. Membership creation is an atomic insert with the trusted `organizationId`, default MEMBER role, and only the caller's employee name. It does not update an existing user's global identity or any other organization's membership.
- Employee import: preflight finds matching email memberships and employee numbers with `where: { organizationId, OR: [...] }`. The serializable transaction creates missing `User` rows with exact-email `skipDuplicates`, resolves those global identities, then creates every MEMBER/active membership with the same trusted organization ID. A current-tenant conflict returns safe row-level errors; a concurrent unique or serialization conflict rolls back the transaction and is rechecked before one serialization retry. It never performs an upsert on a membership.
- Team list: `Team.findMany({ where: { organizationId } })` orders by `name`, then `id`.
- Team detail: `Team.findFirst({ where: { id: teamId, organizationId } })`.
- Team update: `Team.updateMany({ where: { id: teamId, organizationId } })`, followed by a read with the same predicate.
- Team delete: `Team.deleteMany({ where: { id: teamId, organizationId } })`; an unmatched count maps to the same not-found response as a foreign ID.
- Team create: `Team.create` always receives `organizationId` from the trusted context. The `(organizationId, name)` unique index handles concurrent duplicate names and is mapped to a generic 409.
- Team member list: the Team is looked up with both Team ID and trusted organization ID; the membership query filters on that organization and `active: true`, and orders by employee name then membership ID.
- Team member add: the serializable transaction checks the Team with `(id, organizationId)`, checks `OrganizationMembership` with `(id, organizationId, active: true)`, rejects an existing tenant-scoped link, and creates the junction row using only those validated values. The unique `(teamId, membershipId)` constraint is the final duplicate guard; concurrent conflict/serialization outcomes map to 409 when the link exists.
- Team member remove: `deleteMany` requires the trusted organization ID, Team ID, and membership ID together. A no-match response does not distinguish missing, foreign, or already-removed targets.

Foreign membership IDs return the same `employee_not_found` 404 as unknown IDs. List results contain only current-tenant rows. Employee response fields are explicitly selected; database exceptions are reduced to a generic unavailable response. This limits IDOR/BOLA, horizontal mutation, and existence/data disclosure at this boundary.

## Database enforcement and RLS assessment

Database-backed integration tests instantiate the production Prisma stores using the PostgreSQL driver adapter and call the employee, profile, import, Team, and TeamMembership handlers against a dedicated `lms_platform_test` database. The CI PostgreSQL 16 service applies committed migrations before tests. The employee import suite covers same-user membership reuse across tenants, current-tenant conflicts, foreign employee-number reuse, a forced database conflict with transaction rollback, concurrent duplicate imports, and absence of credentials, invitations, and TeamMembership side effects. The TeamMembership suite directly attempts inconsistent composite tuples and proves PostgreSQL rejects Team A + employee B, Team B + employee A, and mismatched organization IDs. It also checks duplicate and concurrent adds, cross-tenant API attacks, active filtering, safe deletes, and cascades for Team, membership, and organization deletion.

RLS is **not used**. `src/lib/db.ts` owns one Prisma client using `PrismaPg`; the adapter obtains pooled PostgreSQL connections. Interactive Prisma transactions pin a connection for a transaction, but protected calls currently do not establish transaction-local tenant settings, and list/detail operations can run outside a transaction. No runtime database-role grants/ownership attributes are defined or verified here, nor is there a separate policy-safe membership bootstrap path. A session setting on a pooled connection could leak between requests if it were not strictly transaction-local. RLS policies added without all of those guarantees could be bypassed or prevent tenant-context lookup. No RLS policy or equivalent database enforcement claim is made.

The current application role has the schema privileges needed by CI migrations and is not evidence of production least-privilege/RLS behavior. Future RLS work requires a dedicated migration role and non-owner runtime role without superuser or `BYPASSRLS`, a reviewed bootstrap policy/function, transaction-local tenant context set and consumed on the same connection, complete transaction coverage for every tenant query, and tests that prove rollback/pool reuse cannot retain context.

## Multi-organization identities and inactive memberships

Membership is the tenant-specific employee record. A global user may have distinct names, roles, and active state in organizations A and B. Updating or deactivating membership A does not update membership B. A global email match during creation does not grant membership or permission in the organization where the identity already exists.

Authorization and tenant-context stores require `active: true`. An inactive-only identity cannot establish a tenant context or access the employee APIs. Active membership in one organization does not activate or authorize a different membership.

## Owner safety and transactions

Owner deactivation reads the target, counts active owners, changes membership state, and selects the result inside one serializable Prisma transaction. Every query includes the target `organizationId`. Concurrent last-owner changes may cause PostgreSQL serialization failure; that fails closed and cannot remove the final active owner. A foreign organization's owners are not included in the calculation.

## PostgreSQL integration tests

CI provisions a PostgreSQL 16 service and sets `TEST_DATABASE_URL` to the dedicated `lms_platform_test` database. The tests refuse a database with any other name, write uniquely identified fixture rows, exercise actual production Prisma stores through their handler boundaries, query persisted state, then remove their organizations and users. The earlier employee suite passed in CI run [37315646821](https://github.com/Muhammetacin/lms-platform/actions/runs/37315646821); that result does not substitute for the new Team suite.

Locally, provision an isolated PostgreSQL database named `lms_platform_test`, set `TEST_DATABASE_URL` to that database, apply migrations with `pnpm db:migrate:deploy`, then run `pnpm test:employee-import:db`, `pnpm test:tenant-isolation:db`, `pnpm test:team:db`, and `pnpm test:team-membership:db`. Without `TEST_DATABASE_URL`, database suites report skipped; this is not a passing database verification. CI always configures the service and runs the suites.

## Scope and limitations

- `OrganizationMembership` is both the employee record and part of the auth/context bootstrap. RLS has been deferred as described above.
- Application-layer correctness depends on all tenant-owned access continuing to go through reviewed handlers/stores. The shared Prisma client itself is not tenant-aware and does not automatically scope arbitrary future queries.
- Organization settings already use `tenant.organizationId` for their Organization lookup/update, but the new PostgreSQL attack suite specifically exercises employee operations.
- LMS-016 enforces Team/employee tenant consistency with composite FKs as well as tenant-scoped queries. Deactivation remains owned by LMS-012: it preserves TeamMembership history, while operational Team member reads hide inactive employees. Hard deletion of a Team or OrganizationMembership cascades to TeamMembership rows.
- TeamMembership has no Team role or permissions. Its add/remove authorization reuses `MANAGE_TEAMS`, reads use `VIEW_ORGANIZATION`, and mutation audit events depend on LMS-058; no parallel audit system is added.
- Independent external QA/security review remains required; automated tests do not mark the ticket DONE.

See [ADR-010](decisions/ADR-010-tenant-isolation.md), [LMS-009 Tenant Context](tenant-context.md), [LMS-012 Employee Management](employee-management.md), [LMS-017 Employee CSV Import](employee-import.md), and [LMS-010](../tickets/LMS-010.md).
