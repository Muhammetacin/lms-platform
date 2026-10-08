import { createElement as h, type FormEvent } from "react";

export type CourseFormViewProps = {
  mode: "create" | "edit";
  title: string;
  description: string;
  pending?: boolean;
  titleError?: string | null;
  descriptionError?: string | null;
  errorMessage?: string | null;
  successMessage?: string | null;
  onSubmit?(event: FormEvent<HTMLFormElement>): void;
  onTitleChange?(value: string): void;
  onDescriptionChange?(value: string): void;
};

export function CourseFormView({
  mode,
  title,
  description,
  pending = false,
  titleError = null,
  descriptionError = null,
  errorMessage = null,
  successMessage = null,
  onSubmit,
  onTitleChange,
  onDescriptionChange,
}: CourseFormViewProps) {
  const titleDescriptions = ["course-title-hint", titleError ? "course-title-error" : null].filter(Boolean).join(" ");
  const descriptionDescriptions = ["course-description-hint", descriptionError ? "course-description-error" : null].filter(Boolean).join(" ");

  return h("form", { className: "course-form", onSubmit, noValidate: true },
    errorMessage ? h("p", { className: "error-message", role: "alert" }, errorMessage) : null,
    successMessage ? h("p", { className: "success-message", role: "status" }, successMessage) : null,
    h("div", { className: "form-field" },
      h("label", { htmlFor: "course-title" }, "Title"),
      h("input", {
        id: "course-title",
        name: "title",
        type: "text",
        autoComplete: "off",
        value: title,
        required: true,
        onChange: (event: { currentTarget: { value: string } }) => onTitleChange?.(event.currentTarget.value),
        "aria-invalid": titleError ? "true" : undefined,
        "aria-describedby": titleDescriptions,
      }),
      h("p", { className: "form-hint", id: "course-title-hint" }, "Required · 2–160 characters"),
      titleError ? h("p", { className: "field-error", id: "course-title-error" }, titleError) : null,
    ),
    h("div", { className: "form-field" },
      h("label", { htmlFor: "course-description" }, "Description"),
      h("textarea", {
        id: "course-description",
        name: "description",
        rows: 5,
        value: description,
        onChange: (event: { currentTarget: { value: string } }) => onDescriptionChange?.(event.currentTarget.value),
        "aria-invalid": descriptionError ? "true" : undefined,
        "aria-describedby": descriptionDescriptions,
      }),
      h("p", { className: "form-hint", id: "course-description-hint" }, "Optional · up to 4,000 characters"),
      descriptionError ? h("p", { className: "field-error", id: "course-description-error" }, descriptionError) : null,
    ),
    h("div", { className: "form-actions" },
      h("a", { className: "secondary-action", href: "/admin/courses" }, "Cancel"),
      h("button", { className: "primary-action", type: "submit", disabled: pending },
        pending ? "Saving…" : mode === "create" ? "Create course" : "Save changes",
      ),
    ),
  );
}
