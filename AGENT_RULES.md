# Repository Working Rules

## Product scope

- Deliver only the scope named in the active ticket. Do not implement future ticket work preemptively.
- LMS-001 is a project foundation only. It must not add authentication, persistence, users, organizations, courses, quizzes, dashboards, LMS APIs, or tenant logic.
- Do not add secrets, credentials, or real environment values to tracked files. Keep `.env.example` limited to safe placeholders and documented variable names.
- Do not silently change the product requirements or the selected technology stack. Record material architecture changes in a new ADR.

## Engineering conventions

- Use TypeScript and Next.js App Router for application code.
- Keep the initial app shell small and accessible. Avoid adding dependencies without a clear need.
- Keep dependency versions and the pnpm lockfile aligned. CI must install with the committed lockfile.
- Run the ticket's required lint, typecheck, and build checks before committing.
- Keep commits focused on the active ticket and use the ticket ID in the commit subject.
- Update documentation when a change alters setup, architecture, or project scope.
