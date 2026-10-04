import assert from "node:assert/strict";
import test from "node:test";
import {
  getUserForSessionToken,
  hashPassword,
  hashSessionToken,
  invalidateSessionToken,
  isTrustedAuthRequest,
  loginWithCredentials,
  parseLoginCredentials,
  provisionPasswordCredential,
  readJsonBody,
  SESSION_TTL_SECONDS,
  verifyPassword,
  type AuthStore,
  type AuthenticatedUser,
  type CredentialRecord,
  type SessionRecord,
} from "../src/lib/auth-core.ts";

const user: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "learner@example.com",
  name: "A Learner",
};
const password = "correct horse battery staple";

class MemoryAuthStore implements AuthStore {
  credential: CredentialRecord | null = null;
  sessions = new Map<string, SessionRecord>();

  async findCredentialByEmail(email: string) {
    return this.credential?.user.email === email ? this.credential : null;
  }

  async createPasswordCredential(userId: string, passwordHash: string) {
    assert.equal(userId, user.id);
    this.credential = { user, passwordHash };
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    assert.equal(userId, user.id);
    this.sessions.set(tokenHash, { user, expiresAt });
  }

  async findSession(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async deleteSession(tokenHash: string) {
    this.sessions.delete(tokenHash);
  }
}

test("validates login input and trims email without changing its case", () => {
  assert.deepEqual(
    parseLoginCredentials({ email: "  Learner@Example.com ", password }),
    { email: "Learner@Example.com", password },
  );
  assert.equal(parseLoginCredentials(null), null);
  assert.equal(parseLoginCredentials({ email: "", password }), null);
  assert.equal(parseLoginCredentials({ email: "learner@example.com", password: "" }), null);
  assert.equal(parseLoginCredentials({ email: "not-an-email", password }), null);
  assert.equal(parseLoginCredentials({ email: "learner@example.com", password: "x".repeat(1025) }), null);
});

test("password hashes use scrypt and verify without exposing the password", async () => {
  const encoded = await hashPassword(password);
  assert.match(encoded, /^scrypt-v1\$32768\$8\$1\$/);
  assert.equal(encoded.includes(password), false);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("incorrect password", encoded), false);
  assert.equal(await verifyPassword(password, "invalid-hash"), false);
  await assert.rejects(hashPassword("short"), /credential policy/);
});

test("trusted credential provisioning stores only the password hash", async () => {
  const store = new MemoryAuthStore();
  await provisionPasswordCredential(user.id, password, store);
  assert.ok(store.credential);
  assert.notEqual(store.credential.passwordHash, password);
  assert.equal(await verifyPassword(password, store.credential.passwordHash), true);
});

test("unknown accounts and wrong passwords have the same safe failure", async () => {
  const store = new MemoryAuthStore();
  await provisionPasswordCredential(user.id, password, store);

  const wrongPassword = await loginWithCredentials(
    { email: user.email, password: "a different password" },
    store,
  );
  const unknownAccount = await loginWithCredentials(
    { email: "unknown@example.com", password },
    store,
  );

  assert.equal(wrongPassword, null);
  assert.equal(unknownAccount, null);
  assert.equal(store.sessions.size, 0);
});

test("login creates a hashed, expiring session and returns only safe identity fields", async () => {
  const store = new MemoryAuthStore();
  await provisionPasswordCredential(user.id, password, store);
  const now = new Date("2026-10-04T10:00:00.000Z");

  const result = await loginWithCredentials({ email: user.email, password }, store, now);
  assert.ok(result);
  assert.deepEqual(result.user, user);
  assert.deepEqual(Object.keys(result.user).sort(), ["email", "id", "name"]);
  assert.equal(result.expiresAt.getTime(), now.getTime() + SESSION_TTL_SECONDS * 1000);
  assert.equal(result.sessionToken.length, 43);
  assert.equal(store.sessions.has(result.sessionToken), false);
  assert.equal(store.sessions.has(hashSessionToken(result.sessionToken)), true);
  assert.equal(JSON.stringify(result.user).includes("passwordHash"), false);

  assert.deepEqual(await getUserForSessionToken(result.sessionToken, store, now), user);
  assert.equal(
    await getUserForSessionToken(result.sessionToken, store, result.expiresAt),
    null,
  );
  assert.equal(await getUserForSessionToken("malformed", store, now), null);

  await invalidateSessionToken(result.sessionToken, store);
  assert.equal(await getUserForSessionToken(result.sessionToken, store, now), null);
  assert.equal(store.sessions.size, 0);
});

test("rejects malformed and oversized request bodies safely", async () => {
  const malformed = new Request("https://lms.example/api/auth/login", {
    method: "POST",
    body: "{invalid",
  });
  assert.equal(await readJsonBody(malformed), null);

  const oversized = new Request("https://lms.example/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "a".repeat(9000) }),
  });
  assert.equal(await readJsonBody(oversized), null);
});

test("requires same-origin JSON requests for cookie-authenticated mutations", () => {
  const previousUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://lms.example/";
  try {
    const accepted = new Request("https://lms.example/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://lms.example",
        "content-type": "application/json; charset=utf-8",
      },
      body: "{}",
    });
    const crossOrigin = new Request("https://lms.example/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    const formPost = new Request("https://lms.example/api/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://lms.example",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "x=1",
    });

    assert.equal(isTrustedAuthRequest(accepted), true);
    assert.equal(isTrustedAuthRequest(crossOrigin), false);
    assert.equal(isTrustedAuthRequest(formPost), false);
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousUrl;
  }
});
