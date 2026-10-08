# Course Modules

**Status: LMS-020 Course Module API complete; LMS-022 Lesson Builder now shares its Course mutation lock.**

## Model and ownership

`CourseModule` is a tenant-owned child of `Course`. It stores a UUID `id`, `organizationId`, `courseId`, required title, nullable description, one-based position, and timestamps. The public response omits `organizationId` and `courseId`. Duplicate titles are allowed. A Course may have zero Modules. Its `lessons Lesson[]` relation is added by LMS-021; module Lesson ownership remains enforced by the database composite key.

The database enforces both `organizationId → Organization.id` and `(courseId, organizationId) → Course(id, organizationId)`, with cascading deletes. `@@unique([id, organizationId])` is referenced by LMS-021's composite Lesson FK. PostgreSQL also enforces unique `(courseId, position)` and the migration's `position >= 1` CHECK. The `(organizationId, courseId, position)` index supports tenant scoped ordered lists.

LMS-021 adds a required Lesson child through `(moduleId, organizationId) → CourseModule(id, organizationId)`, plus a direct Organization relation. Deleting a Module cascades to its Lessons; deleting a Course cascades through Modules to Lessons. Lesson positions are local to each Module and do not change the Module ordering rules below.

## API

All routes derive tenant identity from `requireTenantContext()` and require the existing `MANAGE_COURSES` permission. OWNER and ADMIN may manage Courses; MEMBER is denied. Every query includes the trusted organization ID and route Course ID. Detail and mutation queries include the route Module ID as well. Foreign/missing/malformed Course IDs return `404 course_not_found`; a missing, foreign-tenant, wrong-Course, or malformed Module ID returns `404 module_not_found` after the Course is scoped. All responses use `Cache-Control: no-store`.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/api/organizations/courses/:courseId/modules` | Ordered Module list |
| POST | `/api/organizations/courses/:courseId/modules` | Create at the end; `201` |
| GET | `/api/organizations/courses/:courseId/modules/:moduleId` | Scoped detail |
| PATCH | `/api/organizations/courses/:courseId/modules/:moduleId` | Update title and/or description |
| POST | `/api/organizations/courses/:courseId/modules/:moduleId/move` | Move to requested one-based position |
| DELETE | `/api/organizations/courses/:courseId/modules/:moduleId` | Delete and compact positions |

Create accepts exactly `title` and optional `description`; PATCH accepts exactly `title` and/or `description`; move accepts exactly an integer `position`. Tenant IDs, parent IDs, IDs, status, timestamps, and unknown properties are rejected. Titles trim to 2–160 Unicode code points. Descriptions trim to at most 4,000 Unicode code points, and blank text normalizes to `null`. Both reject controls and unpaired surrogates.

## Ordering and transactions

Positions start at 1, are unique per Course, and are contiguous after all API structural writes. Create computes `MAX(position) + 1` within a transaction. Move accepts only `1..moduleCount`. It parks the selected row at an unused positive position, shifts intervening rows one at a time in a collision-free direction, then places the selected row at its destination. The database uniqueness constraint is never deferred. Position-only SQL updates preserve the row IDs and timestamps. Delete and one-by-one compaction share one transaction; deleting the last or only Module is valid.

Every create, metadata update, move, and delete locks the scoped Course row with `SELECT ... FOR UPDATE`, checks its current status while holding the lock, and performs the change before releasing it. This serializes same-Course create/move/delete operations and closes the read-DRAFT/write-after-publish race. LMS-023 publishing acquires the same row lock before reading completeness and changing status. Organization and Course hard deletes use database cascades.

LMS-022 uses this same Course row lock for Lesson structure/content mutations and rejects writes while the Course is `PUBLISHED`. Both stores lock the tenant-scoped Course row before validating the Module and keep the lock for the complete transaction. This serializes Module deletion against Lesson changes and gives LMS-023 one lock boundary for publishing.

## Course lifecycle and scope

Module lists and details remain readable for both DRAFT and PUBLISHED Courses. All Module mutations on a PUBLISHED Course return `409 published_course_structure_locked`. LMS-023 validates contiguous ordering and requires every Module to contain a Lesson before publication.

LMS-020 adds no Lesson model or content, learner flows, Course Builder UI, publishing endpoint/versioning, or audit subsystem. LMS-021 owns the Lesson model and LMS-022 owns its secure management API. LMS-023 owns publishing; LMS-024 owns preview and rendering; LMS-058 owns audit integration.
