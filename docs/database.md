# Database conventions

The database is PostgreSQL, accessed with Prisma ORM 7 and the PostgreSQL driver adapter. The foundation contains `User`, `Organization`, and `OrganizationMembership`; LMS-007 adds the authentication-only `PasswordCredential` and `Session` models. These conventions describe how to extend that foundation; they do not add authorization or provide tenant isolation.

## Local setup and configuration

1. Start a local PostgreSQL server and create a development database plus a least-privilege local role.
2. Copy `.env.example` to ignored `.env.local` and set a local `DATABASE_URL`. Keep real URLs in ignored local files or a managed secret store, never in source control or logs. Never use a `NEXT_PUBLIC_` database variable.
3. Run `pnpm install`, `pnpm db:generate`, then `pnpm db:migrate:dev --name <descriptive_name>` to apply migrations locally. Run `pnpm db:health` to check connectivity; it emits only a generic result.

Use a dedicated database and least-privilege role in each environment. Runtime production credentials must not be administrative or superuser credentials; use separately managed migration credentials when production deployment is introduced. Rotate credentials through the secret store if exposed. `prisma.config.ts` loads ignored `.env*` files for Prisma CLI commands. Keep Prisma access server-side and secrets out of Client Component bundles and responses.

## Schema and naming

- Prisma models use singular `PascalCase` names. Fields use singular `camelCase`; relation fields use the related model name in `camelCase` (`user`) or a plural for a collection (`memberships`). Foreign-key scalar fields use `<relation>Id` (`organizationId`).
- Enums use singular `PascalCase` names and stable `UPPER_SNAKE_CASE` values. Use an enum for a small, closed set enforced by the database; use validated data for values expected to be user-defined or frequently extended.
- Keep Prisma model, field, and enum names as the PostgreSQL table, column, and enum names. Use `@map` or `@@map` only for a real external/legacy naming requirement and document that mapping.
- Let Prisma derive constraint and index names from the model and fields. For exceptional explicit names, use descriptive `<Model>_<fields>_<purpose>` names and keep them within PostgreSQL's identifier limit.
- Do not rename established schema objects for style alone. A rename is a migration and must preserve existing data.

## IDs and timestamps

- Every entity has a UUID primary key: `String @id @default(uuid()) @db.Uuid`. `uuid()` is the existing Prisma-generated UUID default; PostgreSQL stores it as `UUID`. Do not add another ID strategy or generate a new ID in application code when Prisma already supplies it.
- Foreign keys use the same scalar type as the referenced primary key, have no independent default, and reference the primary key explicitly.
- Persistent models have required `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` fields. `createdAt` is assigned on insert; Prisma refreshes `updatedAt` on Prisma writes. Raw SQL and external writers must maintain `updatedAt` themselves.
- Treat timestamps as UTC instants at application boundaries; convert to/from a user's timezone only for display. The LMS-002 migration currently uses PostgreSQL `TIMESTAMP(3)` without timezone on these fields. The database column does not retain an offset, so direct SQL/import writers and database sessions using `now()` must use UTC. Do not imply that the current column type enforces timezone correctness. Changing the storage type requires a reviewed migration and a documented data-conversion plan.

## Required, nullable, and enum fields

- Persist a field as required unless absence is a meaningful, valid domain state. Use a Prisma default for a genuine system default; do not use `null`, empty strings, or sentinel values in place of a required value.
- Use `?` only when a record can validly exist without that value. Validate required request input before writing. A nullable database field is not a substitute for an optional API input type or an unvalidated workflow.
- Prefer enums for small sets whose values are controlled by the application and whose invalid values must be rejected by PostgreSQL. Use a model or validated string when values need metadata, are user-managed, or change independently of deployments. Enum changes require migrations.

## User email identity

- `User.email` is required and has a PostgreSQL unique index (`User_email_key`). The schema does not normalize the stored value, use `citext`, define an expression index, or set a case-insensitive collation. The unique index follows the configured PostgreSQL collation; case-insensitive identity is not an explicit guarantee of the current model.
- Keep the current uniqueness constraint. LMS-007 trims surrounding whitespace and matches the stored email with exact casing; it does not lowercase or otherwise canonicalize the address. This aligns lookup with the existing exact-value unique constraint. A future case-insensitive policy requires a reviewed migration and a matching database invariant; do not infer that different casing is canonicalized.

## Organization identity and responsibility

