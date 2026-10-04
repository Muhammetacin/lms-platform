# Product Vision

## Purpose

Build a dependable learning management SaaS that helps organizations deliver and manage learning through a clear, welcoming experience for learners and the people who support them.

## Product direction

The platform is intended to grow into a multi-tenant service. Its architecture should keep organizational boundaries explicit, support reliable operations, and make future product capabilities easy to evolve. LMS-007 establishes authentication and user identity. LMS-008 establishes organization-scoped authorization. LMS-009 establishes trusted tenant context; tenant isolation (LMS-010) and learning-domain behavior remain separately scoped work.

## Principles

1. **Learner-centered:** make learning understandable and approachable.
2. **Organization-aware:** support distinct organizations with clear data boundaries as the product evolves.
3. **Secure by design:** protect data and secrets through deliberate defaults and reviewable changes.
4. **Incremental delivery:** implement product capabilities through scoped tickets with verifiable acceptance criteria.
5. **Operational quality:** maintain type safety, automated checks, and clear project documentation.

## Initial technical direction

The web application uses Next.js App Router and TypeScript, with pnpm for package management and ESLint for static analysis. GitHub Actions validates changes. PostgreSQL and Prisma now provide the database foundation; product behavior and tenant isolation remain separately scoped for later tickets.

## Out of scope for LMS-001

Authentication, database setup, users, organizations, courses, quizzes, dashboards, LMS APIs, and tenant logic were explicitly deferred from LMS-001. Authentication is now scoped to [LMS-007](../tickets/LMS-007.md), with authorization in [LMS-008](../tickets/LMS-008.md). See [LMS-001](../tickets/LMS-001.md) for that ticket's full scope and acceptance criteria.
