import { createElement as h, type FormEvent, type ReactNode } from "react";
import type { CoursePreviewLesson } from "../lib/course-preview-core.ts";
import { lessonTypes, type LessonTypeValue } from "../lib/lesson-core.ts";
import { lessonTypeLabels } from "../lib/course-builder-ui-core.ts";
import { LessonTypeSelect } from "./lesson-type-select.ts";
import { CourseBuilderActionsMenu } from "./course-builder-actions-menu.ts";
import { CourseBuilderDialog } from "./course-builder-dialog.ts";

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

const lessonTypeOptions = lessonTypes.map((value) => ({ value, label: lessonTypeLabels[value] }));

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
  const dirty = title !== lesson.title || type !== lesson.type;

  return h("article", { className: "lesson-editor-card", "aria-labelledby": `lesson-${lesson.id}-heading` },
    h("header", { className: "lesson-editor-header" },
      h("div", { className: "lesson-editor-title" },
        h("p", { className: "admin-eyebrow" }, `Lesson ${index + 1} · ${lessonTypeLabels[lesson.type]}`),
        h("h4", { id: `lesson-${lesson.id}-heading` }, lesson.title),
      ),
      editable ? h("div", { className: "lesson-editor-actions" },
        h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onEdit }, "Edit lesson"),
        h(CourseBuilderActionsMenu, { label: lesson.title },
          h("button", { type: "button", disabled: pending || index === 0, onClick: onMoveUp, "aria-label": `Move ${lesson.title} up` }, "Move up"),
          h("button", { type: "button", disabled: pending || index === lessonCount - 1, onClick: onMoveDown, "aria-label": `Move ${lesson.title} down` }, "Move down"),
          h("button", { type: "button", disabled: pending, onClick: onDelete, className: "is-destructive" }, "Delete lesson"),
        ),
      ) : null,
    ),
    h("div", { className: "lesson-content-area" }, children),
    h(CourseBuilderDialog, {
      open: editing && editable,
      title: "Edit lesson",
      dirty,
      pending,
      onClose: onCancelEdit ?? (() => {}),
      children: (requestClose) => h("form", { className: "builder-edit-form lesson-metadata-form", onSubmit, noValidate: true },
        errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
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
          h("label", { id: `lesson-${lesson.id}-type-label`, htmlFor: `lesson-${lesson.id}-type` }, "Type"),
          h(LessonTypeSelect, {
            id: `lesson-${lesson.id}-type`,
            labelId: `lesson-${lesson.id}-type-label`,
            name: "type",
            value: type,
            options: lessonTypeOptions,
            disabled: pending,
            onValueChange: onTypeChange,
          }),
        ),
        h("div", { className: "form-actions" },
          h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: requestClose }, "Cancel"),
          h("button", { className: "primary-action", type: "submit", disabled: pending }, pending ? "Saving…" : "Save lesson"),
        ),
      ),
    }),
    h(CourseBuilderDialog, {
      open: confirmingDelete && editable,
      title: "Delete lesson?",
      description: "This permanently removes this lesson.",
      size: "confirmation",
      pending,
      onClose: onCancelDelete ?? (() => {}),
      children: h("div", { className: "builder-confirmation" },
        errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
        h("div", { className: "form-actions" },
          h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancelDelete }, "Cancel"),
          h("button", { className: "destructive-action", type: "button", disabled: pending, onClick: onConfirmDelete }, pending ? "Deleting…" : "Delete lesson"),
        ),
      ),
    }),
    h(CourseBuilderDialog, {
      open: Boolean(proposedType) && editing && editable,
      title: "Change lesson type?",
      description: "Changing the lesson type clears its current content. The original content and type are kept if you cancel.",
      size: "confirmation",
      pending,
      onClose: onCancelTypeChange ?? (() => {}),
      children: h("div", { className: "builder-confirmation" },
        h("div", { className: "form-actions" },
          h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onCancelTypeChange }, "Cancel"),
          h("button", { className: "destructive-action", type: "button", disabled: pending, onClick: onConfirmTypeChange }, pending ? "Changing…" : "Change type"),
        ),
      ),
    }),
  );
}

export function AddLessonFormView({
  open,
  typeId = "new-lesson-type",
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
  typeId?: string;
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
  return h("div", { className: "course-builder-add-lesson" },
    h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: onOpen }, "+ Add lesson"),
    h(CourseBuilderDialog, {
      open,
      title: "Add lesson",
      dirty: Boolean(title || type !== "TEXT"),
      pending,
      onClose: onCancel ?? (() => {}),
      children: (requestClose) => h("form", { className: "builder-add-form lesson-add-form", onSubmit, noValidate: true },
        errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
        h("div", { className: "form-field" },
          h("label", { htmlFor: "new-lesson-title" }, "Lesson title"),
          h("input", { id: "new-lesson-title", name: "title", value: title, onChange: (event: { currentTarget: { value: string } }) => onTitleChange?.(event.currentTarget.value) }),
        ),
        h("div", { className: "form-field" },
          h("label", { id: `${typeId}-label`, htmlFor: typeId }, "Type"),
          h(LessonTypeSelect, {
            id: typeId,
            labelId: `${typeId}-label`,
            name: "type",
            value: type,
            options: lessonTypeOptions,
            disabled: pending,
            onValueChange: onTypeChange,
          }),
        ),
        h("div", { className: "form-actions" },
          h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: requestClose }, "Cancel"),
          h("button", { className: "primary-action", type: "submit", disabled: pending }, pending ? "Adding…" : "Add lesson"),
        ),
      ),
    }),
  );
}
