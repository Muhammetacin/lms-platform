# Course Publishing (LMS-023)

## Lifecycle and timestamp

LMS-023 permits exactly one lifecycle transition: `DRAFT → PUBLISHED`. It provides no unpublish endpoint and generic Course CRUD cannot write `status` or `publishedAt`. A DRAFT has `publishedAt = NULL`; the first successful publish sets it once using a server timestamp. Repeat publish returns the existing Course and timestamp without rechecking or changing content.

The `Course_status_publishedAt_check` PostgreSQL constraint enforces both sides of this invariant. The migration backfills historical PUBLISHED rows with their existing `updatedAt` before adding the constraint. It does not reset or delete Course data. Normal Course list, create, detail, update, and publish responses include `publishedAt`.

## Endpoint and access

`POST /api/organizations/courses/:courseId/publish` accepts exactly the JSON object `{}`. It uses the existing trusted same-origin JSON request check, `requireTenantContext()`, and `MANAGE_COURSES`. OWNER and ADMIN can publish; MEMBER and anonymous callers are denied. The Course is looked up and locked by both its ID and `tenant.organizationId`; malformed, missing, and foreign IDs all return `404 course_not_found`.

Every response sets `Cache-Control: no-store`. A complete Course returns `200 { "course": ... }`. An incomplete Course returns `409 { "error": "course_not_publishable", "issues": [...], "truncated": false }`. The issue list contains machine-readable codes, is generated deterministically by Course, Module position/ID, and Lesson position/ID, and is capped at 100 entries. `truncated` is true when additional issues were found. Unexpected storage failures return the safe `course_publishing_unavailable` error.

## Completeness

- A Course has at least one Module; otherwise the issue is `course_requires_module`.
- Module positions are contiguous from 1; invalid rows report `module_order_invalid` with `moduleId`.
- Every Module has at least one Lesson; otherwise `module_requires_lesson` includes `moduleId`.
- Lesson positions are contiguous from 1 within each Module; invalid rows report `lesson_order_invalid` with `moduleId` and `lessonId`.
- TEXT Lessons require valid non-blank text under `parseLessonTextContent()`; VIDEO, PDF, IMAGE, and LINK require valid non-blank HTTPS URLs under `parseLessonUrl()`. Invalid or missing content reports `lesson_content_missing` with resource IDs and Lesson type.
- QUIZ Lessons report `quiz_not_configured` until a later ticket adds the Quiz model.

Publishing never repairs ordering or writes content. URL validation checks syntax only; the server does not fetch, resolve, or probe external resources. LMS-024 owns preview and rendering.

## Locking and immutable structure

The production store starts one database transaction by selecting the Course's `status` and `publishedAt` with `SELECT ... FOR UPDATE`, scoped to the trusted organization. It holds that row lock while it reads Modules and Lessons, checks completeness, and applies the transition. LMS-020 Module mutations and LMS-022 Lesson mutations take the same Course lock, so each finishes before publication validation or sees PUBLISHED afterward. Concurrent publish requests serialize; only the first transition sets the timestamp.

Published Courses remain readable and their title/description may still be edited through LMS-019. Module and Lesson structure/content mutations remain blocked with `published_course_structure_locked`. Generic Course deletion remains blocked with `published_course_delete_forbidden`.

## Verification

`tests/course-publishing.test.ts` covers request parsing, authorization/error mapping, no-store headers, issue responses, and safe failures. `tests/course-publishing-postgres.test.ts` exercises production handlers/stores, completeness and ordering, PostgreSQL lifecycle constraints, tenant isolation, idempotency, lock races, and published mutation/deletion regressions. CI retains all previous suites and runs `test:course-publishing` plus `test:course-publishing:db`.
