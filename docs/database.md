# Database setup and conventions

LMS-002 establishes PostgreSQL and Prisma as infrastructure. It does not add authentication, authorization, tenant isolation enforcement, or LMS product behavior.

## Local setup

1. Start a local PostgreSQL server and create a development database and a least-privilege application role.
2. Copy `.env.example` to `.env.local` and replace the connection URL placeholders with local values. `.env.local` is ignored by Git.
3. Run `pnpm install`, `pnpm db:generate`, then `pnpm db:migrate:dev --name foundation` to create and apply the initial migration.
4. Run `pnpm db:health` to execute a minimal `SELECT 1` connectivity check. It prints only a generic success or failure message and never prints configuration or driver errors.

For later local schema changes, update `prisma/schema.prisma` and run `pnpm db:migrate:dev --name <short_change_name>`. Review and commit the generated migration. Prisma 7 does not generate the client during `migrate dev`; use `pnpm db:generate` after schema changes. Do not use `db push` as a substitute for committed migrations.

## Configuration and secrets

`DATABASE_URL` is required for database commands and runtime access. Keep it in an ignored local environment file or a managed secret store; never put a real URL in source, logs, screenshots, or `.env.example`. `.env.example` contains only a local placeholder. Do not prefix database settings with `NEXT_PUBLIC_`: Next.js exposes those values to browser bundles.

Use a dedicated database and a least-privilege role for each environment. Local development roles should have only the rights needed for local migrations and application development. Runtime production credentials should not have administrative or superuser privileges; provision a separate migration role when deploying in a later ticket. Rotate credentials through the secret store if they are exposed.

The database connection remains server-side. Import `db` from `src/lib/db.ts` only in server code; the module is protected with `server-only`. No route handler returns the connection string or database error details.

## Schema and tenancy conventions

The LMS-002 schema contains only `User`, `Organization`, and `OrganizationMembership` as product entities. Membership is the source of truth for which organizations a user belongs to. Roles (`OWNER`, `ADMIN`, `MEMBER`) are stored as membership data; this foundation does not authenticate a user or authorize a role.

Future tenant-aware code must derive tenant context from a verified authenticated identity and its `OrganizationMembership` records, validate membership on every operation, and scope database reads and writes to that trusted context. A tenant ID submitted by a browser or other client is untrusted input and must never itself establish authorization context. LMS-010 owns the design and enforcement of tenant isolation. This ticket does not claim full tenant isolation.

IDs are UUIDs; timestamps are stored in PostgreSQL timestamps and `updatedAt` is maintained by Prisma on writes. A user can have one membership per organization. Foreign-key deletes cascade from the referenced user or organization to memberships.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm db:generate` | Generate the Prisma client from the schema |
| `pnpm db:migrate:dev --name <name>` | Create and apply a local development migration |
| `pnpm db:health` | Run a server-side database connectivity check |
| `pnpm test:db-config` | Test required database URL validation |

Prisma 7 reads the migration connection URL from `prisma.config.ts`; that file loads ignored `.env*` values for CLI commands. Builds and client generation do not require a running database.
