import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthorizationError,
  can,
  requireAuthenticatedIdentity,
  requireOrganizationMembership,
  requireOrganizationPermission,
  requireOrganizationRole,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";

const user: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "learner@example.com",
  name: "A Learner",
};
const organizationA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const organizationB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";

class MemoryAuthorizationStore implements AuthorizationStore {
  readonly roles = new Map<string, string>();
  readonly lookups: Array<{ userId: string; organizationId: string }> = [];
  failLookups = false;

  setRole(userId: string, organizationId: string, role: string) {
    this.roles.set(`${userId}:${organizationId}`, role);
  }

  async findOrganizationRole(userId: string, organizationId: string) {
    this.lookups.push({ userId, organizationId });
    if (this.failLookups) throw new Error("database connection details must not escape");
    return (this.roles.get(`${userId}:${organizationId}`) as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | undefined) ?? null;
  }
}

function expectAuthorizationError(
  code: "unauthenticated" | "forbidden" | "authorization_unavailable",
  status: 401 | 403 | 503,
) {
  return (error: unknown) => {
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  };
}

test("rejects missing identity and lets an authenticated user continue", async () => {
  assert.throws(
    () => requireAuthenticatedIdentity(null),
    expectAuthorizationError("unauthenticated", 401),
  );

  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "MEMBER");
  assert.deepEqual(requireAuthenticatedIdentity(user), user);
  assert.equal(
    (await requireOrganizationRole(user, organizationA, "MEMBER", store)).role,
    "MEMBER",
  );
});

test("requires a server-verified membership for the requested organization", async () => {
  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "MEMBER");

  assert.deepEqual(
    await requireOrganizationMembership(user, organizationA, store),
    { user, organizationId: organizationA, role: "MEMBER" },
  );
  await assert.rejects(
    requireOrganizationMembership(user, organizationB, store),
    expectAuthorizationError("forbidden", 403),
  );
  assert.deepEqual(store.lookups, [
    { userId: user.id, organizationId: organizationA },
    { userId: user.id, organizationId: organizationB },
  ]);
});

test("OWNER satisfies OWNER, ADMIN, and MEMBER role requirements", async () => {
  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "OWNER");

  for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
    assert.equal(
      (await requireOrganizationRole(user, organizationA, role, store)).role,
      "OWNER",
    );
  }
});

test("ADMIN satisfies ADMIN and MEMBER but not OWNER", async () => {
  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "ADMIN");

  assert.equal(
    (await requireOrganizationRole(user, organizationA, "ADMIN", store)).role,
    "ADMIN",
  );
  assert.equal(
    (await requireOrganizationRole(user, organizationA, "MEMBER", store)).role,
    "ADMIN",
  );
  await assert.rejects(
    requireOrganizationRole(user, organizationA, "OWNER", store),
    expectAuthorizationError("forbidden", 403),
  );
});

test("MEMBER satisfies MEMBER but not ADMIN or OWNER", async () => {
  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "MEMBER");

  assert.equal(
    (await requireOrganizationRole(user, organizationA, "MEMBER", store)).role,
    "MEMBER",
  );
  for (const role of ["ADMIN", "OWNER"] as const) {
    await assert.rejects(
      requireOrganizationRole(user, organizationA, role, store),
      expectAuthorizationError("forbidden", 403),
    );
  }
});

test("uses each membership's role independently across organizations", async () => {
  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "MEMBER");
  store.setRole(user.id, organizationB, "OWNER");

  assert.equal(
    (await requireOrganizationMembership(user, organizationA, store)).role,
    "MEMBER",
  );
  assert.equal(
    (await requireOrganizationRole(user, organizationB, "OWNER", store)).role,
    "OWNER",
  );
  await assert.rejects(
    requireOrganizationRole(user, organizationA, "ADMIN", store),
    expectAuthorizationError("forbidden", 403),
  );
});

test("ignores a client-supplied role and uses the stored membership role", async () => {
  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "MEMBER");
  const forgedUser = { ...user, role: "OWNER" } as AuthenticatedUser;

  await assert.rejects(
    requireOrganizationRole(forgedUser, organizationA, "OWNER", store),
    expectAuthorizationError("forbidden", 403),
  );
  assert.equal(await can(forgedUser, organizationA, "MANAGE_MEMBERS", store), false);
});

test("missing or malformed organization context never reaches the membership lookup", async () => {
  const store = new MemoryAuthorizationStore();

  for (const organizationId of [undefined, null, "", "not-an-organization-id"]) {
    await assert.rejects(
      requireOrganizationMembership(user, organizationId, store),
      expectAuthorizationError("forbidden", 403),
    );
  }
  assert.equal(store.lookups.length, 0);
});

test("permission checks apply the central role mapping and can() fails closed", async () => {
  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "MEMBER");

  assert.equal(await can(user, organizationA, "VIEW_ORGANIZATION", store), true);
  assert.equal(await can(user, organizationA, "MANAGE_MEMBERS", store), false);
  await assert.rejects(
    requireOrganizationPermission(user, organizationA, "MANAGE_MEMBERS", store),
    expectAuthorizationError("forbidden", 403),
  );

  store.setRole(user.id, organizationA, "ADMIN");
  assert.equal(await can(user, organizationA, "MANAGE_MEMBERS", store), true);
  assert.equal(await can(user, organizationA, "MANAGE_ORGANIZATION_OWNERSHIP", store), false);
  store.setRole(user.id, organizationA, "OWNER");
  assert.equal(await can(user, organizationA, "MANAGE_ORGANIZATION_OWNERSHIP", store), true);

  assert.equal(await can(null, organizationA, "VIEW_ORGANIZATION", store), false);
  assert.equal(await can(user, undefined, "VIEW_ORGANIZATION", store), false);
});

test("database lookup failures return no access and expose no database details", async () => {
  const store = new MemoryAuthorizationStore();
  store.failLookups = true;

  await assert.rejects(
    requireOrganizationMembership(user, organizationA, store),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "authorization_unavailable");
      assert.equal(error.status, 503);
      assert.equal(error.message.includes("database connection details"), false);
      return true;
    },
  );
  assert.equal(await can(user, organizationA, "VIEW_ORGANIZATION", store), false);
});

test("unknown stored roles fail closed", async () => {
  const store = new MemoryAuthorizationStore();
  store.setRole(user.id, organizationA, "PLATFORM_ADMIN");

  await assert.rejects(
    requireOrganizationMembership(user, organizationA, store),
    expectAuthorizationError("authorization_unavailable", 503),
  );
});
