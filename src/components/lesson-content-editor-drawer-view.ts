import { createElement as h, type FormEvent } from "react";
import type { LessonTypeValue } from "../lib/lesson-core.ts";
import { lessonTypeLabels } from "../lib/course-builder-ui-core.ts";
import { CourseBuilderDialog } from "./course-builder-dialog.ts";

export function LessonContentEditorDrawerView({
  lessonId,
  type,
  editable,
  editing = false,
  dirty = false,
  configured,
  text = "",
  url = "",
  savedUrl = "",
  summary = null,
  hostname = null,
  resourceUnavailable = false,
  pending = false,
  errorMessage = null,
  onEdit,
  onClose,
  onSubmit,
  onTextChange,
  onUrlChange,
}: {
  lessonId: string;
  type: LessonTypeValue;
  editable: boolean;
  editing?: boolean;
  dirty?: boolean;
  configured: boolean;
  text?: string;
  url?: string;
  savedUrl?: string;
  summary?: string | null;
  hostname?: string | null;
  resourceUnavailable?: boolean;
  pending?: boolean;
  errorMessage?: string | null;
  onEdit?(): void;
  onClose?(): void;
  onSubmit?(event: FormEvent<HTMLFormElement>): void;
  onTextChange?(value: string): void;
  onUrlChange?(value: string): void;
}) {
  if (type === "QUIZ") {
    return h("div", { className: "lesson-content-panel" },
      h("p", { className: "content-status" }, "Quiz not configured"),
      h("p", null, "Quiz configuration is not available yet. Quiz Builder will be added in the Quiz epic."),
    );
  }

  const readOnlySummary = type === "TEXT"
    ? h("div", { className: "lesson-content-panel" },
        h("p", { className: "content-status" }, configured ? "Content configured" : "Content not configured"),
        summary ? h("p", { className: "lesson-content-summary" }, summary) : null,
      )
    : h("div", { className: "lesson-content-panel" },
        h("p", { className: "content-status" }, configured ? "Content configured" : "Content not configured"),
        hostname ? h("p", null, "Resource host: ", hostname) : null,
        resourceUnavailable ? h("p", null, "Resource unavailable") : null,
        savedUrl ? h("a", {
          className: "secondary-action",
          href: savedUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          referrerPolicy: "no-referrer",
        }, "Open resource") : null,
      );

  if (!editable) return readOnlySummary;

  const fieldId = `lesson-${lessonId}-${type === "TEXT" ? "text" : "url"}`;
  const errorId = `${fieldId}-error`;
  return h("div", { className: "lesson-content-edit" },
    h("div", { className: "lesson-content-overview" },
      readOnlySummary,
      h("button", { className: "secondary-action", type: "button", onClick: onEdit }, "Edit content"),
    ),
    h(CourseBuilderDialog, {
      open: editing,
      title: type === "TEXT" ? "Edit lesson content" : `Edit ${lessonTypeLabels[type]} resource`,
      description: "Update the plain text or HTTPS resource URL for this lesson.",
      size: "drawer",
      dirty,
      pending,
      onClose: onClose ?? (() => {}),
      children: (requestClose) => h("form", { className: "lesson-content-form", onSubmit, noValidate: true },
        h("div", { className: "lesson-content-heading" },
          h("p", { className: "admin-eyebrow" }, "Lesson content"),
          h("p", { className: "content-status" }, configured ? "Content configured" : "Content not configured"),
        ),
        errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
        type === "TEXT"
          ? h("div", { className: "form-field lesson-content-field" },
              h("label", { htmlFor: fieldId }, "Lesson content"),
              h("textarea", {
                id: fieldId,
                name: "text",
                rows: 12,
                maxLength: 100_000,
                value: text,
                onChange: (event: { currentTarget: { value: string } }) => onTextChange?.(event.currentTarget.value),
                "aria-describedby": errorMessage ? errorId : undefined,
                "aria-invalid": errorMessage ? "true" : undefined,
              }),
              h("p", { className: "form-hint" }, "Plain text · up to 100,000 characters"),
              errorMessage ? h("p", { className: "field-error", id: errorId }, errorMessage) : null,
            )
          : h("div", { className: "form-field" },
              h("label", { htmlFor: fieldId }, "Resource URL"),
              h("input", {
                id: fieldId,
                name: "url",
                type: "url",
                inputMode: "url",
                autoComplete: "url",
                maxLength: 2048,
                placeholder: "https://…",
                value: url,
                onChange: (event: { currentTarget: { value: string } }) => onUrlChange?.(event.currentTarget.value),
                "aria-describedby": errorMessage ? errorId : undefined,
                "aria-invalid": errorMessage ? "true" : undefined,
              }),
              h("p", { className: "form-hint" }, `${lessonTypeLabels[type]} resource · HTTPS only · up to 2,048 characters`),
              errorMessage ? h("p", { className: "field-error", id: errorId }, errorMessage) : null,
            ),
        h("div", { className: "form-actions lesson-content-form__actions" },
          h("button", { className: "secondary-action", type: "button", disabled: pending, onClick: requestClose }, "Cancel"),
          h("button", { className: "primary-action", type: "submit", disabled: pending }, pending ? "Saving…" : "Save content"),
        ),
      ),
    }),
  );
}
