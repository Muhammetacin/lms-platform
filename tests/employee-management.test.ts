import assert from "node:assert/strict";
import test from "node:test";
import { readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  createEmployeeManagementHandlers,
  parseEmployeeCreate,
  parseEmployeeUpdate,
  type Employee,
  type EmployeeStore,
} from "../src/lib/employee-management-core.ts";
import type { AuthorizationStore } from "../src/lib/authorization-core.ts";
import { requireOrganizationPermission } from "../src/lib/authorization-core.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const owner: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "owner@example.com",
  name: "Organization Owner",
};
const member: AuthenticatedUser = {
  id: "4aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "member@example.com",
  name: "Member User",
};
const orgA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const orgB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const employeeA = "bc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const employeeB = "3efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const employeeC = "9efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";

type Membership = Employee & { organizationId: string; userId: string };

class MemoryStore implements EmployeeStore, TenantMembershipStore, AuthorizationStore {
  readonly memberships = new Map<string, Membership>();
  readonly identities = new Set<string>();
  fail = false;
  failEmployees = false;

  add(id: string, organizationId: string, user: AuthenticatedUser, role: Employee["role"], active = true) {
    this.identities.add(user.id);
    this.memberships.set(id, { id, organizationId, userId: user.id, email: user.email, name: user.name, role, active });
  }

  private check() {
    if (this.fail) throw new Error("database password must not be returned");
  }

  private view(item: Membership): Employee {
    return { id: item.id, email: item.email, name: item.name, role: item.role, active: item.active };
  }

  async findOrganizationRole(userId: string, organizationId: string) {
    this.check();
    const membership = [...this.memberships.values()].find((item) =>
      item.userId === userId && item.organizationId === organizationId && item.active,
    );
    return membership?.role ?? null;
  }

  async findDefaultOrganizationMembership(userId: string) {
    this.check();
    const membership = [...this.memberships.values()].find((item) => item.userId === userId && item.active);
    return membership ? { organizationId: membership.organizationId, role: membership.role } : null;
  }

  async list(organizationId: string) {
    if (this.failEmployees) throw new Error("database password must not be returned");
    this.check();
    return [...this.memberships.values()].filter((item) => item.organizationId === organizationId).map((item) => this.view(item));
  }

  async get(organizationId: string, employeeId: string) {
    this.check();
    const employee = this.memberships.get(employeeId);
    if (!employee || employee.organizationId !== organizationId) return null;
    return this.view(employee);
  }

  async create(organizationId: string, email: string, name: string) {
    this.check();
    if ([...this.memberships.values()].some((item) => item.organizationId === organizationId && item.email === email)) {
      throw new Error("employee already exists");
    }
    const created = { id: employeeC, email, name, active: true, role: "MEMBER" as const, organizationId, userId: email };
    this.memberships.set(created.id, created);
    this.identities.add(created.userId);
    return this.view(created);
  }

  async updateName(organizationId: string, employeeId: string, name: string) {
    this.check();
    const employee = this.memberships.get(employeeId);
    if (!employee || employee.organizationId !== organizationId) return null;
    employee.name = name;
    return this.view(employee);
  }

  async deactivate(organizationId: string, employeeId: string) {
    this.check();
    const employee = this.memberships.get(employeeId);
    if (!employee || employee.organizationId !== organizationId) return null;
    if (employee.active && employee.role === "OWNER" && [...this.memberships.values()].filter((item) => item.organizationId === organizationId && item.active && item.role === "OWNER").length < 2) {
      const { LastOwnerError } = await import("../src/lib/employee-management-core.ts");
      throw new LastOwnerError();
    }
    employee.active = false;
    return this.view(employee);
  }
}

function makeHandlers(store: MemoryStore, user: AuthenticatedUser | null, organizationId: string) {
  return createEmployeeManagementHandlers({
    async requireTenantContext() {
      return resolveTenantContext(user, organizationId, store);
    },
    async requirePermission(tenantId, permission) {
      return requireOrganizationPermission(user, tenantId, permission, store);
    },
    store,
    isTrustedRequest: () => true,
    readBody: readJsonBody,
    logError: () => {},
  });
}

function request(method: string, value?: unknown, url = "https://lms.example.test/api/organizations/employees") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

test("list, create, detail, update and deactivate use organization-scoped memberships", async () => {
  const store = new MemoryStore();
  store.add(employeeA, orgA, owner, "OWNER");
  store.add(employeeB, orgB, member, "MEMBER");
  const handlers = makeHandlers(store, owner, orgA);

  assert.deepEqual((await (await handlers.GET()).json() as { employees: Employee[] }).employees.map((item) => item.id), [employeeA]);
  assert.deepEqual((await (await makeHandlers(store, member, orgB).GET()).json() as { employees: Employee[] }).employees.map((item) => item.id), [employeeB]);
  assert.equal((await handlers.GET_ONE(employeeB)).status, 404);
  assert.equal((await makeHandlers(store, member, orgB).GET_ONE(employeeA)).status, 404);
  assert.equal((await handlers.PATCH(request("PATCH", { name: "Changed Name" }), employeeB)).status, 404);
  assert.equal((await handlers.DEACTIVATE(request("POST"), employeeB)).status, 404);
  assert.equal(store.memberships.get(employeeB)?.active, true);

  const created = await handlers.POST(request("POST", { email: "new@example.com", name: "New Employee" }));
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { employee: { id: employeeC, email: "new@example.com", name: "New Employee", active: true, role: "MEMBER" } });
  assert.equal(store.identities.has("new@example.com"), true);

  assert.equal((await handlers.GET_ONE(employeeA)).status, 200);
  assert.equal((await handlers.PATCH(request("PATCH", { name: "Updated Name" }), employeeA)).status, 200);
  const deactivated = await handlers.DEACTIVATE(request("POST"), employeeC);
  assert.equal(deactivated.status, 200);
  assert.equal((await deactivated.json() as { employee: Employee }).employee.active, false);
});

