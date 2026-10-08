# Lessons

**Status: LMS-021 model foundation complete; Lesson APIs and content are deferred to LMS-022.**

## Hierarchy and ownership

The hierarchy is `Organization → Course → CourseModule → Lesson`. A Lesson belongs to exactly one `CourseModule` through required `moduleId`; the Course is derived through that Module. Lesson stores no separate `courseId`. It is explicitly tenant-owned through required `organizationId`, and also has a direct Organization relation.

PostgreSQL enforces `(moduleId, organizationId) → CourseModule(id, organizationId)`. A Lesson cannot refer to a Module from another Organization, even in a direct database write that bypasses application code. `Lesson(id, organizationId)` is a composite candidate key for future progress, completion, and other tenant-owned child records.

## Model fields

| Field | Database behavior |
| --- | --- |
| `id` | UUID primary key; Prisma generates a UUID |
| `organizationId` | Required UUID; direct cascading FK to `Organization.id` |
| `moduleId` | Required UUID; composite cascading FK to `CourseModule(id, organizationId)` |
| `title` | Required text; not unique; duplicate titles are allowed |
| `type` | Required `LessonType`; no database default |
| `position` | Required one-based integer, unique within a Module; PostgreSQL checks `position >= 1` |
| `createdAt` | Required timestamp defaulted on insert |
| `updatedAt` | Required timestamp maintained by Prisma writes |

There is no Lesson `description`, status, content JSON, text/video/PDF/image/link payload, uploaded-file ID, Quiz relation, or Quiz object in LMS-021. Title length and control-character validation are deferred to LMS-022's API boundary.

## LessonType

PostgreSQL enum `LessonType` contains `TEXT`, `VIDEO`, `PDF`, `IMAGE`, `LINK`, and `QUIZ`. It identifies the future lesson-content type only. `Lesson.type` is required with no implicit `TEXT` default; a future Lesson Builder must choose the type explicitly. `QUIZ` is reserved for Quiz functionality beginning in LMS-025. LMS-021 creates no Quiz, Question, QuestionOption, or Attempt model and no Quiz relation.

## Ordering

Lesson positions are one-based, positive, unique within each Module, and read in ascending order. The database allows gaps; contiguous `1..N` create, move, and delete behavior belongs to LMS-022. Position `1` can be used independently in two different Modules. Duplicate Lesson titles do not affect ordering.

## Cascades and tenant integrity

Hard deleting a Lesson's Module deletes its Lessons. Hard deleting a Course deletes its Modules, which cascade to Lessons. Hard deleting an Organization also deletes its Lessons through the direct Organization FK; its Courses and Modules retain their existing cascades. The PostgreSQL integration test directly attempts a mismatched tenant/Module Lesson insert and expects PostgreSQL to reject it. It also creates a probe composite FK to `(Lesson.id, organizationId)` and verifies same-tenant acceptance and cross-tenant rejection.

These constraints establish relational integrity only. Future Lesson handlers must obtain tenant identity from trusted context and scope their queries by `organizationId`.

## Future API and published Courses

LMS-021 adds no Lesson CRUD API, Builder, editor, preview, UI, content storage, upload, video, PDF, image, rich-text, or Quiz behavior. LMS-022 owns Lesson API validation and contiguous ordering operations. It must use the LMS-020 Course row locking strategy (`SELECT ... FOR UPDATE`) before Lesson structure/content mutations, and must reject mutations when Course status is `PUBLISHED`. LMS-021 does not change the LMS-020 lock implementation.

## Verification

`tests/lesson-model-postgres.test.ts` runs against PostgreSQL 16 in CI and the dedicated `lms_platform_test` database. It inserts every `LessonType`, verifies required/default semantics, checks positive and per-Module unique positions, exercises same-position use across Modules and duplicate titles, probes the candidate key, performs a direct cross-tenant insert, and verifies Module, Course, and Organization cascades. See [LMS-021](../tickets/LMS-021.md) for the ticket record.