- `Organization` is the foundational organization record. It has a required UUID primary key, required `name` and `slug`, required `createdAt` and `updatedAt` timestamps, and the `memberships` relation to `OrganizationMembership`. Keep the established UUID, timestamp, unique-slug, and `createdAt` index conventions.
- `Organization.slug` is stored as required PostgreSQL `TEXT` and protected by the unique index `Organization_slug_key`. The schema does not generate or normalize slugs, lowercase them, use `citext`, define an expression index, or set an explicit collation. Uniqueness follows the configured PostgreSQL collation; this schema does not specify case-sensitive versus case-insensitive slug semantics or canonicalization. If application behavior needs canonical slug normalization, make that decision in a future ticket.
- `OrganizationMembership` is the explicit association between one `User` and one `Organization`; there is no implicit many-to-many relation. This model foundation does not implement organization CRUD, membership management, invitations, authorization, or organization UI.
- LMS-009 owns trusted tenant-context behavior. LMS-010 owns tenant-isolation design and enforcement. An organization record or foreign key alone does not provide tenant context, access control, or tenant isolation.

## Organization Membership

`OrganizationMembership` represents a user's association with an organization. It is an explicit relation with required `userId` and `organizationId` UUID foreign keys and required `user` and `organization` relations. The database unique constraint on `(userId, organizationId)` prevents duplicate memberships for the same user and organization. `User.memberships` and `Organization.memberships` expose the two sides of this relation; the schema does not use an implicit many-to-many relation.

`role` is stored on the membership because it describes the user's structural relationship to that organization, not a global property of the `User`. The current `OrganizationRole` enum contains `OWNER`, `ADMIN`, and `MEMBER`, with `MEMBER` as the database default. These are stored values only: this model does not define a permission matrix or enforce authorization.

Both foreign keys use `ON DELETE CASCADE` and `ON UPDATE CASCADE`, matching the LMS-002 foundation migration. Deleting a user or organization therefore deletes its dependent membership rows; membership rows cannot refer to missing parents. The unique `(userId, organizationId)` index also supports lookup by its leading `userId` column, while the `(organizationId, role)` index supports membership queries filtered by organization and role. No separate index is needed for `organizationId` alone because it is the leading column of that compound index.

Responsibility boundaries: LMS-007 owns Authentication; LMS-008 owns Authorization; LMS-009 owns Tenant Context; LMS-010 owns Tenant Isolation; LMS-012 owns Employee Management; LMS-014 owns Employee Invitations. `OrganizationMembership` provides only the persistence relationship and structural role value. None of those workflows or enforcement behaviors is implemented by this model documentation.

## Authentication persistence

`PasswordCredential` stores one versioned password hash per user, separate from profile and membership data. `Session` stores only a digest of the random cookie token and an explicit expiry; its indexed expiry supports future cleanup. Both records cascade when their user is deleted. Authentication semantics and credential/session handling are documented in [Authentication](authentication.md). These records establish identity only; the membership role is not consulted for authentication.

## Relations, foreign keys, and deletes

- Give each relation a clear singular or plural field name. Declare both Prisma relation fields and the scalar FK on the owning side. Required relations use a non-null FK; make both the FK and relation optional only when the child can validly outlive or exist without the parent.
- Define `onDelete` deliberately. Use `Cascade` only when child rows have no independent meaning without their parent; use `Restrict`/`NoAction` when deletion must be blocked; use `SetNull` only for an optional FK. IDs are stable, so do not change referenced IDs; retain the established `onUpdate: Cascade` behavior unless a migration decision says otherwise.
- The foundation has required `OrganizationMembership.user` and `.organization` relations, each with `onDelete: Cascade` and `onUpdate: Cascade`. A membership is unique per `(userId, organizationId)`. Preserve these relationships and invariants.
- A foreign key proves referential integrity only. It does not authorize access or isolate tenants.

## Uniqueness and indexes

- Put durable invariants in PostgreSQL with `@unique`, `@@unique`, primary keys, or foreign keys; application pre-checks alone cannot protect against concurrent writes. Translate a database conflict into a useful validation/conflict response.
- Decide whether a string invariant is case-sensitive. Existing PostgreSQL unique indexes compare the stored value using the column's normal equality semantics. If an identifier is meant to be case-insensitive, canonicalize it consistently before writes and choose a database constraint/index that protects that invariant; do not assume `@unique` folds case.
- Add an index for a real lookup, filter, sort, join, or delete workload. Consider FK access paths: an existing unique composite index covers queries by its leading field, while a different FK may need its own index. Add compound indexes in the order queries filter/sort, and avoid speculative indexes or indexes duplicating a primary/unique constraint.
- Existing examples: `User.email` and `Organization.slug` are unique; `(userId, organizationId)` is unique; `(organizationId, role)` supports membership lookup by organization and role. The `createdAt` indexes reflect ordered time access in the foundation. Revisit an index only with a query/workload reason and migration.

## Prisma client and database access

