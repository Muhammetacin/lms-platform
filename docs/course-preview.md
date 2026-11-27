# Course Preview (LMS-024)

## Purpose and access

Course Preview is an authenticated, read-only authoring capability for `OWNER` and `ADMIN` members with `MANAGE_COURSES`. `MEMBER` and anonymous users cannot preview a Course. It supports both `DRAFT` and `PUBLISHED` Courses; a draft is labelled **Draft preview** and a published Course is labelled **Published**, with its `publishedAt` timestamp when present.

Preview does not change Course lifecycle, content, ordering, or structure. It does not provide learner access, enrollment, assignment, progress, completion, quiz attempts, certificates, or a public/share URL. Quiz authoring belongs to LMS-025; learning and learner flows belong to later learning-flow tickets.

## Routes and response

- `GET /api/organizations/courses/:courseId/preview` returns `{ course }` with Course, ordered Modules, ordered Lessons, and type-specific `content`.
- `/courses/:courseId/preview` is a protected, server-rendered admin page.

Both use the shared preview read model and tenant-scoped Prisma store. Course, Module, and Lesson reads are scoped to `requireTenantContext().organizationId`. Malformed, missing, and foreign Course IDs share the same 404 behavior. Every API response, including authorization and error responses, sets `Cache-Control: no-store`. The page is dynamically rendered with Next.js 16's supported `dynamic = "force-dynamic"` and `revalidate = 0` route configuration, so user-specific Course data is not statically generated or shared through the page cache.

The read model exposes Course `{ id, title, description, status, publishedAt, modules }`, Module `{ id, title, description, position, lessons }`, and Lesson `{ id, title, type, position, content }`. TEXT content is `{ text }` and VIDEO/PDF/IMAGE/LINK content is `{ url }`. QUIZ content is `null` and the lesson includes the `quizConfigured` flag. Module and Lesson ordering is `position ASC, id ASC`.

The Prisma store uses one interactive PostgreSQL transaction at `REPEATABLE READ`, with three bounded, tenant-scoped queries for Course, Modules, and Lessons. This gives the complete hierarchy one MVCC snapshot without taking a write lock. It avoids N+1 Lesson reads.

## Rendering security and resource policy

TEXT is rendered as ordinary escaped React text with preserved whitespace and line breaks. It is never interpreted as HTML or Markdown. Lesson HTML-like text remains literal text.

VIDEO, PDF, IMAGE, and LINK content appears as a resource card with a type label, parsed hostname, and explicit external link. The page does not embed the resource, render it as an image/video, fetch it on the server, or request metadata. Links are generated only from `parseLessonUrl()` accepted HTTPS values and use `target="_blank"`, `rel="noopener noreferrer"`, and `referrerPolicy="no-referrer"`. Invalid historical URLs are shown as **Resource unavailable** without a link. No URL scheme other than HTTPS can become clickable.

QUIZ Lessons display their configuration status. Empty text or URL values, empty Modules, and empty draft Courses display authoring placeholders.

## Accessibility and verification

The server-rendered page uses semantic headings, ordered Module/Lesson lists, visible textual status and type labels, descriptive link text, keyboard-accessible anchors, and a machine-readable `<time datetime>` value for publication. Responsive styles reuse the existing global CSS without adding a UI dependency.

Unit/render tests cover role access, safe error mapping, no-store responses, public field shaping, XSS-like text escaping, empty states, status labels, URL cards and link attributes, invalid URLs, and the absence of resource embeds. A PostgreSQL 16 test exercises production handlers and the Prisma store for both lifecycle states, ordering, empty structures, content types, tenant attacks, role access, and a coordinated concurrent mutation during a repeatable-read preview.
