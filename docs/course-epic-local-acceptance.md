# Course Epic — Windows E2E and local acceptance

This guide runs the complete Course Epic through the real Next.js app, browser, authentication, tenant authorization, and PostgreSQL APIs. Playwright uses the disposable `lms_platform_e2e` database. Never point it at the development database (`lms_platform`) or the existing integration-test database (`lms_platform_test`): setup and teardown reset the E2E database.

## Local prerequisites

- Windows 10/11, PowerShell, Git, Node.js 22+, and pnpm 11.25.0 (the version pinned by the repository).
- A local PostgreSQL server and a role permitted to create databases, run migrations, and write test data.
- The repository checked out at the candidate commit to be accepted.

From the repository folder:

```powershell
node --version
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm --version
pnpm install --frozen-lockfile
```

Use Node 22 or later and confirm pnpm reports `11.25.0`. To clone the repository, use these PowerShell commands; for an existing clean checkout, fetch and fast-forward the candidate branch instead:

```powershell
git clone https://github.com/Muhammetacin/lms-platform.git
Set-Location lms-platform
git switch codex/lms-087-course-epic-acceptance
git pull --ff-only
git rev-parse HEAD
```

For an existing checkout, first review `git status --short` and keep any local changes safe, then run `git fetch origin`, `git switch codex/lms-087-course-epic-acceptance`, `git pull --ff-only`, and `git rev-parse HEAD`.

Create two separate local PostgreSQL databases, `lms_platform` and `lms_platform_e2e`, owned by the local development role. You can use pgAdmin or PostgreSQL's `createdb` command. Example for a local role named `lms_app`:

```powershell
createdb -U lms_app lms_platform
createdb -U lms_app lms_platform_e2e
```

Copy the development template and set its local URL and bootstrap Owner fields. Keep the password local; do not paste it into source control or logs.

```powershell
Copy-Item .env.example .env.local
notepad .env.local
```

Set `DATABASE_URL` to the `lms_platform` database, keep `NEXT_PUBLIC_APP_URL=http://localhost:3000`, and set `DEV_BOOTSTRAP_EMAIL`, `DEV_BOOTSTRAP_PASSWORD` (at least 12 characters), `DEV_BOOTSTRAP_NAME`, `DEV_BOOTSTRAP_ORG_NAME`, and `DEV_BOOTSTRAP_ORG_SLUG`.

Prepare the separate E2E configuration:

```powershell
Copy-Item .env.e2e.example .env.e2e.local
notepad .env.e2e.local
```

Set `E2E_DATABASE_URL` to the `lms_platform_e2e` database on a loopback host (`localhost`, `127.0.0.1`, or `::1`). Keep `E2E_BASE_URL=http://127.0.0.1:3100`. Playwright rejects a non-loopback database or app URL, any database name other than `lms_platform_e2e`, and reuse of `DATABASE_URL` or `TEST_DATABASE_URL`.

Apply migrations separately to the development and E2E databases, then provision the development Owner. The first migration command reads `DATABASE_URL` from `.env.local` and targets `lms_platform`. The E2E helper reads `E2E_DATABASE_URL` from `.env.e2e.local`, validates that it is a reachable loopback PostgreSQL URL for exactly `lms_platform_e2e`, then temporarily supplies that value to Prisma as `DATABASE_URL` while running the existing migrations. It restores the prior `DATABASE_URL` even if Prisma fails. The helper uses `prisma migrate deploy`; it does not drop, truncate, or empty a database. Never use the development or integration-test database as the E2E target. `pnpm dev:bootstrap` uses the real password hashing implementation and only the development `DATABASE_URL`.

```powershell
pnpm db:validate
pnpm db:generate
# Uses DATABASE_URL from .env.local (lms_platform).
pnpm db:migrate:deploy
# Validates and migrates only E2E_DATABASE_URL from .env.e2e.local (lms_platform_e2e).
pnpm db:migrate:e2e
pnpm db:health
pnpm dev:bootstrap
```

Keep both local environment files out of source control. Do not paste database URLs or passwords into logs, issue reports, or committed files. `pnpm test:e2e` is intentionally allowed to reset synthetic fixtures only in the dedicated `lms_platform_e2e` database after its live database-name guard; it does not reset `lms_platform` or `lms_platform_test`.

## Run the browser acceptance suite

