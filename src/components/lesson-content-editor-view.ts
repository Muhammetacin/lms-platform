import { createElement as h, type FormEvent } from "react";
import type { LessonTypeValue } from "../lib/lesson-core.ts";
import { lessonTypeLabels } from "../lib/course-builder-ui-core.ts";

export function LessonContentEditorView({
  lessonId,
  type,
  editable,
  configured,
  text = "",
  url = "",
  summary = null,
  hostname = null,
  resourceUnavailable = false,
  pending = false,
  errorMessage = null,
  successMessage = null,
  onSubmit,
  onTextChange,
  onUrlChange,
}: {
  lessonId: string;
  type: LessonTypeValue;
  editable: boolean;
  configured: boolean;
  text?: string;
  url?: string;
  summary?: string | null;
  hostname?: string | null;
  resourceUnavailable?: boolean;
  pending?: boolean;
  errorMessage?: string | null;
  successMessage?: string | null;
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

  if (!editable) {
    if (type === "TEXT") {
      return h("div", { className: "lesson-content-panel" },
        h("p", { className: "content-status" }, configured ? "Content configured" : "Content not configured"),
        summary ? h("p", { className: "lesson-content-summary" }, summary) : null,
      );
    }
    return h("div", { className: "lesson-content-panel" },
      h("p", { className: "content-status" }, configured ? "Content configured" : "Content not configured"),
      hostname ? h("p", null, "Resource host: ", hostname) : null,
      resourceUnavailable ? h("p", null, "Resource unavailable") : null,
      url ? h("a", {
        className: "secondary-action",
        href: url,
        target: "_blank",
        rel: "noopener noreferrer",
        referrerPolicy: "no-referrer",
      }, "Open resource") : null,
    );
  }

  const fieldId = `lesson-${lessonId}-${type === "TEXT" ? "text" : "url"}`;
  const errorId = `${fieldId}-error`;
  return h("form", { className: "lesson-content-form", onSubmit, noValidate: true },
    h("div", { className: "lesson-content-heading" },
      h("h5", null, type === "TEXT" ? "Lesson content" : "Resource URL"),
      h("p", { className: "content-status" }, configured ? "Content configured" : "Content not configured"),
    ),
    errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
    successMessage ? h("p", { className: "success-message", role: "status" }, successMessage) : null,
    type === "TEXT"
      ? h("div", { className: "form-field" },
          h("label", { htmlFor: fieldId }, "Lesson content"),
          h("textarea", {
            id: fieldId,
            name: "text",
            rows: 8,
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
    h("div", { className: "form-actions" },
      h("button", { className: "primary-action", type: "submit", disabled: pending }, pending ? "Saving…" : "Save content"),
    ),
  );
}
