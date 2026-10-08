import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/login-form";
import { getAuthenticatedUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function LoginPage() {
  let authenticated = false;
  try {
    authenticated = (await getAuthenticatedUser()) !== null;
  } catch {
    // Keep the page usable so the existing API can return its safe unavailable response.
  }

  if (authenticated) redirect("/admin");
  return <LoginForm />;
}
