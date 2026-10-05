import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthorizationError,
  requireOrganizationPermission,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import { readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  createOrganizationSettingsHandlers,
  parseOrganizationSettingsUpdate,
  type OrganizationSettingsStore,
} from "../src/lib/organization-settings-core.ts";
import {
  resolveTenantContext,
  type TenantMembershipStore,
} from "../src/lib/tenant-context-core.ts";

const user: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "owner@example.com",
  name: "Organization Owner",
};
const organizationA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const organizationB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";

class MemoryStore implements TenantMembershipStore, AuthorizationStore, OrganizationSettingsStore {
  readonly roles = new Map<string, string>();
  readonly organizations = new Map<string, { name: string; slug: string }>();
  readonly accesses: Array<{ operation: string; organizationId: string }> = [];

  addOrganization(id: string, role: string, name: string, slug: string) {
    this.roles.set(`${user.id}:${id}`, role);
    this.organizations.set(id, { name, slug });
  }

  async findOrganizationRole(userId: string, organizationId: string) {
    return (this.roles.get(`${userId}:${organizationId}`) as
      | "OWNER"
      | "ADMIN"
      | "MEMBER"
      | undefined) ?? null;
  }

  async findDefaultOrganizationMembership(userId: string) {
    const membership = [...this.roles.entries()].find(([key]) =>
      key.startsWith(`${userId}:`),
    );
    if (!membership) return null;
    return {
      organizationId: membership[0].slice(userId.length + 1),
      role: membership[1] as "OWNER" | "ADMIN" | "MEMBER",
    };
  }

  async findSettings(organizationId: string) {
    this.accesses.push({ operation: "read", organizationId });
    return this.organizations.get(organizationId) ?? null;
  }

  async updateName(organizationId: string, name: string) {
    this.accesses.push({ operation: "update", organizationId });
    const organization = this.organizations.get(organizationId);
    if (!organization) return null;
    const updated = { ...organization, name };
    this.organizations.set(organizationId, updated);
    return updated;
  }
}

function makeHandlers(
  store: MemoryStore,
  authenticatedUser: AuthenticatedUser | null = user,
) {
  return createOrganizationSettingsHandlers({
    async requireTenantContext() {
      return resolveTenantContext(authenticatedUser, undefined, store);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(
        authenticatedUser,
        organizationId,
        permission,
        store,
      );
    },
    store,
    isTrustedRequest: () => true,
    readBody: readJsonBody,
    logError: () => {},
  });
}

function patch(body: string, url = "https://lms.example.test/api/organizations/settings") {
  return new Request(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  });
}

test("OWNER, ADMIN, and MEMBER can read settings through trusted default context", async () => {
  for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
    const store = new MemoryStore();
    store.addOrganization(organizationA, role, "Acme Learning", "acme");
    const response = await makeHandlers(store).GET();

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      organization: { name: "Acme Learning", slug: "acme" },
    });
    assert.deepEqual(store.accesses, [{ operation: "read", organizationId: organizationA }]);
  }
});

test("OWNER and ADMIN can update the name; MEMBER is denied", async () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    const store = new MemoryStore();
    store.addOrganization(organizationA, role, "Acme Learning", "acme");
    const response = await makeHandlers(store).PATCH(patch('{"name":"  North Campus  "}'));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      organization: { name: "North Campus", slug: "acme" },
    });
    assert.deepEqual(store.accesses, [{ operation: "update", organizationId: organizationA }]);
  }

  const store = new MemoryStore();
  store.addOrganization(organizationA, "MEMBER", "Acme Learning", "acme");
  const response = await makeHandlers(store).PATCH(patch('{"name":"North Campus"}'));
  assert.equal(response.status, 403);
  assert.deepEqual(store.accesses, []);
});

test("unauthenticated reads and updates return 401", async () => {
  const store = new MemoryStore();
  const handlers = makeHandlers(store, null);
  assert.equal((await handlers.GET()).status, 401);
  assert.equal((await handlers.PATCH(patch('{"name":"North Campus"}'))).status, 401);
  assert.deepEqual(store.accesses, []);
});

test("queries and client-supplied organization IDs cannot switch tenant", async () => {
  const store = new MemoryStore();
  store.addOrganization(organizationA, "ADMIN", "Alpha", "alpha");
  store.addOrganization(organizationB, "OWNER", "Beta", "beta");

  const response = await makeHandlers(store).PATCH(
    patch('{"name":"Changed","organizationId":"' + organizationB + '"}',
      `https://lms.example.test/api/organizations/settings?organizationId=${organizationB}`),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(store.accesses, []);
  assert.equal(store.organizations.get(organizationA)?.name, "Alpha");
  assert.equal(store.organizations.get(organizationB)?.name, "Beta");
});

test("strict payload validation rejects missing, malformed, empty, oversized, and extra fields", async () => {
  for (const value of [
    null,
    [],
    {},
    { name: 42 },
    { name: " " },
    { name: "A" },
    { name: "x".repeat(121) },
    { name: "Bad\u0000Name" },
    { name: "Name", slug: "new-slug" },
    { name: "Name", role: "OWNER" },
  ]) {
    assert.equal(parseOrganizationSettingsUpdate(value), null);
  }
  assert.deepEqual(parseOrganizationSettingsUpdate({ name: "  Valid Name " }), {
    name: "Valid Name",
  });

  const store = new MemoryStore();
  store.addOrganization(organizationA, "ADMIN", "Alpha", "alpha");
  const malformed = await makeHandlers(store).PATCH(patch("{"));
  const oversized = await makeHandlers(store).PATCH(
    patch(JSON.stringify({ name: "x".repeat(9000) })),
  );
  assert.equal(malformed.status, 400);
  assert.equal(oversized.status, 400);
});

test("same-origin JSON protection blocks untrusted PATCH requests", async () => {
  const store = new MemoryStore();
  store.addOrganization(organizationA, "OWNER", "Alpha", "alpha");
  const handlers = createOrganizationSettingsHandlers({
    async requireTenantContext() {
      return resolveTenantContext(user, undefined, store);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(user, organizationId, permission, store);
    },
    store,
    isTrustedRequest: () => false,
    readBody: readJsonBody,
    logError: () => {},
  });

  const response = await handlers.PATCH(patch('{"name":"Changed"}'));
  assert.equal(response.status, 403);
  assert.deepEqual(store.accesses, []);
});

test("unexpected storage errors return generic responses without leaking details", async () => {
  const store = new MemoryStore();
  store.addOrganization(organizationA, "OWNER", "Alpha", "alpha");
  store.findSettings = async () => {
    throw new Error("database-password must not be returned");
  };

  const response = await makeHandlers(store).GET();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "organization_settings_unavailable",
  });
});

test("unavailable authorization fails closed", async () => {
  const store = new MemoryStore();
  store.addOrganization(organizationA, "OWNER", "Alpha", "alpha");
  const handlers = createOrganizationSettingsHandlers({
    async requireTenantContext() {
      return resolveTenantContext(user, undefined, store);
    },
    async requirePermission() {
      throw new AuthorizationError("authorization_unavailable");
    },
    store,
    isTrustedRequest: () => true,
    readBody: readJsonBody,
    logError: () => {},
  });

  assert.equal((await handlers.GET()).status, 503);
  assert.deepEqual(store.accesses, []);
});
