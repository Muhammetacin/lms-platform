# Tenant Context

LMS-009 establishes a trusted server-side answer to the question: which organization is an authenticated user currently operating in? A `TenantContext` contains only the authenticated `userId`, the verified `organizationId`, and the role stored on that user's membership in the selected organization.

## Server-side API

`src/lib/tenant-context.ts` is server-only and provides:

- `getTenantContext(organizationCandidate?)` returns a trusted context or `null` when there is no authenticated user. Authentication or membership storage failures raise a stable `TenantContextError`.
- `requireTenantContext(organizationCandidate?)` returns a trusted context or raises `TenantContextError`, including `unauthenticated` when there is no signed-in user. Use this in server-side operations that require an active organization.
- `resolveTenantContext(user, organizationCandidate, store)` is the database-independent resolver used by the server API and focused behavioral tests. Application code should use the server-only API, not construct a store or identity itself.

The returned role comes from the server-side active `OrganizationMembership` row. A role attached to a request or identity object is ignored. The membership store is shared with LMS-008 authorization; this layer does not create another membership model or policy. Since LMS-012, inactive memberships are excluded from both explicit lookup and default selection, so organization-specific employee deactivation also revokes that membership's tenant context. It does not invalidate the global authentication session or affect the user's other active organizations.

## Selecting the active organization

The caller may omit an organization candidate. In that case the server selects the user's first membership ordered by `createdAt` ascending, with `organizationId` ascending as a deterministic tie-breaker. A user with one membership therefore gets that organization; users with multiple memberships get the same default for the same membership data.

A caller may explicitly request an organization by passing its ID to `getTenantContext()` or `requireTenantContext()`. That value is only an untrusted candidate. The server validates its UUID format and verifies the exact `(authenticated userId, organizationId)` membership before returning context. If the candidate is malformed or the user is not a member, the resolver returns `invalid_organization_context`; it never falls back to the default organization. `undefined` means no explicit selection; `null` is invalid.

No organization ID is persisted in a browser cookie, session claim, or other client-controlled storage. There is no organization-switching UI or request parameter wired into a product route in LMS-009. A future caller that reads an ID from a header, URL, or form must pass it as this untrusted candidate and still use the verified context server-side.

## Failures

`TenantContextError` has stable codes and status values:

| Code | Status | Meaning |
| --- | ---: | --- |
| `unauthenticated` | 401 | No authenticated identity is available to a required lookup. |
| `no_organization_membership` | 403 | The authenticated user has no default membership. |
| `invalid_organization_context` | 403 | The explicit candidate is malformed or has no matching membership. |
| `tenant_context_unavailable` | 503 | Authentication or membership storage failed, or stored membership data is invalid. |

Database exception details are not included. An explicit invalid candidate and a valid organization belonging to somebody else have the same error, so this lookup does not reveal organization existence. `getTenantContext()` returns `null` only for an unauthenticated user; `requireTenantContext()` turns that into the stable `unauthenticated` error.

## Security and responsibility boundaries

- **LMS-007 Authentication** establishes identity by validating the existing server-managed session. Tenant context does not read cookies or validate sessions itself.
- **LMS-008 Authorization** determines whether the user may perform an operation in a supplied organization. Tenant context uses its shared membership storage to identify and validate the active organization but does not make permission decisions.
- **LMS-009 Tenant Context** selects an organization for the authenticated user and returns the verified membership role.
- **LMS-010 Tenant Isolation** must scope and protect tenant-owned data access. A trusted context alone does not filter queries or prevent cross-tenant reads and writes.

All failures are closed: without a valid authenticated identity, membership, and server-stored role, no context is returned. The context remains in server-side application code and contains no organization profile data or credentials. It is not a substitute for authorization checks or tenant-isolation controls.

## Tests

`pnpm test:tenant-context` covers unauthenticated and membership-free users, single and multiple memberships, explicit selection, membership-specific roles, client role claims, forged and malformed candidates, no fallback, deterministic default selection, and generic database failures.
