import { cookies } from "next/headers";
import {
  isTrustedAuthRequest,
  loginWithCredentials,
  parseLoginCredentials,
  readJsonBody,
} from "@/lib/auth-core";
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

  const credentials = parseLoginCredentials(await readJsonBody(request));
  if (!credentials) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: privateJsonHeaders });
  }

  try {
    const result = await loginWithCredentials(credentials, authStore);
    if (!result) {
      return Response.json({ error: "invalid_credentials" }, { status: 401, headers: privateJsonHeaders });
    }

    const cookieStore = await cookies();
    cookieStore.set(
      getSessionCookieName(),
      result.sessionToken,
      getSessionCookieOptions(result.expiresAt),
    );
    return Response.json({ user: result.user }, { headers: privateJsonHeaders });
  } catch {
    console.error("Authentication request could not be completed.", { operation: "login" });
    return Response.json({ error: "authentication_unavailable" }, { status: 503, headers: privateJsonHeaders });
  }
}
