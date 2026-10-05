# Organization Settings

## Scope

LMS-011 adds a small organization-owned read/update boundary using the existing
`Organization` record. It exposes only `name` and `slug`; it adds no settings
table, columns, or migration. The endpoint updates the name only. Slug remains
readable but immutable through this API because the existing schema and prior
product decision leave slug normalization, case behavior, and slug update
semantics undefined. A future ticket can define those semantics and the matching
database invariant before adding slug changes.

## API

`GET /api/organizations/settings` returns:

```json
{"organization":{"name":"Example Learning","slug":"example"}}
```

`PATCH /api/organizations/settings` accepts a same-origin JSON body containing
only a `name` string. The value is trimmed and must be 2–120 Unicode code points
with no control or unpaired surrogate characters. Bodies are limited to 8 KiB.
Unknown keys, malformed JSON, wrong types, missing/empty names, and overlong
names return `400 invalid_request`. Responses are JSON and set
`Cache-Control: no-store`.

The PATCH route uses the existing LMS-007 same-origin JSON request check to
prevent cross-site cookie-authenticated writes. It accepts no organization ID
or role in the body, query, URL, or headers.

## Authentication, authorization, and tenant ownership

The ownership chain is:

```text
Authenticated user (LMS-007)
        ↓
LMS-009 requireTenantContext() with no client candidate
        ↓
LMS-008 permission check for tenant.organizationId
        ↓
Organization lookup/update filtered by tenant.organizationId
```

LMS-008's existing `VIEW_ORGANIZATION` permission allows OWNER, ADMIN, and
MEMBER to read. `MANAGE_ORGANIZATION_SETTINGS` allows OWNER and ADMIN to update;
MEMBER receives 403. Authentication errors remain 401, invalid/missing tenant
membership uses LMS-009's existing 403 semantics, and authorization/tenant
storage failures remain fail-closed 503 responses. The resource layer scopes
Organization settings to the trusted tenant. LMS-010 separately implements and
tests the employee-membership boundary; neither route establishes automatic
Prisma scoping or RLS.

## Data access and errors

Queries filter only by the server-derived tenant organization ID and select
only `name` and `slug`. Updates use an explicit `{ name }` data object, so
concurrent changes to other fields cannot be overwritten through mass
assignment. The existing unique slug constraint is untouched because this API
does not write slugs. Unexpected database failures return a stable generic 503;
raw Prisma errors and internal organization fields are not returned.

## Security and future tenant-isolation testing

The route has no arbitrary organization-ID resource path. Supplying an
`organizationId` in PATCH is rejected as an unexpected field, and URL query
parameters are never used to resolve tenant context. Tests cover the trusted
default tenant, role permissions, unauthenticated requests, tampering, strict
input validation, same-origin protection, and generic storage failures.

The LMS-010 PostgreSQL suite currently targets employee membership operations;
it does not execute this settings route against PostgreSQL. Future changes to
this route should add real-database cross-tenant tests and continue to use the
trusted tenant organization ID for every settings query. Test any later slug
update semantics and case-insensitive uniqueness at the database constraint
level if the product chooses to define them.

## Out of scope

Slug changes, organization switching, a settings dashboard, membership or
employee/team/course workflows, branding, billing, integrations, notification
settings, RLS, query middleware, and automatic scoping of other tenant-owned
resources are out of scope.
