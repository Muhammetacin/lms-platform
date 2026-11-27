"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoutButtonView } from "@/components/admin-portal-view";
import { createLogoutRequest } from "@/lib/login-form-core";

export function LogoutButton({ language = "en" }: { language?: "en" | "nl" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dutch = language === "nl";
  const signOutFailure = dutch ? "Uitloggen is mislukt. Probeer het opnieuw." : "Sign out failed. Please try again.";

  async function signOut() {
    if (pending) return;
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/logout", createLogoutRequest());
      if (!response.ok) {
        setErrorMessage(signOutFailure);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setErrorMessage(signOutFailure);
    } finally {
      setPending(false);
    }
  }

  return (
    <LogoutButtonView
      pending={pending}
      errorMessage={errorMessage}
      label={dutch ? "Uitloggen" : undefined}
      pendingLabel={dutch ? "Bezig met uitloggen…" : undefined}
      onClick={signOut}
    />
  );
}
