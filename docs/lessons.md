# Lessons

**Status: LMS-021 model foundation and LMS-022 Lesson Builder API complete; learner rendering and publishing remain future work.**

## Hierarchy and ownership

The hierarchy is `Organization → Course → CourseModule → Lesson`. A Lesson belongs to exactly one `CourseModule` through required `moduleId`; its Course is derived through that Module. Lesson has no separate `courseId`. It is tenant-owned through required `organizationId`, with a direct Organization relation and a composite cascading Module relation.

PostgreSQL enforces `(moduleId, organizationId) → CourseModule(id, organizationId)`. A Lesson cannot refer to a Module from another Organization, even through a direct database write. `Lesson(id, organizationId)` remains a candidate key for future tenant-owned child records.

## Model and content

| Field | Database behavior |
| --- | --- |
| `id` | UUID primary key; Prisma generates a UUID |
| `organizationId` | Required UUID; direct cascading FK to `Organization.id` |
| `moduleId` | Required UUID; composite cascading FK to `CourseModule(id, organizationId)` |
| `title` | Required text; duplicates allowed |
| `type` | Required `LessonType`; no database default |
| `position` | Positive integer, unique within a Module; Builder writes maintain `1..N` |
| `textContent` | Nullable PostgreSQL `TEXT`; used only by `TEXT` Lessons |
| `contentUrl` | Nullable PostgreSQL `TEXT`; used only by `VIDEO`, `PDF`, `IMAGE`, and `LINK` Lessons |
| `createdAt`, `updatedAt` | Required timestamps; position-only changes preserve both |

The stable `Lesson_type_content_consistency_check` constraint allows draft content to be null while preventing content fields that do not match `type`. `TEXT` forbids a URL, `VIDEO`/`PDF`/`IMAGE`/`LINK` forbid text, and `QUIZ` forbids both fields. No generic JSON content field, upload ID, or Quiz relation is used.

`LessonType` contains `TEXT`, `VIDEO`, `PDF`, `IMAGE`, `LINK`, and `QUIZ`. Create requires an explicit exact enum value and accepts no initial content. A type change clears both content fields in the same Course-locked transaction. A same-type update preserves existing content.

`TEXT` is source text, not trusted HTML. The API preserves surrounding formatting whitespace, normalizes CRLF/CR to LF, turns blank text into `null`, allows ordinary tabs and newlines, rejects other controls and unpaired surrogates, and limits content to 100,000 Unicode code points. Future rendering must escape it safely; that rendering belongs to LMS-024.

`VIDEO`, `PDF`, `IMAGE`, and `LINK` use an absolute HTTPS URL, limited to 2,048 characters, with a hostname and without URL credentials. Blank values become `null`. The server does not fetch URLs, resolve metadata, upload files, or serve remote assets. Secure managed storage is a separate future enhancement.

`QUIZ` remains creatable as a Lesson type but has no Quiz model or content in LMS-022. Its detail response has `content: null`; content updates return `409 quiz_content_not_available`. Quiz content starts with a future Quiz ticket.

## API

All endpoints require trusted tenant context and `MANAGE_COURSES` (OWNER/ADMIN). Tenant identity comes only from `requireTenantContext()`; client tenant headers and query parameters do not select an Organization. Reads and writes use hierarchy-scoped Course, Module, and Lesson lookups. Foreign and malformed resources use the same safe 404 code as missing resources at that hierarchy level. All success and error responses set `Cache-Control: no-store`.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/organizations/courses/:courseId/modules/:moduleId/lessons` | Ordered Lesson summaries without content |
| POST | same | Create a DRAFT Lesson at the end; exact body `{ title, type }`; returns `201` |
| GET | `.../lessons/:lessonId` | Scoped detail with type-specific `content` |
| PATCH | `.../lessons/:lessonId` | Update `title` and/or `type`; `moduleId` and `position` are immutable |
| DELETE | `.../lessons/:lessonId` | Delete and compact positions atomically |
| POST | `.../lessons/:lessonId/move` | Move within the same Module using `{ position }` |
| PUT | `.../lessons/:lessonId/content` | Replace the current type's content using `{ text }` or `{ url }` |

Create, metadata, move, and content bodies are strict allowlists. Parent IDs, tenant IDs, generated fields, `position` on create, and unknown properties are rejected. Lesson titles trim to 2–160 Unicode code points; duplicate titles are valid.

The list exposes only `id`, `title`, `type`, `position`, `createdAt`, and `updatedAt`. Detail exposes those fields plus `content: { text }`, `content: { url }`, or `content: null` for Quiz. Raw `textContent` and `contentUrl`, tenant IDs, and parent IDs are never returned.

## Ordering, locking, and lifecycle

Lesson positions are one-based, unique within a Module, and contiguous after Builder mutations. Create allocates `MAX(position) + 1` under the Course lock. Move validates `1..N`, parks the moving row at an unused positive sentinel, shifts intervening rows in a collision-safe direction, then assigns its final position. Delete and gap compaction are atomic. IDs remain stable; SQL position-only updates leave `updatedAt` unchanged.

Every mutation first locks the tenant-scoped parent Course with `SELECT "status" FROM "Course" WHERE "id" = ? AND "organizationId" = ? FOR UPDATE`. The lock remains held throughout the transaction. This is the same serialization boundary as LMS-020 CourseModule mutations and the one LMS-023 publishing must use. Concurrent Lesson creates, moves, deletes, Module changes, and publishing serialize on that row. A malformed or foreign Module is checked only after the Course scope is established.

Published Courses remain readable through Lesson list and detail. Create, metadata update, content update, move, and delete return `409 published_course_structure_locked`. LMS-023 owns the status transition and publication completeness. Draft Lessons may have empty content.

## Cascades and regression coverage

Deleting a Lesson's Module deletes its Lessons. Deleting a Course cascades through its Modules to its Lessons. Deleting an Organization removes its owned Lessons through the direct Organization FK. The LMS-021 model integrity test remains in CI.

`tests/lesson-builder.test.ts` covers validation and safe response mappings. `tests/lesson-builder-postgres.test.ts` uses production Builder handlers and Prisma store against PostgreSQL to cover tenant/role behavior, CRUD/content, the type/content CHECK, ordering, rollback, concurrent mutations, published races, Module delete interaction, and cascades. CI runs both suites plus the LMS-021 model regression.

LMS-022 adds no learner page, preview, rich editor, publish endpoint, Quiz model, storage bucket, upload flow, asset proxy, or audit subsystem. LMS-024 owns safe content rendering and preview; LMS-023 owns publishing and completeness validation.
