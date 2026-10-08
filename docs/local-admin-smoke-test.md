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
9. Verify `/admin` shows the organization name and real Course, Draft, and Published counts. Open `/admin/courses`; confirm it lists only the active organization's Courses, with textual status, update/published dates, **Manage**, and **Preview** actions. When empty, confirm the page says **No courses yet** and offers **Create course**.
10. Select **New course**, enter a title and optional description, then select **Create course**. Confirm the new DRAFT Course opens at `/admin/courses/:courseId` and displays its title, status, description, dates, Preview, settings, **Course content**, **Publishing**, and Danger zone.
11. Change the title and description and select **Save changes**. Confirm **Changes saved.** appears and the updated title is shown after the server refresh.
12. Under **Course content**, add Module A and Module B, edit a Module title/description, and move a Module up or down. Confirm the list updates after the server refresh and the first/last move buttons disable at the boundaries.
13. Add a TEXT Lesson and a VIDEO Lesson to Module A, then add a Lesson to Module B. Save multiline text and an HTTPS resource URL. Edit a Lesson title and move it up/down. Confirm content status text is visible. Change a content-bearing Lesson type and verify the warning explains that current content will be cleared; cancel once, then confirm on a disposable Lesson.
14. Open Preview and confirm `/courses/:courseId/preview` shows escaped text, the Quiz placeholder if present, and explicit resource links without embedding external resources.
15. On an incomplete draft, choose **Publish course**, confirm the action, and verify the page lists actionable completeness errors by Module/Lesson title. Complete the items and publish the complete Course. Confirm the PUBLISHED status/date appears, structure controls disappear, content summaries remain, Preview still works, and LMS-085 metadata remains editable.
16. On a separate DRAFT Course, select **Delete course**, review the permanent-deletion confirmation, then choose **Delete permanently**. Confirm the Course is removed from `/admin/courses` and dashboard counts refresh. **Cancel** must leave the Course intact.
17. Use **Sign out** and confirm the browser returns to `/login`. If logout fails, the page remains open and shows a generic error.

For a multi-tenant smoke check, create a second organization and owner using a separate local setup, then confirm each account sees and edits only its own Courses. Course management takes the tenant only from authenticated server context; no organization selector or tenant field is part of the forms. PostgreSQL integration tests use the separately configured `TEST_DATABASE_URL`; the bootstrap command reads only `DATABASE_URL` and never falls back to the test database.
