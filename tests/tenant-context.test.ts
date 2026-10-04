import assert from "node:assert/strict";
import test from "node:test";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  resolveTenantContext,
  TenantContextError,
  type DefaultOrganizationMembership,
  type TenantMembershipStore,
} from "../src/lib/tenant-context-core.ts";

const user: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "learner@example.com",
  name: "A Learner",
};
const organizationA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const organizationB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const organizationC = "b21c8475-3588-41a6-9c33-c5a1b9ec1dc1";
const otherUserId = "df816a4b-113e-4c13-a7fb-6358684f8ab6";

type MemoryMembership = DefaultOrganizationMembership & { createdAt: Date };

class MemoryTenantMembershipStore implements TenantMembershipStore {
  readonly memberships = new Map<string, MemoryMembership>();
  readonly lookups: Array<{ userId: string; organizationId: string }> = [];
  failLookups = false;

  addMembership(
    userId: string,
    organizationId: string,
    role: string,
    createdAt: string,
  ) {
    this.memberships.set(`${userId}:${organizationId}`, {
      organizationId,
      role: role as DefaultOrganizationMembership["role"],
      createdAt: new Date(createdAt),
    });
  }

  async findOrganizationRole(userId: string, organizationId: string) {
    this.lookups.push({ userId, organizationId });
    if (this.failLookups) {
      throw new Error("database connection string must not escape");
    }
    return this.memberships.get(`${userId}:${organizationId}`)?.role ?? null;
  }

  async findDefaultOrganizationMembership(userId: string) {
    if (this.failLookups) {
      throw new Error("database connection string must not escape");
    }

    const memberships = [...this.memberships.entries()]
      .filter(([key]) => key.startsWith(`${userId}:`))
      .map(([, membership]) => membership);
    memberships.sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.organizationId.localeCompare(right.organizationId),
    );

    const membership = memberships[0];
    if (!membership) return null;
    return { organizationId: membership.organizationId, role: membership.role };
  }
}

function expectTenantContextError(
  code:
    | "unauthenticated"
    | "no_organization_membership"
    | "invalid_organization_context"
    | "tenant_context_unavailable",
  status: 401 | 403 | 503,
) {
  return (error: unknown) => {
    assert.ok(error instanceof TenantContextError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  };
}

test("rejects unauthenticated identity and reports a user with no memberships", async () => {
  const store = new MemoryTenantMembershipStore();

  await assert.rejects(
    resolveTenantContext(null, undefined, store),
    expectTenantContextError("unauthenticated", 401),
  );
  await assert.rejects(
    resolveTenantContext(user, undefined, store),
    expectTenantContextError("no_organization_membership", 403),
  );
});

test("resolves a user's single organization and returns only trusted context", async () => {
  const store = new MemoryTenantMembershipStore();
  store.addMembership(user.id, organizationA, "MEMBER", "2026-10-04T10:00:00.000Z");

  const context = await resolveTenantContext(user, undefined, store);
  assert.deepEqual(context, {
    userId: user.id,
    organizationId: organizationA,
    role: "MEMBER",
  });
  assert.deepEqual(Object.keys(context).sort(), ["organizationId", "role", "userId"]);
});

test("accepts valid explicit memberships for either of multiple organizations", async () => {
  const store = new MemoryTenantMembershipStore();
  store.addMembership(user.id, organizationA, "MEMBER", "2026-10-04T10:00:00.000Z");
  store.addMembership(user.id, organizationB, "OWNER", "2026-10-04T11:00:00.000Z");

  const contextA = await resolveTenantContext(user, organizationA, store);
  const contextB = await resolveTenantContext(user, organizationB, store);

  assert.deepEqual(contextA, {
    userId: user.id,
    organizationId: organizationA,
    role: "MEMBER",
  });
  assert.deepEqual(contextB, {
    userId: user.id,
    organizationId: organizationB,
    role: "OWNER",
  });
  assert.notEqual(contextA.organizationId, contextB.organizationId);
  assert.deepEqual(store.lookups, [
    { userId: user.id, organizationId: organizationA },
    { userId: user.id, organizationId: organizationB },
  ]);
});

test("uses the selected membership's stored role and ignores a client role claim", async () => {
  const store = new MemoryTenantMembershipStore();
  store.addMembership(user.id, organizationA, "ADMIN", "2026-10-04T10:00:00.000Z");
  const forgedIdentity = { ...user, role: "OWNER" } as AuthenticatedUser;

  const context = await resolveTenantContext(forgedIdentity, organizationA, store);
  assert.equal(context.role, "ADMIN");
});

test("rejects forged, non-member, and malformed organization candidates without fallback", async () => {
  const store = new MemoryTenantMembershipStore();
  store.addMembership(user.id, organizationA, "MEMBER", "2026-10-04T10:00:00.000Z");
  store.addMembership(user.id, organizationB, "OWNER", "2026-10-04T11:00:00.000Z");
  store.addMembership(otherUserId, organizationC, "OWNER", "2026-10-04T09:00:00.000Z");

  await assert.rejects(
    resolveTenantContext(user, organizationC, store),
    expectTenantContextError("invalid_organization_context", 403),
  );
  for (const candidate of [null, "", "not-a-uuid"]) {
    await assert.rejects(
      resolveTenantContext(user, candidate, store),
      expectTenantContextError("invalid_organization_context", 403),
    );
  }
  assert.deepEqual(store.lookups, [{ userId: user.id, organizationId: organizationC }]);
});

test("missing organization selects the deterministic oldest membership", async () => {
  const store = new MemoryTenantMembershipStore();
  store.addMembership(user.id, organizationC, "ADMIN", "2026-10-04T11:00:00.000Z");
  store.addMembership(user.id, organizationA, "MEMBER", "2026-10-04T10:00:00.000Z");
  store.addMembership(user.id, organizationB, "OWNER", "2026-10-04T10:00:00.000Z");

  const context = await resolveTenantContext(user, undefined, store);
  assert.equal(context.organizationId, organizationB);
  assert.equal(context.role, "OWNER");
});

test("membership lookup failures fail closed without exposing database details", async () => {
  const store = new MemoryTenantMembershipStore();
  store.failLookups = true;

  await assert.rejects(
    resolveTenantContext(user, organizationA, store),
    (error: unknown) => {
      assert.ok(error instanceof TenantContextError);
      assert.equal(error.code, "tenant_context_unavailable");
      assert.equal(error.status, 503);
      assert.equal(error.message.includes("database connection string"), false);
      return true;
    },
  );
  await assert.rejects(
    resolveTenantContext(user, undefined, store),
    expectTenantContextError("tenant_context_unavailable", 503),
  );
});

test("unknown membership roles fail closed", async () => {
  const store = new MemoryTenantMembershipStore();
  store.addMembership(user.id, organizationA, "PLATFORM_ADMIN", "2026-10-04T10:00:00.000Z");

  await assert.rejects(
    resolveTenantContext(user, organizationA, store),
    expectTenantContextError("tenant_context_unavailable", 503),
  );
});
