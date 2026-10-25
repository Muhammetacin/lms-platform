# Product Vision

## Purpose

Build a dependable learning management SaaS that helps organizations deliver and manage learning through a clear, welcoming experience for learners and the people who support them.

## Product direction

The platform is intended to grow into a multi-tenant service. Its architecture should keep organizational boundaries explicit, support reliable operations, and make future product capabilities easy to evolve. LMS-007 establishes authentication and user identity. LMS-008 establishes organization-scoped authorization. LMS-009 establishes trusted tenant context. LMS-010 establishes application-layer tenant isolation for LMS-012 employee management, verified against PostgreSQL in CI; future tenant-owned resources still require their own scoped implementation and database-backed tests.

## Principles

1. **Learner-centered:** make learning understandable and approachable.
2. **Organization-aware:** support distinct organizations with clear data boundaries as the product evolves.
3. **Secure by design:** protect data and secrets through deliberate defaults and reviewable changes.
4. **Incremental delivery:** implement product capabilities through scoped tickets with verifiable acceptance criteria.
5. **Operational quality:** maintain type safety, automated checks, and clear project documentation.

## Course Epic delivery gate

The Course Epic is delivered vertically through LMS-084 Admin Portal Foundation, LMS-085 Course Management UI, LMS-086 Course Builder UI, and LMS-087 Course Epic E2E & Local Acceptance. The required path is:

```text
Database → Backend/API → Frontend/UI → Integration/E2E → Local acceptance → Epic DONE
```

LMS-087 supplies real-browser acceptance through the running Next.js application and production APIs, plus a separate Windows local acceptance checklist for the CEO. CI and code completion are necessary but do not record business acceptance. The epic remains **ACCEPTANCE PENDING** until the CEO explicitly accepts the final reviewed commit in that checklist. See [LMS-087](../tickets/LMS-087.md) and the [local Course Epic acceptance guide](course-epic-local-acceptance.md).

## Post-MVP frontend review

After all core MVP epics are complete, conduct a company-wide frontend review across Admin, Learner, Quiz, employee management, reporting, responsive behavior, visual consistency, and accessibility. This review is a future milestone and is not part of LMS-089 or the Course Builder interim UX work.

## Initial technical direction

The web application uses Next.js App Router and TypeScript, with pnpm for package management and ESLint for static analysis. GitHub Actions validates changes. PostgreSQL and Prisma provide persistence; LMS-010 establishes application-layer isolation for employee management, while future tenant-owned resources remain separately scoped.

## Out of scope for LMS-001

Authentication, database setup, users, organizations, courses, quizzes, dashboards, LMS APIs, and tenant logic were explicitly deferred from LMS-001. Authentication is now scoped to [LMS-007](../tickets/LMS-007.md), with authorization in [LMS-008](../tickets/LMS-008.md). See [LMS-001](../tickets/LMS-001.md) for that ticket's full scope and acceptance criteria.
