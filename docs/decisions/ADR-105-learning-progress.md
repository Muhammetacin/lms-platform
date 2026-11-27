# ADR-105 — Learning progress

An active member can explicitly complete a non-quiz lesson in a published course assigned directly or through a team. Each lesson and organization membership pair has at most one completion. Composite foreign keys keep both sides in the same organization. The server resolves eligibility and identity from the authenticated organization context.

A quiz lesson is complete once the learner has a saved quiz attempt. The score and number of attempts do not affect completion. Existing attempts count automatically. A course is complete when it has at least one lesson and every lesson is complete. A course with no completed lessons is not started. Other courses are in progress.

Revocation removes the course from the learner portal and removes the learner from that course's administrator view when their last assignment path is lost. Reassignment restores access to recorded progress. Progress reads include active learner memberships and currently assigned published courses only. Administrators with organization report permission see completion counts for the current assignees in their organization.
