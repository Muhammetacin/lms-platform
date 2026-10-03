# ADR-002: PostgreSQL and Prisma Database Foundation

- **Status:** Accepted
- **Date:** 2026-10-03
- **Ticket:** LMS-002

## Context

The LMS application needs a durable relational foundation for users and organization memberships. The scope requires PostgreSQL and Prisma while excluding product functionality and tenant enforcement.

## Decision

- Use PostgreSQL with Prisma ORM 7 and its PostgreSQL driver adapter (`pg`).
- Keep the connection URL in server-side `DATABASE_URL`; load it from ignored environment files locally and secret storage in deployed environments.
- Generate Prisma Client into the ignored `src/generated/prisma` directory and centralize server access in `src/lib/db.ts`.
- Keep the initial product schema to `User`, `Organization`, and `OrganizationMembership`, with UUID identifiers, timestamps, a membership role enum, foreign keys, and uniqueness/index constraints.
- Use Prisma Migrate for local schema changes and commit migration SQL alongside schema changes.
- Use a server-side CLI health check rather than an HTTP endpoint so no database connection surface is exposed publicly.
- Defer trusted tenant-context derivation and isolation enforcement to LMS-010.

## Consequences

The client uses Prisma's PostgreSQL driver adapter and must be regenerated after schema changes. Local migration commands require a PostgreSQL instance and a configured `DATABASE_URL`; typechecking and builds can run without a live database. Membership data establishes the future membership source of truth but does not authenticate users or enforce authorization.

## Alternatives considered

- **Prisma 6 with connection URLs in the schema:** rejected in favor of Prisma 7's current config-based datasource configuration and driver-adapter convention.
- **HTTP health route:** rejected because even a minimal route adds a public database connectivity surface; the local/server CLI check is sufficient for this foundation.
- **Database push without migrations:** rejected because reviewed, versioned migration history is required.
