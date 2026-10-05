# Employee Management

LMS-012 represents an employee as the existing user's organization membership. It does not create another authentication identity or a separate HR model.

## Domain and lifecycle

`OrganizationMembership` is the tenant-owned employee boundary. Its UUID `id` is the API employee ID; its existing `(userId, organizationId)` unique key preserves one membership per user and organization. LMS-012 adds:

- `active`, defaulting to true, for organization-specific deactivation.
- nullable `employeeName`, the organization-specific employee display name. Existing memberships migrate with no employee name; an administrator can set one with PATCH. The employee API does not fall back to shared `User.name`.

Email is the existing global `User.email` authentication identity. It is read-only in employee APIs and retains its exact-value unique constraint and the current trim-but-preserve-case policy. Updating an employee name writes only the membership override. The API never changes a user's identity, password credential, session, or another organization membership.

Creating an employee looks up or creates a `User` using the exact supplied email, then creates a MEMBER membership in the trusted organization within one database transaction. A newly created identity has no password credential and cannot sign in. LMS-012 does not send invitations or create credentials/tokens; account activation is a dependency on LMS-014. Re-adding a deactivated membership is not provided; its unique membership record remains intact.

## API

Every operation calls LMS-009 `requireTenantContext()` without a client-provided organization candidate, and then uses `tenant.organizationId`. Responses set `Cache-Control: no-store` and expose only employee ID, email, display name, role, and active state.

| Method and route | Capability | Behavior |
| --- | --- | --- |
| `GET /api/organizations/employees` | `VIEW_ORGANIZATION` | List up to 100 memberships, ordered by creation time and membership ID; includes active and inactive records. |
| `POST /api/organizations/employees` | `MANAGE_MEMBERS` | Create a user identity if needed and a MEMBER membership. |
| `GET /api/organizations/employees/:employeeId` | `VIEW_ORGANIZATION` | Read one membership scoped to its ID and the trusted organization ID. |
| `PATCH /api/organizations/employees/:employeeId` | `MANAGE_MEMBERS` | Change only the organization-specific display name. |
| `POST /api/organizations/employees/:employeeId/deactivate` | `MANAGE_MEMBERS`, plus `MANAGE_ORGANIZATION_OWNERSHIP` for an OWNER target | Mark the membership inactive; do not delete the user or membership. |

Member creation always defaults to MEMBER. Role mutation, email mutation, reactivation, organization switching, and delete are not exposed. A user can hold different roles and active states in different organizations.

OWNER and ADMIN can manage ordinary memberships; MEMBER can read. Only OWNER has the LMS-008 ownership capability. The final active OWNER cannot be deactivated; the database mutation and owner count run in a serializable transaction. Deactivating one's own membership is permitted only when the caller has management permission and another active OWNER remains; the current session identity remains intact, but that organization will no longer resolve as an active tenant for that user.

## Validation and failure behavior

Email follows LMS-007: trim surrounding whitespace, require the same basic email shape and 254-byte bound, preserve casing, and rely on exact database uniqueness. Names are trimmed, 2–120 Unicode code points, and reject control characters and unpaired surrogates. Request objects reject unknown keys, including organization ID and role. IDs are checked as UUIDs before database access.

Cross-organization and missing employee IDs both return 404. Authentication, authorization, and tenant-context errors retain their established 401/403/503 codes. Duplicate membership returns a generic 409; the last-owner invariant returns a generic 409. Unexpected database errors return a generic 503 and are not serialized.

## Ownership and security boundary

Employee queries use membership persistence directly. Detail, update, and deactivation predicates include both `id: employeeId` and `organizationId: tenant.organizationId`; list always filters by trusted organization ID. They do not retrieve a global user by ID and then trust a separate permission check. User and membership creation is atomic. Existing `(userId, organizationId)` uniqueness and foreign keys are retained; a new `(organizationId, createdAt, id)` index supports deterministic bounded listing.

The shared LMS-008/LMS-009 membership lookup now requires `active: true`. Deactivation therefore prevents the membership from granting authorization or resolving a tenant, while a user's other active memberships and authentication identity remain available. LMS-010 verifies this employee boundary against PostgreSQL. Enforcement is application-query scoping for this feature, not general automatic Prisma scoping; there is no RLS.

`tests/employee-management.test.ts` exercises handler behavior with an injected store. `tests/tenant-isolation-postgres.test.ts` separately runs the production Prisma employee store and handlers against PostgreSQL in CI, checks tenant A/B reads and mutations, and inspects persisted state after the attempts. Run it locally with the dedicated `TEST_DATABASE_URL` described in [Tenant Isolation](tenant-isolation.md).

## Out of scope

Invitation emails/tokens and password setup (LMS-014), role changes or ownership transfer, reactivation, teams, courses, assignments, certificates, reporting, import, HR fields, employee dashboard, RLS, and automatic tenant scoping for future resources.
