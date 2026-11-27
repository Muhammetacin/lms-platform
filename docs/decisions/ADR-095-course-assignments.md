# ADR-095 — Course Assignments

Status: Accepted for the MVP

Direct and team assignments are two explicit relations. Each row identifies one course and one target within the same organization. Composite foreign keys enforce the organization boundary. Composite primary keys make repeated grants idempotent. Revoking a grant removes that row.

Administrators grant published courses to active MEMBER memberships or to teams in their current organization. Team grants refer to the team rather than a snapshot of its members. A learner has access when their membership is active, the course is published, and a direct grant or a grant for a current team matches. Removing one grant preserves access through other current grants. Deactivation suspends access while preserving grants, so a future reactivation can restore them.

Course listings and detail reads apply the same database predicate. The existing read-only content rendering safely presents published modules and lessons. Quiz delivery and shared audit event persistence are tracked separately in LMS-025 and LMS-058.
