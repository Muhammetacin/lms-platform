# MVP Backlog

This document is the central planning view for the remaining functional MVP and the parallel business-readiness work. It was prepared on 2026-10-25 after reviewing the 30 ticket files in this repository (`LMS-001`–`LMS-024` and `LMS-084`–`LMS-089`) and the [Product Vision](00-product-vision.md).

The detailed scope and implementation history stay in the ticket files. This backlog records epic order, current epic status, dependencies, next actions, and the evidence required to accept each epic.

## Epic status flow

Use these statuses in this order:

`PLANNED → IN PROGRESS → QA → CEO ACCEPTANCE → DONE`

| Status | Meaning |
| --- | --- |
| `PLANNED` | Scope and dependencies are known; implementation has not started. |
| `IN PROGRESS` | The epic is being implemented against its agreed scope. |
| `QA` | Implementation is complete and is undergoing the required functional, regression, and security review. |
| `CEO ACCEPTANCE` | Required QA has passed; formal business acceptance is waiting to be recorded. |
| `DONE` | Acceptance criteria and required sign-off are recorded. |

An epic moves to `DONE` only after its acceptance record exists. Ticket-level states such as “CODE COMPLETE” do not replace these epic statuses.

## MVP delivery order

The Course Epic is a current acceptance gate. LMS-090 is the next feature priority; it follows the Course Epic's existing implementation and does not reopen that scope. The business-readiness track runs alongside the feature sequence.

| Priority | Epic | Current status | Dependencies | Next action | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| Gate, parallel closeout | Course Epic: course authoring and publishing (`LMS-018`–`LMS-024`, `LMS-084`–`LMS-089`) | `CEO ACCEPTANCE` | Reviewed Course Epic commit; LMS-087 browser/local acceptance path; CEO walkthrough | Complete the LMS-087 local walkthrough and the ticket-specific LMS-088/089 UX checks against the exact reviewed commit; record the CEO's formal decision in the acceptance record. | CEO decision is recorded against the reviewed commit; the LMS-087 course creation, modules/lessons, preview, and publishing checklist and the LMS-088/089 UX checks are complete; remaining acceptance defects are resolved or explicitly recorded; epic status changes to `DONE` only after sign-off. |
| P1 — next | Employee Management UI (`LMS-090`) | `PLANNED` | Admin Portal foundation (`LMS-084`); employee, profile, invitation, and import capabilities (`LMS-012`–`LMS-014`, `LMS-017`); authentication, authorization, and tenant context (`LMS-007`–`LMS-010`). Real invitation sending depends on LMS-052. | Define the employee screens and interaction states against the existing APIs, including how unavailable email delivery is shown until LMS-052 is ready. | Authorized OWNER/ADMIN users can find, view, add, edit profile details, deactivate, and import employees using the existing tenant-scoped APIs; permissions and tenant boundaries are respected; validation, empty, loading, success, and failure states are clear; invitation delivery is never shown as successful before the real adapter works; responsive and accessibility checks pass. |
| P2 | Team Management UI | `PLANNED` | LMS-015 Team API and LMS-016 Team Membership; employee identities from LMS-012/017; complete the Employee Management UI sequence first; audit events use the shared LMS-058 mechanism. | Define the Team list, create/edit/delete, and membership management flows using the existing Team and membership APIs. | OWNER/ADMIN users can manage organization-owned Teams and add/remove organization employees; tenant and role checks are enforced; empty, validation, pending, and error states are handled; no Team assignment, hierarchy, or permissions are implied beyond existing APIs; mutations are covered by the shared audit mechanism when LMS-058 is available. |
| P3 | Email delivery (`LMS-052`) | `PLANNED` | LMS-014's invitation delivery boundary and activation flow; approved provider/configuration and secret handling. | Confirm the provider, delivery contract, operational ownership, and invitation templates, then implement the real adapter under the existing LMS-052 reference. | Eligible invitations are delivered through a real provider; failures are returned and observable without claiming success or exposing invitation tokens; templates and links support the existing one-time, expiring activation flow; secrets stay out of source and logs; delivery behavior is verified in QA. |
| P4 | Learner Portal | `PLANNED` | Authentication and account activation (`LMS-007`, `LMS-014`, with delivery enabled by LMS-052); published Course content and safe rendering (`LMS-023`–`LMS-024`); Employee and Team foundations. Course access must follow the assignment rules delivered in P5. | Establish the authenticated learner shell and navigation, then define the learner-facing course experience against published course content. | Active learners can reach a learner-focused portal without admin access; only published, authorized learning content is shown; the portal handles the no-assignment state; learner routes do not expose admin controls or cross-tenant data; keyboard, responsive, and accessibility behavior passes QA. |
| P5 | Course assignments | `PLANNED` | Learner Portal shell (P4); published Courses; active employee memberships; Team and Team Membership APIs/UI (LMS-015/016 and P2). | Define how an administrator assigns a published Course to an employee or Team and how those assignments grant learner access. | Authorized administrators can create, inspect, change, and revoke individual and Team assignments; learners see only courses assigned to them through an active organization membership; tenant boundaries and role checks are enforced; duplicate and conflicting assignments have defined outcomes; assignment changes are observable through LMS-058 when available. |
| P6 | Quiz Builder (`LMS-025`) | `PLANNED` | Course Builder and the existing `QUIZ` Lesson Type reservation; Course publishing rules; learner-side quiz delivery in the portal. | Continue the Quiz work under the existing LMS-025 roadmap reference; do not create a replacement Quiz ticket. | Authorized authors can configure and edit the agreed MVP quiz types and attach them to a Course; validation and published-course behavior are defined; learners can complete an assigned quiz through the portal; attempts and results are persisted and protected by tenant and learner authorization; required QA covers authoring and learner flows. |
| P7 | Learning progress | `PLANNED` | Course assignments (P5); Learner Portal (P4); Quiz Builder and results (P6) for quiz-bearing Courses. | Agree on the MVP completion and progress rules for Lessons, Courses, and quizzes, then implement the learner and administrator views. | Progress is derived from persisted learner activity and the agreed completion rules; learners can see their own status; authorized administrators can see organization-scoped status; repeat attempts, incomplete work, and revoked access have defined behavior; progress cannot be changed by forging another learner's identity or tenant. |
| P8 | Reporting | `PLANNED` | Employee and Team management; course assignments, quiz outcomes, and progress (P5–P7); shared audit/reporting boundaries (`LMS-058`) where applicable. | Agree on the MVP questions and report fields, then build organization-scoped reports from accepted source data. | Reports answer the agreed MVP questions for Courses, learners, Teams, assignments, and progress; filters and totals use the same tenant and authorization rules as source data; empty and large-result behavior is defined; exports, if included in scope, contain only authorized fields; results are checked against source records. |
| P9 | MVP release | `PLANNED` | All functional MVP epics above; Course Epic formal acceptance; email delivery (`LMS-052`); shared audit (`LMS-058`) and rate limiting (`LMS-060`) release gates; operational and pilot readiness. | Prepare a release checklist with exact-head CI, browser acceptance, data backup/recovery, support ownership, monitoring, and pilot rollout steps. | Required CI and browser checks pass on the release commit; critical security and tenant-isolation checks pass; login brute-force protection is in place under LMS-060 before public production exposure; required audit events use LMS-058; invitation delivery works; the CEO records MVP acceptance and a named pilot cohort can be onboarded with support and rollback steps. |

