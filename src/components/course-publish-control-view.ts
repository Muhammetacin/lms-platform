import { createElement as h } from "react";

export function CoursePublishControlView({
  published,
  confirming = false,
  pending = false,
  errorMessage = null,
  issues = [],
  truncated = false,
  onRequestPublish,
  onCancel,
  onConfirm,
}: {
  published: boolean;
  confirming?: boolean;
  pending?: boolean;
  errorMessage?: string | null;
  issues?: string[];
  truncated?: boolean;
  onRequestPublish?(): void;
  onCancel?(): void;
  onConfirm?(): void;
}) {
  if (published) return null;
  return h("section", { className: "course-publish-panel", "aria-labelledby": "course-publishing-heading" },
    h("p", { className: "admin-eyebrow" }, "Final step"),
    h("h3", { id: "course-publishing-heading" }, "Publishing"),
    h("p", null, "Publishing locks the course structure. Make sure every module and lesson is complete."),
    errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
    issues.length ? h("ul", { className: "publish-issues", "aria-label": "Publishing issues" }, issues.map((issue, index) => h("li", { key: `${index}-${issue}` }, issue))) : null,
    truncated ? h("p", { className: "form-hint" }, "Additional publishing issues were omitted. Resolve the items above and try again.") : null,
    confirming
      ? h("section", { className: "confirmation-panel publish-confirmation", "aria-labelledby": "publish-course-confirmation" },
          h("h4", { id: "publish-course-confirmation" }, "Publish course?"),
          h("p", null, "After publishing, modules and lessons can no longer be changed."),
          h("div", { className: "form-actions" },
            h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancel }, "Cancel"),
            h("button", { className: "primary-action", type: "button", disabled: pending, onClick: onConfirm }, pending ? "Publishing…" : "Publish course"),
          ),
        )
      : h("button", { className: "primary-action", type: "button", disabled: pending, onClick: onRequestPublish }, "Publish course"),
  );
}
