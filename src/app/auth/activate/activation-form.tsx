"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type ViewState =
  | "loading"
  | "ready"
  | "invalid"
  | "expired"
  | "used"
  | "inactive"
  | "already-activated"
  | "complete"
  | "error";

function stateFromError(error: unknown): ViewState {
  if (typeof error !== "string") return "error";
  switch (error) {
    case "invalid_invitation": return "invalid";
    case "invitation_expired": return "expired";
    case "invitation_already_used": return "used";
    case "employee_inactive": return "inactive";
    case "account_already_activated": return "already-activated";
    default: return "error";
  }
}

const stateCopy: Record<Exclude<ViewState, "loading" | "ready" | "complete">, string> = {
  invalid: "This activation link is invalid. Ask your organization administrator to send a new invitation.",
  expired: "This activation link has expired. Ask your organization administrator to send a new invitation.",
  used: "This activation link has already been used.",
  inactive: "This employee account is inactive. Contact your organization administrator.",
  "already-activated": "This account already has a password. Sign in using your existing credentials.",
  error: "We could not complete activation. Please try again later.",
};

export default function ActivationForm() {
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const url = new URL(window.location.href);
    const invitationToken = new URLSearchParams(url.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    if (!invitationToken) {
      queueMicrotask(() => setState("invalid"));
      return;
    }

    tokenRef.current = invitationToken;
    void fetch("/api/auth/invitations/validate", {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: invitationToken }),
    }).then(async (response) => {
      if (response.ok) {
        setState("ready");
        return;
      }
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      setState(stateFromError(body?.error));
    }).catch(() => setState("error"));
  }, []);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = tokenRef.current;
    if (!token || submitting) return;
    setSubmitting(true);
    setFormError("");
    try {
      const response = await fetch("/api/auth/invitations/activate", {
        method: "POST",
        cache: "no-store",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      if (response.ok) {
        setState("complete");
        tokenRef.current = null;
        setPassword("");
        setConfirmPassword("");
        return;
      }
      const body = await response.json().catch(() => null) as { error?: unknown } | null;
      if (body?.error === "password_mismatch") {
        setState("ready");
        setFormError("The passwords do not match.");
        return;
      }
      if (body?.error === "invalid_password") {
        setState("ready");
        setFormError("Use at least 12 characters and keep the password within 1024 UTF-8 bytes.");
        return;
      }
      setState(stateFromError(body?.error));
    } catch {
      setState("error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell">
      <section className="welcome-card activation-card" aria-labelledby="activation-title">
        <div className="brand-mark" aria-hidden="true">L</div>
        <p className="eyebrow">Account activation</p>
        <h1 id="activation-title">
          {state === "complete" ? "You’re all set." : "Set your password."}
        </h1>

        {state === "loading" && <p className="welcome-copy" role="status">Checking your invitation…</p>}

        {state === "ready" && (
          <form className="activation-form" onSubmit={activate}>
            <label htmlFor="activation-password">Password</label>
            <input
              id="activation-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
              value={password}
              onChange={(event) => { setPassword(event.target.value); setFormError(""); }}
            />
            <label htmlFor="activation-confirm-password">Confirm password</label>
            <input
              id="activation-confirm-password"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
              value={confirmPassword}
              onChange={(event) => { setConfirmPassword(event.target.value); setFormError(""); }}
            />
            <p className="activation-hint">Use at least 12 characters. Your password is saved securely.</p>
            {password !== confirmPassword && confirmPassword.length > 0 && (
              <p className="activation-error" role="alert">The passwords do not match.</p>
            )}
            {password.length > 0 && [...password].length < 12 && (
              <p className="activation-error" role="alert">Use at least 12 characters.</p>
            )}
            {formError && <p className="activation-error" role="alert">{formError}</p>}
            <button type="submit" disabled={submitting || password !== confirmPassword || [...password].length < 12}>
              {submitting ? "Activating…" : "Activate account"}
            </button>
          </form>
        )}

        {state === "complete" && (
          <p className="welcome-copy" role="status">
            Your account is active. You can now sign in with your email address and new password.
          </p>
        )}

        {state !== "loading" && state !== "ready" && state !== "complete" && (
          <p className="activation-error" role="alert">{stateCopy[state]}</p>
        )}

        {state === "ready" && submitting && <p className="welcome-copy" role="status">Activating your account…</p>}
      </section>
      <footer className="page-footer">LMS Platform · Built for learning</footer>
    </main>
  );
}