Install Chromium once, then run all twelve real-browser scenarios. The Playwright configuration starts the Next.js development server on `127.0.0.1:3100`; it does not mock production APIs. Global setup confirms the connected database name before resetting only the E2E database and seeding synthetic OWNER, ADMIN, MEMBER, and second-organization OWNER accounts. Teardown repeats the database-name guard, clears the fixtures, and removes the temporary credential file.

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

For a visible browser while diagnosing a failure:

```powershell
pnpm test:e2e:headed
```

The suite covers:

1. Login, safe invalid-credential handling, protected routes, and credentials staying out of URLs and browser storage.
2. Course creation, metadata edits, persistence, list visibility, and dashboard counts.
3. Module create/edit/reorder, move-button boundaries, and delete confirmation.
4. TEXT and VIDEO lessons, multiline content and HTTPS resource persistence, ordering, and delete confirmation.
5. The destructive Lesson-type confirmation, safe cancellation, and exactly one accepted metadata PATCH.
6. Ordered Draft Preview, escaped plain text, and explicit safe external resource links.
7. Actionable publishing errors for missing Modules, Lessons, text content, and unconfigured Quiz lessons.
8. Successful publish confirmation, published date, structure lock, retained metadata and Preview, and API guards.
9. Cancelable DRAFT Course deletion and refreshed list/dashboard state.
10. Logout and denial of subsequent Admin and previously opened Course routes.
11. OWNER/ADMIN/MEMBER access, cross-organization isolation, foreign IDs, and ignored tenant overrides.
12. 375×812 mobile layout, keyboard navigation, accessible form labels, and visible errors.

Playwright keeps an HTML report in `playwright-report/` and failure traces/screenshots in `test-results/`. CI retains the existing PostgreSQL regression job and adds a separate PostgreSQL 16 Chromium E2E job; CI uploads both artifact folders when present.

## Local Admin and Course walk-through

Use the normal development database and app port for the CEO's hands-on local acceptance. If the E2E run is still active, wait for it to finish first because Playwright owns port 3100.

```powershell
pnpm dev
```

Open <http://localhost:3000>, sign in with the `.env.local` bootstrap account, and follow the detailed [Admin Portal browser smoke flow](./local-admin-smoke-test.md). Verify the complete path: organization-scoped Course list and counts; Course create/edit; Module and Lesson authoring and ordering; TEXT and resource content; Preview safety; incomplete-publish blockers; successful publishing and read-only structure; published metadata; DRAFT delete cancel/confirm; logout; and a second-tenant boundary check.

Publishing locks Module and Lesson structure. Use a disposable Course for the successful publish scenario and a separate DRAFT Course for delete/cancel scenarios. Record reproduction steps, browser messages, and screenshots or Playwright traces for any blocker in the acceptance record below.

## CEO acceptance record

This record is intentionally unsigned. Code completion, passing tests, a merged change, or silence does not constitute CEO acceptance. The CEO reviews the exact branch commit, CI result, and local browser walk-through, records any blocking finding, and explicitly chooses ACCEPT or REJECT. Keep the Course Epic at **ACCEPTANCE PENDING** until the CEO records ACCEPT below.

### Hands-on acceptance checklist

- [ ] Application starts without errors.
- [ ] I can log in.
- [ ] The dashboard appears.
- [ ] I can create a Course.
- [ ] I can change Course metadata.
- [ ] I can add and order Modules.
- [ ] I can add and order Lessons.
- [ ] I can enter TEXT content.
- [ ] I can add an HTTPS resource.
- [ ] Preview shows the correct Course content.
- [ ] Publishing shows errors for incomplete content.
- [ ] I can publish a complete Course.
- [ ] A published Course is structurally read-only.
- [ ] I can delete a DRAFT Course.
- [ ] I can log out.
- [ ] The Admin Portal is usable on my screen.
- [ ] I approve the Course Epic functionally.

| Acceptance detail | CEO record |
| --- | --- |
| Final decision: ACCEPTED / REJECTED |  |
| CEO name and date |  |
| Repository and branch | `codex/lms-087-course-epic-acceptance` |
| Reviewed commit SHA |  |
| CI run URL and result on that exact SHA |  |
| Test date |  |
| Local OS, browser, app URL, and database migration state |  |
| Local E2E command and result |  |
| Hands-on smoke flow result |  |
| Security/tenant-isolation findings |  |
| Reproduction steps, severity, and blocker owner (if any) |  |
| Blockers |  |
| Findings |  |
| Follow-up tickets or reason for rejection |  |

CEO acceptance statement: “I reviewed the Course Epic on the commit above, completed the local acceptance flow, and ACCEPTED / REJECTED the Course Epic.”
