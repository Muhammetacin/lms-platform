import { cookies } from "next/headers";
import { invalidateSessionToken, isTrustedAuthRequest } from "@/lib/auth-core";
import {
  authStore,
  getSessionCookieName,
  getSessionCookieOptions,
} from "@/lib/auth-server";

const privateJsonHeaders = {
  "Cache-Control": "no-store",
};

export async function POST(request: Request) {
  if (!isTrustedAuthRequest(request)) {
    return Response.json({ error: "invalid_request" }, { status: 403, headers: privateJsonHeaders });
  }

  const cookieStore = await cookies();
  const cookieName = getSessionCookieName();
  const token = cookieStore.get(cookieName)?.value;

  try {
    await invalidateSessionToken(token, authStore);
    cookieStore.set(cookieName, "", getSessionCookieOptions());
    return Response.json({ success: true }, { headers: privateJsonHeaders });
  } catch {
    console.error("Authentication request could not be completed.", { operation: "logout" });
    return Response.json({ error: "authentication_unavailable" }, { status: 503, headers: privateJsonHeaders });
  }
}
