# P9 — MVP release and pilot runbook

## Current state

The public release and pilot require CEO acceptance. A source merge authorizes integration. It does not constitute a deployment, operational sign-off or pilot invitation. Store the final reviewed commit, CI run and reasons for any exclusions in the release record on the associated GitHub pull request.

| Gate | Required evidence |
|---|---|
| Exact release candidate | Git commit, green validation and browser CI, applied test migrations, and COO review. |
| Course Epic acceptance | Explicit CEO decision against the [Course Epic acceptance checklist](course-epic-local-acceptance.md). Run the same scenarios in isolated hosted staging if a local installation is unavailable. |
| Invitation email | Account, verified sender domain, approved privacy settings, canonical HTTPS origin and staging-only test mailbox. Record receipt and successful one-time activation without copying an activation link. |
| Login ingress | Shared rate limit secret and verified trusted ingress contract. On staging, verify that the gateway sets exactly one client address, replaces any user-supplied version of its header and that direct origin access is blocked. |
| Audit | Confirm the proposed retention and who can access records. Verify a staging action produces an event with actor, organization, action, target and timestamp. |
| Recovery | Staging backup and successful restore rehearsal. Record measured recovery time and acceptable data loss with the operational owner. |
| Monitoring and support | Named operational owner, notification route, support contact, incident response coverage and tested alerts. |
| Pilot | Named test organization, approved participant list, one sample course, rollback owner and explicit CEO go decision. |

## Production verification in CI

[LMS-115](../tickets/LMS-115.md) runs a focused production smoke test after the development browser suite. It starts the built app behind loopback HTTPS, checks the production session cookie and logout, verifies learner and cross-organization access, and records an assignment and lesson completion. The job dumps the isolated test database and restores it into a newly created database. Counts and fingerprints confirm that nine populated tables survive the restore, including courses, progress, audit events and migration history. The temporary restore is dropped and the dump stays in the job.

The CI proxy, TLS certificate, database and accounts are fixtures. Staging acceptance still verifies the chosen provider's real ingress, backup retention, recovery time, monitoring and mailbox delivery.

## Stage and rehearse

1. Provision restricted staging with an isolated PostgreSQL database and the production-mode app behind trusted ingress. Enforce HTTPS at the public origin and set `NEXT_PUBLIC_APP_URL` to that origin. Apply [the login rate-limit configuration](decisions/ADR-060-login-rate-limiting.md). Keep production and staging secrets, databases and email settings separate.
2. Enable provider-managed encrypted PostgreSQL backups and restrict access. Create a fresh backup before any migration. Restore it to a separate isolated database and record backup and restore timestamps and recovery-point objective. Compare representative counts for organizations, users, assignments, completions and audit rows. Run the application's role and course-flow checks there before approving the recovery procedure. Retire the rehearsal database according to the environment's retention policy.
3. Apply `pnpm db:migrate:deploy` to the designated staging database, then deploy the reviewed build. Verify the database check, login, role access and tenant isolation. Verify the critical path from employee creation and activation through course assignment, quiz completion and reporting using test identities.
4. Configure Brevo per [Email Delivery Setup](email-delivery.md). Issue one invitation to the approved mailbox. Verify inbox receipt, the direct LMS activation link, successful activation and rejection of any second use. Check the provider's preview setting. Record only the result and timestamp.
5. Configure alerts for failed migrations, backup failures, unavailable endpoints/database, sustained login 503 or 429 spikes and invitation delivery failures. Verify that an alert reaches the support owner. Logs and alerts omit credentials, activation URLs and request bodies. Configure bounded cleanup of expired login buckets and approved audit retention.

## Roll out and roll back

Use a single approved organization for the pilot. Verify its administrator onboarding before inviting approved participants. Collect issues through the named support channel and use the same test flow to reproduce them with synthetic data. Pause onboarding if isolation, receipt or activation, sign-in, or progress is materially broken.

If reverting the app, stop invitations, record the incident and select the previous verified app build. The P9 migrations add tables. A rollback of only the app can leave those tables in place. If recovery from data corruption is necessary, stop writes and have the operational owner approve restoring a known-good backup to a separate database. Verify the restored database before any traffic switch and record the data-loss window. Preserve the old database for incident diagnosis under the retention policy. Restart the pilot only after the release checks are green and the CEO approves resumption.
