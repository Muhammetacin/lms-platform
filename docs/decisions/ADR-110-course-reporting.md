# ADR-110 — Course reporting

Organization administrators and owners can read reports for published courses with the organization report permission. Reports query PostgreSQL activity directly, with no report cache or schema change. Course and team searches match a literal case-insensitive part of the title or name.

An active member assigned directly or through a team counts once per course. The team filter further limits those assignees to current members of matching teams. The status filter limits the same cohort and totals. By default, the overview includes published courses with zero current assignees. When a team or status is selected the overview shows courses with at least one matching assignee.

An explicit completion counts for a regular lesson. A persisted attempt counts for a quiz lesson regardless of score or retry count. A course with zero completed lessons is not started. All lessons must be completed to finish a course. A quiz participant is an assignee with at least one saved attempt in that course. Per-quiz results show the most recent saved attempt by creation timestamp, with the attempt ID as a deterministic tie-breaker. The report exposes scores and totals. Selected answers stay in the quiz records.

The overview and learner detail paginate by 25 rows in a stable order. Counts are calculated in PostgreSQL for the full matching cohort. The report uses current assignments and team memberships, so a revocation changes the visible figures while previously saved activity remains available on reassignment.