test("OWNER and ADMIN manage, MEMBER reads only, and unauthenticated operations return 401", async () => {
  for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
    const store = new MemoryStore();
    store.add(employeeA, orgA, owner, role);
    const handlers = makeHandlers(store, owner, orgA);
    assert.equal((await handlers.GET()).status, 200);
    assert.equal((await handlers.GET_ONE(employeeA)).status, 200);
    const expected = role === "MEMBER" ? 403 : 201;
    assert.equal((await handlers.POST(request("POST", { email: "new@example.com", name: "New Name" }))).status, expected);
    assert.equal((await handlers.PATCH(request("PATCH", { name: "Updated Name" }), employeeA)).status, role === "MEMBER" ? 403 : 200);
    assert.equal((await handlers.DEACTIVATE(request("POST"), employeeA)).status, role === "MEMBER" ? 403 : role === "OWNER" ? 409 : 200);
  }

  const store = new MemoryStore();
  for (const result of [
    await makeHandlers(store, null, orgA).GET(),
    await makeHandlers(store, null, orgA).GET_ONE(employeeA),
    await makeHandlers(store, null, orgA).POST(request("POST", { email: "new@example.com", name: "New Name" })),
    await makeHandlers(store, null, orgA).PATCH(request("PATCH", { name: "Updated Name" }), employeeA),
    await makeHandlers(store, null, orgA).DEACTIVATE(request("POST"), employeeA),
    await makeHandlers(store, null, orgA).GET_ONE("not-a-uuid"),
    await makeHandlers(store, null, orgA).PATCH(request("PATCH", { name: "Updated Name" }), "not-a-uuid"),
    await makeHandlers(store, null, orgA).DEACTIVATE(request("POST"), "not-a-uuid"),
  ]) assert.equal(result.status, 401);
});

test("owner-only permission protects owner membership lifecycle and last active owner", async () => {
  const store = new MemoryStore();
  store.add(employeeA, orgA, owner, "OWNER");
  const admin: AuthenticatedUser = { id: "6aa6d920-65d1-4d2e-97c0-7b236f40d8ef", email: "admin@example.com", name: "Admin" };
  store.add(employeeC, orgA, admin, "ADMIN");
  assert.equal((await makeHandlers(store, admin, orgA).DEACTIVATE(request("POST"), employeeA)).status, 403);
  assert.equal((await makeHandlers(store, owner, orgA).DEACTIVATE(request("POST"), employeeA)).status, 409);
  assert.equal(store.memberships.get(employeeA)?.active, true);
});

test("deactivation is organization-specific and leaves identity and other memberships intact", async () => {
  const store = new MemoryStore();
  store.add(employeeA, orgA, member, "MEMBER");
  store.add(employeeB, orgB, member, "ADMIN");
  const handlersA = makeHandlers(store, owner, orgA);
  store.add(employeeC, orgA, owner, "OWNER");
  assert.equal((await handlersA.DEACTIVATE(request("POST"), employeeA)).status, 200);
  assert.equal(store.memberships.get(employeeA)?.active, false);
  assert.equal(store.memberships.get(employeeB)?.active, true);
  assert.equal(store.identities.has(member.id), true);
  assert.equal(await store.findOrganizationRole(member.id, orgA), null);
  assert.equal(await store.findOrganizationRole(member.id, orgB), "ADMIN");
});

test("client tenant and role tampering is rejected and cannot change query scope", async () => {
  const store = new MemoryStore();
  store.add(employeeA, orgA, owner, "OWNER");
  store.add(employeeB, orgB, member, "MEMBER");
  const handlers = makeHandlers(store, owner, orgA);
  assert.equal((await handlers.POST(request("POST", { email: "new@example.com", name: "New Name", organizationId: orgB, role: "OWNER" }))).status, 400);
  assert.equal((await handlers.PATCH(request("PATCH", { name: "Name", organizationId: orgB, role: "OWNER" }), employeeA)).status, 400);
  const queryTamper = request("GET", undefined, `https://lms.example.test/api/organizations/employees?organizationId=${orgB}`);
  assert.deepEqual((await (await handlers.GET()).json() as { employees: Employee[] }).employees.map((item) => item.id), [employeeA]);
  assert.equal(queryTamper.url.includes(orgB), true);
  assert.equal((await handlers.GET_ONE("not-a-uuid")).status, 404);
});

test("strict validation rejects malformed emails, names, roles, IDs and payloads", () => {
  for (const value of [null, [], {}, { email: "bad", name: "Valid Name" }, { email: "x".repeat(250) + "@example.com", name: "Valid Name" }, { email: "valid@example.com", name: " " }, { email: "valid@example.com", name: "Bad\u0000Name" }, { email: "valid@example.com", name: "Valid Name", role: "OWNER" }]) {
    assert.equal(parseEmployeeCreate(value), null);
  }
  assert.deepEqual(parseEmployeeCreate({ email: "  Valid@example.com ", name: " Valid Name " }), { email: "Valid@example.com", name: "Valid Name" });
  for (const value of [null, [], {}, { name: "x" }, { name: "Valid Name", active: false }, { name: "Valid\u0000Name" }]) assert.equal(parseEmployeeUpdate(value), null);
  assert.deepEqual(parseEmployeeUpdate({ name: " Updated Name " }), { name: "Updated Name" });
});

test("database errors return generic responses", async () => {
  const store = new MemoryStore();
  store.add(employeeA, orgA, owner, "OWNER");
  store.failEmployees = true;
  const response = await makeHandlers(store, owner, orgA).GET();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "employee_management_unavailable" });
});
