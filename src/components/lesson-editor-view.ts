import { createElement as h, type FormEvent, type ReactNode } from "react";
import type { CoursePreviewLesson } from "../lib/course-preview-core.ts";
import { lessonTypes, type LessonTypeValue } from "../lib/lesson-core.ts";
import { lessonTypeLabels } from "../lib/course-builder-ui-core.ts";

export type LessonEditorViewProps = {
  lesson: CoursePreviewLesson;
  index: number;
  lessonCount: number;
  editable: boolean;
  editing?: boolean;
  confirmingDelete?: boolean;
  proposedType?: LessonTypeValue | null;
  pending?: boolean;
  title?: string;
  type?: LessonTypeValue;
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
  onConfirmTypeChange?(): void;
  onCancelTypeChange?(): void;
  onSubmit?(event: FormEvent<HTMLFormElement>): void;
  onTitleChange?(value: string): void;
  onTypeChange?(value: LessonTypeValue): void;
};

export function LessonEditorView({
  lesson,
  index,
  lessonCount,
  editable,
  editing = false,
  confirmingDelete = false,
  proposedType = null,
  pending = false,
  title = lesson.title,
  type = lesson.type,
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
  onConfirmTypeChange,
  onCancelTypeChange,
  onSubmit,
  onTitleChange,
  onTypeChange,
}: LessonEditorViewProps) {
  const titleErrorId = `lesson-${lesson.id}-title-error`;
  return h("article", { className: "lesson-editor-card", "aria-labelledby": `lesson-${lesson.id}-heading` },
    h("header", { className: "lesson-editor-header" },
      h("div", { className: "lesson-editor-title" },
        h("p", { className: "admin-eyebrow" }, `Lesson ${index + 1} · ${lessonTypeLabels[lesson.type]}`),
        h("h4", { id: `lesson-${lesson.id}-heading` }, lesson.title),
      ),
      editable && !editing && !confirmingDelete ? h("div", { className: "builder-controls", "aria-label": `Controls for ${lesson.title}` },
        h("button", { className: "secondary-action", type: "button", disabled: pending || index === 0, onClick: onMoveUp, "aria-label": `Move ${lesson.title} up` }, "Move up"),
        h("button", { className: "secondary-action", type: "button", disabled: pending || index === lessonCount - 1, onClick: onMoveDown, "aria-label": `Move ${lesson.title} down` }, "Move down"),
        h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onEdit }, "Edit lesson"),
        h("button", { className: "destructive-action", type: "button", disabled: pending, onClick: onDelete }, "Delete lesson"),
      ) : null,
    ),
    errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
    editing && editable ? h("form", { className: "builder-edit-form lesson-metadata-form", onSubmit, noValidate: true },
      h("div", { className: "form-field" },
        h("label", { htmlFor: `lesson-${lesson.id}-title` }, "Lesson title"),
        h("input", {
          id: `lesson-${lesson.id}-title`,
          name: "title",
          value: title,
          onChange: (event: { currentTarget: { value: string } }) => onTitleChange?.(event.currentTarget.value),
          "aria-invalid": fieldError ? "true" : undefined,
          "aria-describedby": fieldError ? titleErrorId : undefined,
        }),
        fieldError ? h("p", { className: "field-error", id: titleErrorId, role: "alert" }, fieldError) : null,
      ),
      h("div", { className: "form-field" },
        h("label", { htmlFor: `lesson-${lesson.id}-type` }, "Type"),
        h("select", {
          id: `lesson-${lesson.id}-type`,
          name: "type",
          value: type,
          onChange: (event: { currentTarget: { value: string } }) => onTypeChange?.(event.currentTarget.value as LessonTypeValue),
        }, lessonTypes.map((value) => h("option", { key: value, value }, lessonTypeLabels[value]))),
      ),
      proposedType ? h("section", { className: "confirmation-panel builder-confirmation", "aria-labelledby": `change-type-${lesson.id}-heading` },
        h("h5", { id: `change-type-${lesson.id}-heading` }, "Change lesson type?"),
        h("p", null, "Changing the lesson type clears its current content."),
        h("div", { className: "form-actions" },
          h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancelTypeChange }, "Cancel"),
          h("button", { className: "destructive-action", type: "button", disabled: pending, onClick: onConfirmTypeChange }, pending ? "Changing…" : "Change type"),
        ),
      ) : h("div", { className: "form-actions" },
        h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancelEdit }, "Cancel"),
        h("button", { className: "primary-action", type: "submit", disabled: pending }, pending ? "Saving…" : "Save lesson"),
      ),
    ) : null,
    confirmingDelete && editable ? h("section", { className: "confirmation-panel builder-confirmation", "aria-labelledby": `delete-lesson-${lesson.id}-heading` },
      h("h5", { id: `delete-lesson-${lesson.id}-heading` }, "Delete lesson?"),
      h("p", null, "This permanently removes this lesson."),
      h("div", { className: "form-actions" },
        h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancelDelete }, "Cancel"),
        h("button", { className: "destructive-action", type: "button", disabled: pending, onClick: onConfirmDelete }, pending ? "Deleting…" : "Delete lesson"),
      ),
    ) : null,
    h("div", { className: "lesson-content-area" }, children),
  );
}

export function AddLessonFormView({
  open,
  pending = false,
  title = "",
  type = "TEXT",
  errorMessage = null,
  onOpen,
  onCancel,
  onSubmit,
  onTitleChange,
  onTypeChange,
}: {
  open: boolean;
  pending?: boolean;
  title?: string;
  type?: LessonTypeValue;
  errorMessage?: string | null;
  onOpen?(): void;
  onCancel?(): void;
  onSubmit?(event: FormEvent<HTMLFormElement>): void;
  onTitleChange?(value: string): void;
  onTypeChange?(value: LessonTypeValue): void;
}) {
  if (!open) return h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onOpen }, "+ Add lesson");
  return h("form", { className: "builder-add-form lesson-add-form", onSubmit, noValidate: true },
    h("h4", null, "Add lesson"),
    errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
    h("div", { className: "form-field" },
      h("label", { htmlFor: "new-lesson-title" }, "Lesson title"),
      h("input", { id: "new-lesson-title", name: "title", value: title, onChange: (event: { currentTarget: { value: string } }) => onTitleChange?.(event.currentTarget.value) }),
    ),
    h("div", { className: "form-field" },
      h("label", { htmlFor: "new-lesson-type" }, "Type"),
      h("select", { id: "new-lesson-type", name: "type", value: type, onChange: (event: { currentTarget: { value: string } }) => onTypeChange?.(event.currentTarget.value as LessonTypeValue) },
        lessonTypes.map((value) => h("option", { key: value, value }, lessonTypeLabels[value])),
      ),
    ),
    h("div", { className: "form-actions" },
      h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancel }, "Cancel"),
      h("button", { className: "primary-action", type: "submit", disabled: pending }, pending ? "Adding…" : "Add lesson"),
    ),
  );
}
