"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LoginFormView } from "@/components/login-form-view";
import { createLoginRequest, loginErrorMessage } from "@/lib/login-form-core";

export function LoginForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const values = new FormData(event.currentTarget);
    const email = values.get("email");
    const password = values.get("password");
    if (typeof email !== "string" || typeof password !== "string") {
      setErrorMessage(loginErrorMessage("invalid_request"));
      return;
    }

    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/login", createLoginRequest(email, password));
      if (!response.ok) {
        let errorCode: unknown = null;
        try {
          const body: unknown = await response.json();
          if (typeof body === "object" && body !== null && "error" in body) {
            errorCode = body.error;
          }
        } catch {
          // The response body is untrusted; the same generic error is shown.
        }
        setErrorMessage(loginErrorMessage(errorCode));
        return;
      }

      router.replace("/admin");
      router.refresh();
    } catch {
      setErrorMessage(loginErrorMessage(null));
    } finally {
      setPending(false);
    }
  }

  return <LoginFormView pending={pending} errorMessage={errorMessage} onSubmit={handleSubmit} />;
}
