# ADR-001: Establish the LMS Platform Foundation

- **Status:** Accepted
- **Date:** 2026-09-28
- **Ticket:** LMS-001

## Context

The LMS Platform repository is empty. Before product capabilities can be delivered, the project needs a consistent web application structure, developer commands, CI validation, and written scope boundaries. Product requirements specify Next.js, TypeScript, App Router, pnpm, and ESLint. PostgreSQL is planned later.

## Decision

- Use Next.js App Router with TypeScript for the web application.
- Use pnpm with a pinned package-manager version and committed lockfile.
- Use ESLint for linting and TypeScript's compiler for typechecking.
- Use GitHub Actions to run dependency installation, lint, typecheck, and a production build.
- Keep environment examples safe and exclude local environment files from version control.
- Keep LMS product capabilities outside the initial foundation milestone.

## Consequences

Contributors get one standard set of local commands and automated checks. The app can be started and built without external services. Future tickets can add database and product concerns as separately reviewed decisions, without implying that those capabilities exist today.

## Alternatives considered

- **Introduce product infrastructure immediately:** rejected because the first ticket explicitly excludes authentication, persistence, tenant logic, and LMS features.
- **Use a different web framework or package manager:** rejected because the required stack is specified by the product requirements.
