import { createElement as h, type FormEvent, type ReactNode } from "react";
import type { CoursePreviewModule } from "../lib/course-preview-core.ts";

export type CourseModuleViewProps = {
  module: CoursePreviewModule;
  index: number;
  moduleCount: number;
  editable: boolean;
  editing?: boolean;
  confirmingDelete?: boolean;
  pending?: boolean;
  title?: string;
  description?: string;
  errorMessage?: string | null;
  fieldError?: string | null;
  children?: ReactNode;
  onEdit?(): void;
  onDelete?(): void;
  onMoveUp?(): void;
  onMoveDown?(): void;
  onCancelEdit?(): void;
  onCancelDelete?(): void;
  onConfirmDelete?(): void;
  onSubmit?(event: FormEvent<HTMLFormElement>): void;
  onTitleChange?(value: string): void;
  onDescriptionChange?(value: string): void;
};

export function CourseModuleView({
  module,
  index,
  moduleCount,
  editable,
  editing = false,
  confirmingDelete = false,
  pending = false,
  title = module.title,
  description = module.description ?? "",
  errorMessage = null,
  fieldError = null,
  children,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onCancelEdit,
  onCancelDelete,
  onConfirmDelete,
  onSubmit,
  onTitleChange,
  onDescriptionChange,
}: CourseModuleViewProps) {
  const titleErrorId = `module-${module.id}-title-error`;
  return h("article", { className: "course-module-card", "aria-labelledby": `module-${module.id}-heading` },
    h("header", { className: "course-module-header" },
      h("div", { className: "course-module-title" },
        h("p", { className: "admin-eyebrow" }, `Module ${index + 1}`),
        h("h3", { id: `module-${module.id}-heading` }, module.title),
      ),
      editable && !editing && !confirmingDelete ? h("div", { className: "builder-controls", "aria-label": `Controls for ${module.title}` },
        h("button", { className: "secondary-action", type: "button", disabled: pending || index === 0, onClick: onMoveUp, "aria-label": `Move ${module.title} up` }, "Move up"),
        h("button", { className: "secondary-action", type: "button", disabled: pending || index === moduleCount - 1, onClick: onMoveDown, "aria-label": `Move ${module.title} down` }, "Move down"),
        h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onEdit }, "Edit"),
        h("button", { className: "destructive-action", type: "button", disabled: pending, onClick: onDelete }, "Delete module"),
      ) : null,
    ),
    module.description
      ? h("p", { className: "course-module-description" }, module.description)
      : h("p", { className: "course-module-description is-empty" }, "No description provided."),
    errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
    editing && editable ? h("form", { className: "builder-edit-form", onSubmit, noValidate: true },
      h("div", { className: "form-field" },
        h("label", { htmlFor: `module-${module.id}-title` }, "Module title"),
        h("input", {
          id: `module-${module.id}-title`,
          name: "title",
          value: title,
          onChange: (event: { currentTarget: { value: string } }) => onTitleChange?.(event.currentTarget.value),
          "aria-invalid": fieldError ? "true" : undefined,
          "aria-describedby": fieldError ? titleErrorId : undefined,
        }),
        fieldError ? h("p", { className: "field-error", id: titleErrorId, role: "alert" }, fieldError) : null,
      ),
      h("div", { className: "form-field" },
        h("label", { htmlFor: `module-${module.id}-description` }, "Description (optional)"),
        h("textarea", {
          id: `module-${module.id}-description`,
          name: "description",
          rows: 3,
          value: description,
          onChange: (event: { currentTarget: { value: string } }) => onDescriptionChange?.(event.currentTarget.value),
        }),
      ),
      h("div", { className: "form-actions" },
        h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancelEdit }, "Cancel"),
        h("button", { className: "primary-action", type: "submit", disabled: pending }, pending ? "Saving…" : "Save module"),
      ),
    ) : null,
    confirmingDelete && editable ? h("section", { className: "confirmation-panel builder-confirmation", "aria-labelledby": `delete-module-${module.id}-heading` },
      h("h4", { id: `delete-module-${module.id}-heading` }, "Delete module?"),
      h("p", null, "This permanently deletes the module and all lessons inside it."),
      h("div", { className: "form-actions" },
        h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancelDelete }, "Cancel"),
        h("button", { className: "destructive-action", type: "button", disabled: pending, onClick: onConfirmDelete }, pending ? "Deleting…" : "Delete module"),
      ),
    ) : null,
    h("div", { className: "course-module-lessons" },
      module.lessons.length === 0
        ? h("p", { className: "builder-empty-lessons" }, editable ? "No lessons yet. Add a lesson to this module." : "No lessons yet.")
        : null,
      children,
    ),
  );
}

export function AddModuleFormView({
  open,
  pending = false,
  title = "",
  description = "",
  errorMessage = null,
  onOpen,
  onCancel,
  onSubmit,
  onTitleChange,
  onDescriptionChange,
}: {
  open: boolean;
  pending?: boolean;
  title?: string;
  description?: string;
  errorMessage?: string | null;
  onOpen?(): void;
  onCancel?(): void;
  onSubmit?(event: FormEvent<HTMLFormElement>): void;
  onTitleChange?(value: string): void;
  onDescriptionChange?(value: string): void;
}) {
  if (!open) return h("button", { className: "primary-action", type: "button", disabled: pending, onClick: onOpen }, "+ Add module");
  return h("form", { className: "builder-add-form", onSubmit, noValidate: true },
    h("h3", null, "Add module"),
    errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
    h("div", { className: "form-field" },
      h("label", { htmlFor: "new-module-title" }, "Module title"),
      h("input", { id: "new-module-title", name: "title", value: title, onChange: (event: { currentTarget: { value: string } }) => onTitleChange?.(event.currentTarget.value) }),
    ),
    h("div", { className: "form-field" },
      h("label", { htmlFor: "new-module-description" }, "Description (optional)"),
      h("textarea", { id: "new-module-description", name: "description", rows: 3, value: description, onChange: (event: { currentTarget: { value: string } }) => onDescriptionChange?.(event.currentTarget.value) }),
    ),
    h("div", { className: "form-actions" },
      h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancel }, "Cancel"),
      h("button", { className: "primary-action", type: "submit", disabled: pending }, pending ? "Adding…" : "Add module"),
    ),
  );
}
