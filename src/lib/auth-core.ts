import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const SESSION_TOKEN_BYTES = 32;
// A fixed, non-account hash keeps unknown-user checks on the same KDF path from cold start.
const DUMMY_PASSWORD_HASH =
  "scrypt-v1$32768$8$1$paWlpaWlpaWlpaWlpaWlpQ$UNs6xofl4DbCbJjfWArq9N7NdgrZ7CKqTD3uKnXoUgC1HaX5LNxA12GT5Otdf9a5rCbczCGDGFaALzQz-xAisA";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
};

export type LoginCredentials = {
  email: string;
  password: string;
};

export type CredentialRecord = {
  user: AuthenticatedUser;
  passwordHash: string;
};

export type SessionRecord = {
  user: AuthenticatedUser;
  expiresAt: Date;
};

export interface AuthStore {
  findCredentialByEmail(email: string): Promise<CredentialRecord | null>;
  createPasswordCredential(userId: string, passwordHash: string): Promise<void>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export function parseLoginCredentials(value: unknown): LoginCredentials | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    return null;
  }

  const email = input.email.trim();
  if (
    email.length === 0 ||
    Buffer.byteLength(email, "utf8") > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    input.password.length === 0 ||
    Buffer.byteLength(input.password, "utf8") > 1024
  ) {
    return null;
  }

  return { email, password: input.password };
}

function deriveScryptKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (!isPasswordValid(password)) {
    throw new Error("Password does not meet the credential policy.");
  }

  const salt = randomBytes(SCRYPT_SALT_LENGTH);
  const derivedKey = await deriveScryptKey(password, salt);
  return [
    "scrypt-v1",
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

/** LMS-007 password policy shared by trusted provisioning and activation. */
export function isPasswordValid(password: string): boolean {
  return [...password].length >= 12 && Buffer.byteLength(password, "utf8") <= 1024;
}

function parsePasswordHash(value: string): { salt: Buffer; key: Buffer } | null {
  const parts = value.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt-v1" ||
    parts[1] !== String(SCRYPT_COST) ||
    parts[2] !== String(SCRYPT_BLOCK_SIZE) ||
    parts[3] !== String(SCRYPT_PARALLELIZATION)
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(parts[4], "base64url");
    const key = Buffer.from(parts[5], "base64url");
    if (salt.length !== SCRYPT_SALT_LENGTH || key.length !== SCRYPT_KEY_LENGTH) {
      return null;
    }
    return { salt, key };
  } catch {
    return null;
  }
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;

  const candidate = await deriveScryptKey(password, parsed.salt);
  return timingSafeEqual(candidate, parsed.key);
}

export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function isSessionToken(token: string | null | undefined): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export async function loginWithCredentials(
  credentials: LoginCredentials,
  store: AuthStore,
  now = new Date(),
): Promise<{ user: AuthenticatedUser; sessionToken: string; expiresAt: Date } | null> {
  const record = await store.findCredentialByEmail(credentials.email);
  const passwordHash = record?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await verifyPassword(credentials.password, passwordHash);

  if (!record || !passwordMatches) return null;

  const sessionToken = createSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  await store.createSession(record.user.id, hashSessionToken(sessionToken), expiresAt);

  return { user: record.user, sessionToken, expiresAt };
}

export async function provisionPasswordCredential(
  userId: string,
  password: string,
  store: AuthStore,
): Promise<void> {
  const passwordHash = await hashPassword(password);
  await store.createPasswordCredential(userId, passwordHash);
}

export async function getUserForSessionToken(
  token: string | null | undefined,
  store: AuthStore,
  now = new Date(),
): Promise<AuthenticatedUser | null> {
  if (!isSessionToken(token)) return null;

  const session = await store.findSession(hashSessionToken(token));
  if (!session || session.expiresAt.getTime() <= now.getTime()) return null;
  return session.user;
}

export async function invalidateSessionToken(
  token: string | null | undefined,
  store: AuthStore,
): Promise<void> {
  if (!isSessionToken(token)) return;
  await store.deleteSession(hashSessionToken(token));
}

export function isTrustedAuthRequest(
  request: Request,
  expectedContentType = "application/json",
): boolean {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  const origin = request.headers.get("origin");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (contentType !== expectedContentType.toLowerCase() || !origin || !appUrl) return false;

  try {
    return origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

export async function readJsonBody(request: Request, maxBytes = 8 * 1024): Promise<unknown> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes) return null;
  }

  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    return null;
  }
}
