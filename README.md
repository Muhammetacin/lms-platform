# LMS Platform

A multi-tenant learning platform with a working Admin Portal and a complete Course authoring path: create and manage Courses, build ordered Modules and Lessons, preview content, and publish complete Courses. Learner delivery and Quiz configuration remain future product work.

## Requirements

- Node.js 22 or later
- pnpm 11.25.0 (Corepack can activate the version pinned in `package.json`)
- PostgreSQL for local development

## Setup

Copy `.env.example` to `.env.local`, set `DATABASE_URL` for a dedicated development database named `lms_platform`, and add local `DEV_BOOTSTRAP_*` values. Then apply migrations and provision an Owner:

```powershell
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
# Edit .env.local before continuing.
pnpm db:migrate:deploy
pnpm dev:bootstrap
pnpm db:health
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with the bootstrap email and password. Keep real credentials in ignored environment files; never commit them. See [database setup](./docs/database.md), [the browser smoke flow](./docs/local-admin-smoke-test.md), [Course Epic local acceptance](./docs/course-epic-local-acceptance.md), and the [central MVP backlog](./docs/mvp-backlog.md).

Transactional invitation email setup and safe local testing are documented in [Email Delivery Setup](./docs/email-delivery.md). Brevo credentials and a verified sender domain are required for live sends; automated tests use a mock provider.

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
| `pnpm test:e2e` | Run real Chromium acceptance against a dedicated local `lms_platform_e2e` database |
| `pnpm test:e2e:headed` | Run the same browser acceptance with a visible browser |

## Project structure

```text
src/app/                 App Router pages, API routes, and global styles
src/components/          Accessible Admin, Course Builder, and Preview UI
src/lib/                 Authentication, authorization, tenant, and Course domain logic
tests/e2e/               Real-browser Course Epic acceptance
docs/                    Product direction, setup, acceptance, and architecture
tickets/                 Scoped development tickets and acceptance criteria
.github/workflows/       Existing regression CI and browser E2E CI
```

## Project guidance

Read [AGENT_RULES.md](./AGENT_RULES.md) before making changes. The product direction and Course Epic completion gate are in [docs/00-product-vision.md](./docs/00-product-vision.md). The [central MVP backlog](./docs/mvp-backlog.md) records the remaining epic order, dependencies, acceptance criteria, and parallel commercial planning. Windows E2E setup and the CEO’s acceptance checklist are in [docs/course-epic-local-acceptance.md](./docs/course-epic-local-acceptance.md), with browser scenarios under `tests/e2e/`. The Course Epic remains **ACCEPTANCE PENDING** until the CEO explicitly signs off on the final reviewed commit.
