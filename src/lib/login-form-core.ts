export function loginErrorMessage(code: unknown): string {
  if (code === "invalid_credentials") return "Email or password is incorrect.";
  if (code === "authentication_unavailable") return "Sign in is temporarily unavailable.";
  return "Sign-in failed. Please try again.";
}

export function createLoginRequest(email: string, password: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: JSON.stringify({ email, password }),
  };
}

export function createLogoutRequest(): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    body: "{}",
  };
}
