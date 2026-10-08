"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoutButtonView } from "@/components/admin-portal-view";
import { createLogoutRequest } from "@/lib/login-form-core";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function signOut() {
    if (pending) return;
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/logout", createLogoutRequest());
      if (!response.ok) {
        setErrorMessage("Sign out failed. Please try again.");
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setErrorMessage("Sign out failed. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return <LogoutButtonView pending={pending} errorMessage={errorMessage} onClick={signOut} />;
}
