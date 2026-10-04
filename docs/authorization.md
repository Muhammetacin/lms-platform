# Authorization

LMS-008 establishes centralized, server-side authorization on top of the identity returned by LMS-007. Authentication answers who the current user is. Authorization checks what that user may do in one explicitly supplied organization. Tenant context and tenant isolation remain separate responsibilities.

## Architecture

`src/lib/authorization.ts` is the server-only application interface. It obtains identity through `getAuthenticatedUser()` from LMS-007 and reads membership through the shared server-only Prisma client. It does not parse cookies, inspect session tokens, or duplicate session validation. `src/lib/authorization-core.ts` contains the role hierarchy, permission mapping, and fail-closed decisions in a database-independent form.

The application interface provides:

- `requireAuthenticatedUser()` returns the authenticated identity or raises an `AuthorizationError` with status 401.
- `requireOrganizationMembership(organizationId)` requires a valid, explicit organization ID and verifies the `(userId, organizationId)` membership in PostgreSQL.
- `requireOrganizationRole(organizationId, role)` verifies membership and the minimum role from that organization's membership row.
- `requireOrganizationPermission(organizationId, permission)` enforces the initial capability mapping on the server.
- `can(organizationId, permission)` returns `false` on denial or lookup failure. Use it only to support user experience, such as hiding an unavailable control. A protected route, server action, or business operation must enforce access independently with a `require*` function.

The lookup selects only `OrganizationMembership.role` and filters by both authenticated `userId` and the requested `organizationId`. The application never accepts a role or permission from a request as proof of access. Membership records and authorization results are not exposed through a public API.

## Role hierarchy

Roles are structural roles scoped to one organization. Their hierarchy is centralized in `authorization-core.ts`:

| Required role | OWNER | ADMIN | MEMBER |
| --- | ---: | ---: | ---: |
| OWNER | ✅ | ❌ | ❌ |
| ADMIN | ✅ | ✅ | ❌ |
| MEMBER | ✅ | ✅ | ✅ |

An `OWNER` therefore satisfies all lower-level checks; an `ADMIN` satisfies admin and member checks; a `MEMBER` satisfies only member checks. The role is not a global application role, platform-admin role, permission list, or tenant-isolation mechanism. `PLATFORM_ADMIN` and other roadmap roles are not part of `OrganizationRole`.

## Initial authorization matrix

The core supports these initial decisions. It does not implement the future product features named in the matrix.

| Capability | OWNER | ADMIN | MEMBER |
| --- | ---: | ---: | ---: |
| View organization | ✅ | ✅ | ✅ |
| View own membership | ✅ | ✅ | ✅ |
| Manage organization settings | ✅ | ✅ | ❌ |
| Manage members | ✅ | ✅ | ❌ |
| Manage teams | ✅ | ✅ | ❌ |
| Manage courses | ✅ | ✅ | ❌ |
| Assign training | ✅ | ✅ | ❌ |
| View organization reports | ✅ | ✅ | ❌ |
| Manage organization ownership | ✅ | ❌ | ❌ |

"View own membership" applies only to the authenticated user's membership. This capability does not authorize viewing other people's membership records.

## Failures and enforcement

Authorization fails closed. Missing identity produces `AuthorizationError` code `unauthenticated` and status 401. Missing or invalid organization context, no membership, or an insufficient role produce the same generic `forbidden` error and status 403; the response does not disclose whether an organization exists or who belongs to it. An authorization database failure or unrecognized stored role produces `authorization_unavailable` with status 503. `can()` returns `false` for each failure. No failure path grants access.

Route Handlers should map the error's stable `status` and `code` to a generic response. Server Actions and business operations should let the `require*` check stop the operation. Place mandatory authorization close to the protected data read or mutation. UI state, hidden or disabled controls, a role supplied by the browser, and a previous `can()` result are not security enforcement.

There are no organization-scoped product routes or mutations in the current application to protect. The existing login and logout routes remain authentication endpoints; they do not access organization data. Future protected operations must call the centralized server-side checks themselves.

## Responsibility boundaries

| Ticket | Question | Responsibility |
| --- | --- | --- |
| LMS-007 Authentication | Who is the user? | Validate the existing session and return a safe identity. |
| LMS-008 Authorization | What may the user do? | Verify organization membership and structural role for an explicit organization ID. |
| LMS-009 Tenant Context | Which organization is active? | Establish trusted active-organization context from the authenticated user's verified membership. |
| LMS-010 Tenant Isolation | Can data cross organization boundaries? | Design and enforce data isolation. Not implemented here. |

LMS-008 does not establish tenant context, scope all application data, add PostgreSQL RLS, or guarantee tenant isolation. A successful membership check authorizes a role decision for the supplied organization only; LMS-010 must enforce the data boundary.