- Database access is server-side. Import the shared `db` from `src/lib/db.ts` only in server code. That module imports `server-only` and owns the single Prisma client, including the development global reuse pattern.
- Do not instantiate `PrismaClient` elsewhere, import the client from a Client Component, expose credentials, or return database error details. Use `DATABASE_URL` only on the server; never define `NEXT_PUBLIC_DATABASE_URL` or another public-prefixed database setting. Do not add a public connectivity endpoint.
- Keep queries near the server-side operation that needs them. Do not add a generic repository layer without a concrete reuse or consistency need. Validate and authorize inputs at the application boundary before mutation; database constraints remain the final invariant check.

## Queries and pagination

- Select only the fields needed by the operation or response (`select`); avoid broad `include`/whole-record reads and unnecessary relation loading. Load relations only when the caller needs them.
- Build filters from validated, allowlisted inputs. Parameterize any raw SQL; never interpolate user input into SQL text. Keep database access on the server and return only the data needed by the caller.
- Sort explicitly whenever order matters. List endpoints use a default page size of 25 and a maximum of 100, validate page-size inputs, and apply a deterministic order with a unique tie-breaker such as `id`.
- Prefer cursor pagination for large or changing result sets when a stable unique cursor is available. Offset pagination is acceptable for small, bounded lists or a product requirement for page-number navigation. Define supported filters and sort keys per endpoint; do not add pagination behavior to this foundation ticket.

## Transactions and error handling

- Use a Prisma transaction when multiple writes must commit or roll back together, when related writes maintain one invariant, or when partial completion would leave invalid state. Use a batch transaction for known independent operations; use an interactive transaction only when later writes depend on earlier results.
- Keep transactions short and limited to database work. Do not include network calls, user interaction, or slow unrelated work inside one. Do not wrap a single independent query in a transaction by default. Prefer a database constraint plus conflict handling for uniqueness races rather than check-then-insert alone.
- Validate input before querying. Handle expected outcomes at the operation boundary: not found, unique conflict (Prisma `P2002`), foreign-key violation (`P2003`), and stale/missing mutation target (for example `P2025`) should map to the existing application response pattern. Do not convert every database error into “not found” or success.
- Unexpected database failures should follow the server's error path and be logged only with safe operational context. Never return or log `DATABASE_URL`, credentials, SQL parameters containing sensitive data, raw connection details, or an unfiltered database exception to a client. Preserve unexpected failures for monitoring rather than hiding them behind a generic success response.

## Migrations

- Change `prisma/schema.prisma` through Prisma Migrate. Generate a descriptive lowercase `snake_case` migration name, review the generated SQL, and commit the schema and migration together. Never use `prisma db push` as the normal schema-change workflow.
- Treat every committed/applied migration as immutable. Correct a mistake with a new forward migration; do not edit migration SQL that has been applied in a shared environment.
- Review every production migration before deployment. Review destructive operations explicitly for data loss, locking, rollout order, backup/restore needs, and compatibility with deployed code. Do not make manual production schema edits as a normal workflow.
- Keep the Prisma schema and ordered migration history synchronized. Validate the schema and migration diff in CI/review; investigate drift instead of silently editing a live database. Prisma 7 CLI configuration and local commands are in `prisma.config.ts`.

## Seeds and tests

- Seed data is for local development and isolated tests only. Use synthetic data, deterministic fixtures, and idempotent upserts where repeat runs are useful. Never include customer data, real credentials, production secrets, or hardcoded production accounts. Production reference data, if ever needed, requires a separately reviewed deployment decision.
- Database-related tests should use an isolated disposable database when integration is needed and apply committed migrations. Test relevant FK behavior, unique constraints, relationships, transaction rollback/atomicity, and database error mapping. Keep pure validation/configuration checks runnable without PostgreSQL. Never point tests at production data.
- Add authorization and tenant-boundary database tests when those features are implemented; this ticket does not add tenant isolation tests.

## Future tenant context and isolation

Future tenant-owned entities must have an explicit organization/tenant relationship where the domain requires one, and their reads and writes must be scoped using trusted server-side tenant context derived from the authenticated identity and validated membership. A tenant ID from a browser, URL, or other client input is untrusted and cannot establish that context. LMS-009 owns tenant-context behavior; LMS-010 owns tenant-isolation design and enforcement. Organization foreign keys alone do not provide tenant isolation, and neither LMS-002 nor LMS-003 claims it.

## Local database commands

| Command | Purpose |
| --- | --- |
| `pnpm db:generate` | Generate Prisma Client from the schema |
| `pnpm db:validate` | Validate the Prisma schema; also runs in CI |
| `pnpm db:migrate:dev --name <descriptive_name>` | Create and apply a local development migration |
| `pnpm db:health` | Run the server-side connectivity check |
| `pnpm test:db-config` | Test database URL validation |

Local setup and safe environment configuration are in the repository README. Prisma 7 reads migration configuration from `prisma.config.ts`; schema validation and client generation do not require a running database.
