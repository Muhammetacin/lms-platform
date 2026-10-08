import { createElement as h, type ReactNode } from "react";
import type { Course } from "../lib/course-core.ts";

function displayDate(value: Date): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(value);
}

export function CourseStatusBadge({ status }: { status: Course["status"] }) {
  const statusClass = status === "PUBLISHED" ? "is-published" : "is-draft";
  return h("span", { className: `admin-status-badge ${statusClass}` }, status);
}

export function CourseManagementPageHeader({
  title,
  eyebrow,
  actions,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return h("header", { className: "admin-page-header" },
    h("div", null,
      eyebrow ? h("p", { className: "admin-eyebrow" }, eyebrow) : null,
      h("h1", null, title),
    ),
    actions ? h("div", { className: "course-actions" }, actions) : null,
  );
}

export function CreateCoursePageView({ form }: { form: ReactNode }) {
  return h("div", { className: "admin-page course-create-page" },
    h("a", { className: "back-link", href: "/admin/courses" }, "← Back to courses"),
    h(CourseManagementPageHeader, { title: "Create course", eyebrow: "Courses" }),
    h("section", { className: "course-form-card", "aria-label": "Create course details" }, form),
  );
}

export function CourseManagementDetailView({
  course,
  form,
  deleteControl,
}: {
  course: Course;
  form?: ReactNode;
  deleteControl?: ReactNode;
}) {
  const publishedAt = course.publishedAt?.toISOString() ?? null;
  return h("div", { className: "admin-page course-detail-page" },
    h("a", { className: "back-link", href: "/admin/courses" }, "← Back to courses"),
    h("header", { className: "course-detail-header" },
      h("div", { className: "course-detail-title" },
        h("p", { className: "admin-eyebrow" }, "Course management"),
        h("h1", null, course.title),
        h(CourseStatusBadge, { status: course.status }),
      ),
      h("div", { className: "course-actions" },
        h("a", {
          className: "secondary-action",
          href: `/courses/${encodeURIComponent(course.id)}/preview`,
        }, "Preview course"),
      ),
    ),
    h("section", { className: "course-description-panel", "aria-labelledby": "course-description-heading" },
      h("h2", { id: "course-description-heading" }, "Description"),
      course.description
        ? h("p", { className: "course-description-text" }, course.description)
        : h("p", { className: "course-description-empty" }, "No description provided."),
    ),
    h("dl", { className: "course-date-meta" },
      h("div", null,
        h("dt", null, "Last updated"),
        h("dd", null, h("time", { dateTime: course.updatedAt.toISOString() }, displayDate(course.updatedAt))),
      ),
      h("div", null,
        h("dt", null, "Published date"),
        h("dd", null, publishedAt
          ? h("time", { dateTime: publishedAt }, displayDate(course.publishedAt!))
          : "—"),
      ),
    ),
    h("section", { className: "course-settings", "aria-labelledby": "course-settings-heading" },
      h("div", { className: "section-heading" },
        h("p", { className: "admin-eyebrow" }, "Details"),
        h("h2", { id: "course-settings-heading" }, "Course settings"),
      ),
      form,
    ),
    h("section", { className: "danger-zone", "aria-labelledby": "danger-zone-heading" },
      h("div", null,
        h("p", { className: "admin-eyebrow" }, "Irreversible"),
        h("h2", { id: "danger-zone-heading" }, "Danger zone"),
        course.status === "PUBLISHED"
          ? h("p", { className: "danger-zone-note" }, "Published courses cannot be deleted.")
          : h("p", { className: "danger-zone-note" }, "Deleting a draft permanently removes the course, modules, and lessons."),
      ),
      deleteControl,
    ),
  );
}
