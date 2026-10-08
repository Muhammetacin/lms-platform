# Local Admin Portal smoke test

This flow creates a local `OWNER` account using the application's existing password hashing and session implementation. It does not reset a database, create sample Courses, or use `TEST_DATABASE_URL`.

1. Start PostgreSQL and create/use a local development database named `lms_platform`.
2. Install dependencies with `pnpm install`.
3. Copy `.env.example` to the ignored `.env.local` file. Set `DATABASE_URL` for the local `lms_platform` database, keep `NEXT_PUBLIC_APP_URL=http://localhost:3000`, and set `DEV_BOOTSTRAP_EMAIL`, `DEV_BOOTSTRAP_PASSWORD`, `DEV_BOOTSTRAP_NAME`, `DEV_BOOTSTRAP_ORG_NAME`, and `DEV_BOOTSTRAP_ORG_SLUG`. Use a password with at least 12 characters. `.env.local` is not committed.
4. Apply the repository migrations with `pnpm db:migrate:deploy`. Prisma loads `.env.local` before `.env` for local commands.
5. Create the local owner setup with `pnpm dev:bootstrap`. The command prints the email and organization name, never the password. It refuses production-like environments. Re-running it preserves an existing password credential and does not duplicate the User, Organization, or membership.
6. Start the application with `pnpm dev`.
7. Open <http://localhost:3000>. The root route sends signed-out users to `/login`.
8. Sign in with `DEV_BOOTSTRAP_EMAIL` and the password set in `.env.local`.
9. Verify `/admin` shows the organization name and real Course, Draft, and Published counts. Verify `/admin/courses` lists only the active organization's Courses; an empty database shows the next-milestone empty state. Existing Courses have a Preview link to `/courses/:courseId/preview`.
10. Use **Sign out** and confirm the browser returns to `/login`. If logout fails, the page remains open and shows a generic error.

For a multi-tenant smoke check, create a second organization and owner using a separate local setup, then confirm each account sees only its own organization and Courses. PostgreSQL integration tests use the separately configured `TEST_DATABASE_URL`; the bootstrap command reads only `DATABASE_URL` and never falls back to the test database.