## Parallel release gates and roadmap references

These identifiers are existing roadmap references and remain part of the plan:

- **LMS-025 — Quiz:** the Quiz Builder epic at P6.
- **LMS-052 — Email delivery:** the real invitation email integration at P3.
- **LMS-058 — Audit:** the shared audit mechanism used by employee, Team, invitation, assignment, and other sensitive mutations; it is a release dependency where required events are in scope.
- **LMS-060 — Rate limiting:** shared brute-force protection required before public production exposure of login, as recorded in the authentication documentation.

Do not create duplicate tickets for these roadmap items. This planning document does not create or change product APIs, database models, or ticket scope.

| Priority | Epic | Current status | Dependencies | Next action | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| Parallel release gate | Shared audit (`LMS-058`) | `PLANNED` | Existing employee, invitation, Team, and future assignment mutation boundaries; approved event and retention requirements. | Confirm the MVP audit-event list and implement it through the existing LMS-058 roadmap item. | Required sensitive MVP actions record actor, organization, action, target, and timestamp using the shared mechanism; audit data is tenant-protected and does not contain secrets or invitation tokens; required events can be verified before release. |
| Parallel release gate | Shared rate limiting (`LMS-060`) | `PLANNED` | Authentication routes and a deployment-aware shared limiter with a trusted client identity contract. | Confirm deployment and trusted-proxy assumptions, then complete LMS-060 before public production login exposure. | Login brute-force attempts are limited across application instances using the reviewed identity contract; limits and failure behavior are documented and tested; credentials and sensitive request data are not logged. |

## Parallel business readiness

| Priority | Epic | Current status | Dependencies | Next action | Acceptance criteria |
| --- | --- | --- | --- | --- | --- |
| Parallel with P1 onward | Pilot customers, pricing model, and commercial preparation | `PLANNED` | Product Vision and a demoable Course/Admin path; CEO/business-owner decisions; security and operational readiness for the chosen pilot profile. | Start customer discovery in parallel with LMS-090: identify candidate pilot organizations, validate their learning-management needs, and develop a pricing hypothesis. | A documented pilot profile and candidate list exist; discovery records validated needs and success measures; pricing assumptions and packaging options are documented for a decision; onboarding, support, privacy/security, and commercial materials are ready for the selected pilot; launch/no-launch decision and responsible owners are recorded. |

This work proceeds alongside engineering and does not change the feature priority order. Pilot commitments and commercial promises must match capabilities actually accepted for the MVP.

## Post-MVP frontend review

| Epic | Current status | Dependencies | Next action | Acceptance criteria |
| --- | --- | --- | --- | --- |
| Full frontend review | `PLANNED` | Functional MVP complete and accepted, including Admin, Learner, Quiz, employee management, and reporting experiences. This review follows the functional MVP and is not a release prerequisite. | After the MVP is functionally complete, review the full product across visual consistency, responsive behavior, accessibility, and end-to-end task clarity. | Findings cover Admin, Learner, Quiz, employee management, reporting, responsive behavior, visual consistency, and accessibility; each finding has severity and an owner or explicit disposition; agreed follow-up work is prioritized separately from the completed MVP. |

## Planning rules

- Keep the functional order P1 through P9; handle the Course Epic acceptance gate and business-readiness work in parallel.
- Preserve the CEO acceptance gate for the Course Epic until the formal final acceptance is recorded.
- Keep the comprehensive frontend review after functional MVP completion.
- Before implementation starts on a planned epic, agree its detailed scope and acceptance evidence in the relevant existing roadmap ticket or a newly assigned ticket. Do not reuse an existing LMS identifier for a different scope.
