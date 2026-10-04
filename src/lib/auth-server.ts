import "server-only";
import { cookies } from "next/headers";
import type { AuthStore, AuthenticatedUser } from "@/lib/auth-core";
import {
  getUserForSessionToken,
  provisionPasswordCredential,
} from "@/lib/auth-core";

export const authStore: AuthStore = {
  async findCredentialByEmail(email) {
    const { db } = await import("@/lib/db");
    const record = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordCredential: { select: { passwordHash: true } },
      },
    });
    if (!record?.passwordCredential) return null;

    return {
      user: { id: record.id, email: record.email, name: record.name },
      passwordHash: record.passwordCredential.passwordHash,
    };
  },

  async createPasswordCredential(userId, passwordHash) {
    const { db } = await import("@/lib/db");
    await db.passwordCredential.create({ data: { userId, passwordHash } });
  },

  async createSession(userId, tokenHash, expiresAt) {
    const { db } = await import("@/lib/db");
    await db.session.create({ data: { userId, tokenHash, expiresAt } });
  },

  async findSession(tokenHash) {
    const { db } = await import("@/lib/db");
    const session = await db.session.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        user: { select: { id: true, email: true, name: true } },
      },
    });
    if (!session) return null;

    return { user: session.user, expiresAt: session.expiresAt };
  },

  async deleteSession(tokenHash) {
    const { db } = await import("@/lib/db");
    await db.session.deleteMany({ where: { tokenHash } });
  },
};

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const cookieStore = await cookies();
  return getUserForSessionToken(
    cookieStore.get(getSessionCookieName())?.value,
    authStore,
  );
}

export async function provisionUserPassword(
  userId: string,
  password: string,
): Promise<void> {
  await provisionPasswordCredential(userId, password, authStore);
}

export function getSessionCookieName(): string {
  return process.env.NODE_ENV === "production"
    ? "__Host-lms_session"
    : "lms_session";
}

export function getSessionCookieOptions(expiresAt?: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    ...(expiresAt
      ? {
          expires: expiresAt,
          maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
        }
      : { expires: new Date(0), maxAge: 0 }),
  };
}
