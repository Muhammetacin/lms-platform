# LMS Platform

A production-oriented foundation for a multi-tenant learning platform. This repository currently contains only the application shell and developer tooling; product functionality will arrive in later, separately scoped tickets.

## Requirements

- Node.js 22 or later
- pnpm 11.25.0 (Corepack can activate the version pinned in `package.json`)

## Setup

```bash
corepack enable
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Database access requires a local PostgreSQL instance and `DATABASE_URL` in the ignored `.env.local`; see [database setup](./docs/database.md). Keep real credentials in ignored environment files; never commit them.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Start the local development server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Check TypeScript without emitting files |
| `pnpm build` | Create a production build |
| `pnpm start` | Serve the production build locally |
| `pnpm db:generate` | Generate the Prisma client |
| `pnpm db:migrate:dev --name <name>` | Create and apply a local development migration |
| `pnpm db:health` | Check local database connectivity without printing credentials |
| `pnpm test:db-config` | Test database configuration validation |

## Project structure

```text
src/app/                 App Router layout, page, and global styles
docs/                    Product vision and architecture decisions
docs/decisions/          Architecture decision records
tickets/                 Scoped development tickets and acceptance criteria
.github/workflows/       Continuous integration
```

## Project guidance

Read [AGENT_RULES.md](./AGENT_RULES.md) before making changes. The product direction is in [docs/00-product-vision.md](./docs/00-product-vision.md); decisions are recorded in [ADR-001](./docs/decisions/ADR-001-foundation.md) and [ADR-002](./docs/decisions/ADR-002-database-foundation.md). Database setup and tenant conventions are in [docs/database.md](./docs/database.md). Milestones are tracked in [LMS-001](./tickets/LMS-001.md) and [LMS-002](./tickets/LMS-002.md).
