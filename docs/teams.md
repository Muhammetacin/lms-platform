# Teams

## Ownership and fields

A Team is a logical group owned by exactly one Organization. It contains a UUID `id`, required `organizationId` and `name`, optional `description`, and `createdAt`/`updatedAt` timestamps. Deleting an Organization cascades to its Teams. Deleting a Team is a hard delete.

Team names are unique within an organization through the PostgreSQL unique index `(organizationId, name)`. The database's existing deterministic text collation is unchanged and compares names case-sensitively; for example, `Sales` and `sales` may coexist in one organization, while a second exact `Sales` may not. Names are trimmed before storage. The database index is the final authority when concurrent requests attempt the same name. A collision returns HTTP 409 with `{ "error": "team_name_conflict" }`.

## Validation

- `name` is trimmed, required, and must contain 2–120 Unicode code points after trimming. Blank values and Unicode control characters are rejected.
- `description` is optional, trimmed, and limited to 500 Unicode code points. `null` clears it; blank strings normalize to `null`. Unicode control characters are rejected.
- Create and update accept only `name` and `description`. All other fields, including `id`, `organizationId`, `tenantId`, `ownerId`, `role`, and timestamps, are rejected.

## Authorization and tenant isolation

The API uses `requireTenantContext()` to derive its organization from the authenticated user's active membership. It never selects a tenant from request JSON, query parameters, or headers. OWNER and ADMIN have the existing `MANAGE_TEAMS` capability; all organization members have the existing `VIEW_ORGANIZATION` capability and may list or view Teams.

The production Prisma Team store receives the trusted `organizationId` on every operation. List queries filter by organization in PostgreSQL. Detail, update, and delete predicates include both the Team ID and organization ID. A Team in another organization produces the same `team_not_found` 404 as a missing ID.

## Team membership

`TeamMembership` is an explicit many-to-many link from a Team to an `OrganizationMembership`. An employee is identified by the tenant-specific membership row, never by the global `User`. Employees may belong to zero or more Teams; Teams may have zero or more employees. A link carries no Team-specific role, status, permissions, manager, or primary-Team designation.

The database unique key `(teamId, membershipId)` prevents duplicate links, including concurrent inserts. `Team` and `OrganizationMembership` each expose a unique `(id, organizationId)` key. `TeamMembership` references both using composite foreign keys `(teamId, organizationId)` and `(membershipId, organizationId)`, plus a direct organization foreign key. PostgreSQL therefore rejects mismatched tenant tuples even if a caller bypasses the API or makes an application scoping mistake. The production store still scopes every query with the trusted tenant ID.

Only active employees can be newly added. Add checks active state and writes the link inside a serializable transaction. A duplicate returns HTTP 409 `{ "error": "team_membership_conflict" }`; PostgreSQL uniqueness is authoritative under races. Reads return up to 100 active employees ordered by `employeeName ASC`, then membership ID. The response includes only membership ID, email, employee name, job title, and department.

Deactivation remains owned by LMS-012. Deactivating an employee leaves existing TeamMembership rows in place, while operational member lists filter inactive employees out. A hard delete of the Team or OrganizationMembership cascades to its TeamMembership rows; organization deletion cascades as well.

## API

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/organizations/teams` | Any active organization member |
| POST | `/api/organizations/teams` | OWNER or ADMIN |
| GET | `/api/organizations/teams/:teamId` | Any active organization member |
| PATCH | `/api/organizations/teams/:teamId` | OWNER or ADMIN |
| DELETE | `/api/organizations/teams/:teamId` | OWNER or ADMIN |
| GET | `/api/organizations/teams/:teamId/members` | Any active organization member |
| POST | `/api/organizations/teams/:teamId/members` | OWNER or ADMIN |
| DELETE | `/api/organizations/teams/:teamId/members/:employeeId` | OWNER or ADMIN |

Team list results return up to 100 Teams ordered by `name ASC`, then `id ASC`. Member reads return `{ "members": [...] }`; the add body accepts only `{ "employeeId": "<OrganizationMembership.id>" }`; successful add and removal return 201 and 200 respectively. Foreign Teams and employees use safe not-found responses. Responses are private and not cached.

## Scope

LMS-016 adds Team Membership only. It does not add Team managers, hierarchy, assignments, courses, reporting, or an audit system. Team and membership mutation audit events can be handled by LMS-058 when that ticket is implemented.
