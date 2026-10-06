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

## Employee invitation and account activation (LMS-014)

`POST /api/organizations/employees/:employeeId/invitation` uses `MANAGE_MEMBERS` (OWNER and ADMIN) after deriving the trusted tenant context. The store locates the target with both membership ID and organization ID, and accepts only an active MEMBER with no existing `PasswordCredential`. Cross-tenant IDs share the same 404 response as missing IDs; ineligible employees receive a generic 409. Tenant and role fields are not accepted in the request body.

The `EmployeeInvitation` row points to exactly one global user, organization, and membership. It stores only the SHA-256 digest of a random 256-bit Base64URL token, expires after 72 hours, and is consumed once. The raw token travels in the activation URL fragment so it is not sent to the web server in the page request. The page removes it from the address bar before making an API request. Creating a replacement invitation and consuming prior unconsumed rows run in one serializable transaction. The employee's active state is checked on validation and again during the activation transaction, so deactivation makes outstanding invitations unusable.

`POST /api/auth/invitations/validate` and `POST /api/auth/invitations/activate` are separate same-origin JSON endpoints and do not require a logged-in session. The client cannot choose a tenant. Activation inserts a `PasswordCredential` using LMS-007's existing scrypt helper and policy while consuming the invitation in one serializable transaction. Existing credentials are never replaced; LMS-014 does not implement password reset or session creation. Successful activation is followed by ordinary LMS-007 login.

LMS-052 email delivery is not yet implemented in this repository. A narrow delivery interface exists, and the production adapter reports unavailable; invitation creation returns a generic 503 without storing a token until an actual provider is connected. The raw token is handed only to that delivery interface and never returned by the admin API. There is no parallel mail framework or fake sender. LMS-058 audit logging is also not yet available; invitation events depend on its shared service.

## Validation and failure behavior

Email follows LMS-007: trim surrounding whitespace, require the same basic email shape and 254-byte bound, preserve casing, and rely on exact database uniqueness. Names are trimmed, 2–120 Unicode code points, and reject control characters and unpaired surrogates. Request objects reject unknown keys, including organization ID and role. IDs are checked as UUIDs before database access.

Cross-organization and missing employee IDs both return 404. Authentication, authorization, and tenant-context errors retain their established 401/403/503 codes. Duplicate membership returns a generic 409; the last-owner invariant returns a generic 409. Unexpected database errors return a generic 503 and are not serialized.

## Employee profile (LMS-013)

The employee profile remains on the tenant-owned `OrganizationMembership`; it does not add organization-specific data to global `User`. In addition to `employeeName`, the membership stores nullable `jobTitle`, `department`, `phone`, and `employeeNumber`. Email remains the global, read-only authentication identity. Role and active state remain LMS-012-managed and are never writable through the profile endpoint.

| Method and route | Authorization | Behavior |
| --- | --- | --- |
| `GET /api/organizations/employees/:employeeId/profile` | OWNER/ADMIN: `VIEW_EMPLOYEE_PROFILES`; MEMBER: `VIEW_OWN_MEMBERSHIP` plus own-membership check | Return selected profile fields for an organization-scoped membership. MEMBER can read only their own profile. |
| `PATCH /api/organizations/employees/:employeeId/profile` | OWNER/ADMIN: `MANAGE_MEMBERS`; MEMBER: `MANAGE_OWN_PROFILE` plus own-membership check | OWNER/ADMIN can edit profile fields, including `employeeNumber`. MEMBER can edit `employeeName`, `jobTitle`, `department`, and `phone` on their own profile. |

Every profile query uses both membership ID and the trusted tenant organization ID. A MEMBER targeting another membership receives the same 404 as a missing profile. Cross-organization and missing IDs also share LMS-010's 404 behavior. Responses select only ID, email, profile fields, role, and active state; the internal user ID used for ownership checks is not returned. Responses use `Cache-Control: no-store`.

`employeeNumber` is optional and unique within an organization through the database unique index on `(organizationId, employeeNumber)`. The value is trimmed and case-preserving, so uniqueness follows PostgreSQL's exact string comparison; the same value is valid in another organization. Null values do not conflict. Optional fields (`jobTitle`, `department`, `phone`, and `employeeNumber`) are trimmed, may be cleared with `null`, reject blank strings and control characters, and are bounded to 120 Unicode code points. `employeeName` reuses LMS-012's 2–120 code point validation and does not accept `null` on PATCH. Phone numbers are not format-parsed.

Profile changes are not audited by a local custom logger. No LMS-058 audit-log implementation exists in this repository; audit recording remains a dependency on LMS-058's shared mechanism.

## Ownership and security boundary

Employee queries use membership persistence directly. Detail, update, and deactivation predicates include both `id: employeeId` and `organizationId: tenant.organizationId`; list always filters by trusted organization ID. They do not retrieve a global user by ID and then trust a separate permission check. User and membership creation is atomic. Existing `(userId, organizationId)` uniqueness and foreign keys are retained; a new `(organizationId, createdAt, id)` index supports deterministic bounded listing.

The shared LMS-008/LMS-009 membership lookup now requires `active: true`. Deactivation therefore prevents the membership from granting authorization or resolving a tenant, while a user's other active memberships and authentication identity remain available. LMS-010 verifies this employee boundary against PostgreSQL. Enforcement is application-query scoping for this feature, not general automatic Prisma scoping; there is no RLS.

`tests/employee-management.test.ts` exercises handler behavior with an injected store. `tests/tenant-isolation-postgres.test.ts` separately runs the production Prisma employee store and handlers against PostgreSQL in CI, checks tenant A/B reads and mutations, and inspects persisted state after the attempts. Run it locally with the dedicated `TEST_DATABASE_URL` described in [Tenant Isolation](tenant-isolation.md).

## Employee CSV import (LMS-017)

OWNER and ADMIN can create up to 500 employees from one CSV through `POST /api/organizations/employees/import`. The import reuses existing employee identity and profile rules, creates only `User` plus organization-scoped `OrganizationMembership`, and sets every new membership to MEMBER and active. It is create-only, validates the whole batch, and writes atomically in a serializable PostgreSQL transaction. The CSV is request-scoped and is not retained. See [Employee CSV Import](employee-import.md) for the exact headers, limits, error codes, and tenant/security behavior.

## Out of scope

Invitation emails/tokens and password setup (LMS-014), role changes or ownership transfer, reactivation, profile pictures, additional HR fields, employee dashboard, RLS, and automatic tenant scoping for future resources.
