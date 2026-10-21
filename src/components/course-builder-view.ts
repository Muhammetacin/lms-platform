import { createElement as h, type ReactNode } from "react";
import type { CourseBuilderData } from "../lib/course-builder-core.ts";

export function CourseBuilderView({
  builder,
  children,
}: {
  builder: CourseBuilderData;
  children: ReactNode;
}) {
  const publishedDate = builder.publishedAt
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(builder.publishedAt))
    : null;
  return h("section", { className: "course-builder", "aria-labelledby": "course-content-heading" },
    h("div", { className: "course-builder-header" },
      h("div", null,
        h("p", { className: "admin-eyebrow" }, "Course structure"),
        h("h2", { id: "course-content-heading" }, "Course content"),
      ),
      h("a", {
        className: "secondary-action",
        href: `/courses/${encodeURIComponent(builder.courseId)}/preview`,
      }, "Preview course"),
    ),
    builder.status === "PUBLISHED"
      ? h("div", { className: "builder-published-banner", role: "status" },
          h("strong", null, "Published course"),
          h("p", null, "Course structure is locked after publishing."),
          publishedDate ? h("p", null, "Published ", h("time", { dateTime: builder.publishedAt! }, publishedDate)) : null,
        )
      : null,
    h("div", { className: "course-builder-content" }, children),
  );
}
