# ADR-003: Base Database Conventions

- **Status:** Accepted
- **Date:** 2026-10-03
- **Ticket:** LMS-003

## Context

The LMS-002 foundation selected PostgreSQL, Prisma 7, UUID IDs, `createdAt`/`updatedAt`, and a server-only shared client. Before adding identity/access or product models, contributors need consistent rules for schema evolution, data access, query behavior, and future tenant context. LMS-003 must retain the approved three-model schema and must not claim tenant isolation.

## Decisions

- Preserve the established Prisma/PostgreSQL schema naming, Prisma-generated UUID primary keys, required timestamp fields, and existing `User` → `OrganizationMembership` → `Organization` constraints. Do not add a migration solely to record conventions.
- Treat application timestamps as UTC. Be explicit that current PostgreSQL `TIMESTAMP(3)` columns are timezone-naive; direct SQL/imports and database sessions using timestamp defaults must use UTC. A change to timezone-aware storage needs its own reviewed migration and conversion plan.
- Keep database access server-only through the singleton exported by `src/lib/db.ts`. Use database constraints for durable invariants, explicit indexes for known query paths, short transactions for atomic multi-write work, and safe translation of expected database errors.
- Require versioned, reviewed, immutable Prisma migrations for schema changes. Keep schema and migration history together and do not use manual production edits or `db push` as normal workflow.
- For future lists, validate an endpoint-specific filter/sort allowlist, use a 25-row default and 100-row maximum, and provide deterministic ordering with a unique tie-breaker. Prefer cursor pagination for large/changing data; use offset only for small bounded lists or a page-number requirement.
- Future tenant-owned data must have an explicit organization relationship where appropriate. Tenant context must come from authenticated server-side context and validated membership. LMS-010 owns isolation enforcement.

## Consequences

The current schema and migration remain unchanged. Contributors follow the actionable rules in [Database conventions](../database.md), which is the operational reference. Existing exact-value unique indexes do not by themselves enforce case-insensitive identity rules; future work must choose canonicalization and a matching database constraint for any such invariant. The current timestamp type also does not retain timezone offsets.

## Alternatives considered

- **Add models or a convention-only migration:** rejected because LMS-003 adds no schema requirement and must retain the LMS-002 foundation.
- **Claim isolation from organization foreign keys:** rejected because referential integrity is not authorization or tenant isolation; enforcement is scoped to LMS-010.
- **Introduce repository abstractions or speculative indexes:** rejected until a concrete query or consistency need exists.
