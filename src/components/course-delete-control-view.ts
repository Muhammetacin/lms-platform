import { createElement as h } from "react";

export type CourseDeleteControlViewProps = {
  allowDelete?: boolean;
  confirming?: boolean;
  pending?: boolean;
  errorMessage?: string | null;
  onRequestDelete?(): void;
  onCancel?(): void;
  onConfirm?(): void;
};

export function CourseDeleteControlView({
  allowDelete = true,
  confirming = false,
  pending = false,
  errorMessage = null,
  onRequestDelete,
  onCancel,
  onConfirm,
}: CourseDeleteControlViewProps) {
  return h("div", { className: "course-delete-control" },
    errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
    !allowDelete
      ? null
      : confirming
      ? h("section", { className: "confirmation-panel", "aria-labelledby": "delete-course-title" },
          h("h3", { id: "delete-course-title" }, "Delete course?"),
          h("p", null, "This permanently deletes the draft course and its modules and lessons."),
          h("div", { className: "form-actions" },
            h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancel }, "Cancel"),
            h("button", { className: "destructive-action", type: "button", disabled: pending, onClick: onConfirm },
              pending ? "Deleting…" : "Delete permanently",
            ),
          ),
        )
      : h("div", { className: "danger-zone-actions" },
          h("button", {
            className: "destructive-action",
            type: "button",
            onClick: onRequestDelete,
          }, "Delete course"),
        ),
  );
}
