import { createElement as h, type FormEvent } from "react";

export function LoginFormView({
  pending,
  errorMessage,
  onSubmit,
}: {
  pending: boolean;
  errorMessage: string | null;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  return h("main", { className: "auth-page" },
    h("section", { className: "auth-card", "aria-labelledby": "login-title" },
      h("div", { className: "auth-brand-mark", "aria-hidden": true }, "L"),
      h("p", { className: "auth-brand" }, "LMS Platform"),
      h("h1", { id: "login-title" }, "Sign in to your workspace"),
      h("form", {
        className: "auth-form",
        method: "post",
        action: "/api/auth/login",
        onSubmit,
      },
      h("label", { htmlFor: "email" }, "Email"),
      h("input", {
        id: "email",
        name: "email",
        type: "email",
        autoComplete: "username",
        autoCapitalize: "none",
        spellCheck: false,
        required: true,
      }),
      h("label", { htmlFor: "password" }, "Password"),
      h("input", {
        id: "password",
        name: "password",
        type: "password",
        autoComplete: "current-password",
        required: true,
      }),
      errorMessage ? h("p", { className: "auth-error", role: "alert" }, errorMessage) : null,
      h("button", { type: "submit", disabled: pending }, pending ? "Signing in…" : "Sign in"),
      ),
    ),
  );
}
