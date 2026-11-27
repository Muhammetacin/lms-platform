import { randomInt } from "node:crypto";
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

import {
  createLoginRateLimitStore, loginRateLimitKeys, LOGIN_ACCOUNT_LIMIT, LOGIN_SOURCE_LIMIT, LOGIN_RETRY_AFTER,
} from "@/lib/login-rate-limit";

function rateLimited() {
  return Response.json({ error: "login_rate_limited" }, {
    status: 429,
    headers: { ...privateJsonHeaders, "Retry-After": String(LOGIN_RETRY_AFTER) },
  });
}

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
    const keys = loginRateLimitKeys(request.headers, credentials.email, {
      production: process.env.NODE_ENV === "production",
      secret: process.env.LOGIN_RATE_LIMIT_SECRET,
      trustedHeader: process.env.LOGIN_TRUSTED_CLIENT_IP_HEADER,
    });
    const { db } = await import("@/lib/db");
    const limiter = createLoginRateLimitStore(db);
    if (randomInt(32) === 0) {
      await limiter.pruneExpired().catch(() => console.error("Login rate limit cleanup failed."));
    }
    if (keys.source && !await limiter.reserve(keys.source, LOGIN_SOURCE_LIMIT)) return rateLimited();
    const accountWindow = await limiter.reserve(keys.account, LOGIN_ACCOUNT_LIMIT);
    if (!accountWindow) return rateLimited();

    const result = await loginWithCredentials(credentials, authStore);
    if (!result) {
      return Response.json({ error: "invalid_credentials" }, { status: 401, headers: privateJsonHeaders });
    }

    await limiter.release(keys.account, accountWindow).catch(() => {
      console.error("Login rate limit reservation could not be released.");
    });
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
