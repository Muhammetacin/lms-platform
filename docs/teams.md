# Teams

## Ownership and fields

A Team is a logical group of employees owned by exactly one Organization. It contains a UUID `id`, required `organizationId` and `name`, optional `description`, and `createdAt`/`updatedAt` timestamps. Deleting an Organization cascades to its Teams. Deleting a Team is a hard delete.

Team names are unique within an organization through the PostgreSQL unique index `(organizationId, name)`. The database's existing deterministic text collation is unchanged and compares names case-sensitively; for example, `Sales` and `sales` may coexist in one organization, while a second exact `Sales` may not. Names are trimmed before storage. The database index is the final authority when concurrent requests attempt the same name. A collision returns HTTP 409 with `{ "error": "team_name_conflict" }`.

## Validation

- `name` is trimmed, required, and must contain 2–120 Unicode code points after trimming. Blank values and Unicode control characters are rejected.
- `description` is optional, trimmed, and limited to 500 Unicode code points. `null` clears it; blank strings normalize to `null`. Unicode control characters are rejected.
- Create and update accept only `name` and `description`. All other fields, including `id`, `organizationId`, `tenantId`, `ownerId`, `role`, and timestamps, are rejected.

## Authorization and tenant isolation

The API uses `requireTenantContext()` to derive its organization from the authenticated user's active membership. It never selects a tenant from request JSON, query parameters, or headers. OWNER and ADMIN have the existing `MANAGE_TEAMS` capability; all organization members have the existing `VIEW_ORGANIZATION` capability and may list or view Teams.

The production Prisma Team store receives the trusted `organizationId` on every operation. List queries filter by organization in PostgreSQL. Detail, update, and delete predicates include both the Team ID and organization ID. A Team in another organization produces the same `team_not_found` 404 as a missing ID.

## API

| Method | Path | Access |
| --- | --- | --- |
| GET | `/api/organizations/teams` | Any active organization member |
| POST | `/api/organizations/teams` | OWNER or ADMIN |
| GET | `/api/organizations/teams/:teamId` | Any active organization member |
| PATCH | `/api/organizations/teams/:teamId` | OWNER or ADMIN |
| DELETE | `/api/organizations/teams/:teamId` | OWNER or ADMIN |

List results return up to 100 Teams ordered by `name ASC`, then `id ASC`. Create returns 201, updates return the selected Team, and successful deletion returns `{ "deleted": true }`. Responses are private and not cached.

## Scope

Team Membership is intentionally deferred to LMS-016. This ticket adds no membership model, membership endpoints, employee counts, managers, assignments, courses, reporting, or audit system. Team create/update/delete audit events can be handled by LMS-058 when that ticket is implemented.
