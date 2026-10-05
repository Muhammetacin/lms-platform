import assert from "node:assert/strict";
import test from "node:test";
import { readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  requireOrganizationPermission,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import {
  createEmployeeProfileHandlers,
  EmployeeNumberConflictError,
  parseEmployeeProfileUpdate,
  type EmployeeProfile,
  type EmployeeProfileRecord,
  type EmployeeProfileStore,
  type EmployeeProfileUpdate,
} from "../src/lib/employee-profile-core.ts";
import {
  resolveTenantContext,
  type TenantMembershipStore,
} from "../src/lib/tenant-context-core.ts";

const orgA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const orgB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const owner: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "owner@example.com",
  name: "Organization Owner",
};
const admin: AuthenticatedUser = {
  id: "6aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "admin@example.com",
  name: "Organization Admin",
};
const member: AuthenticatedUser = {
  id: "4aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "member@example.com",
  name: "Member User",
};
const otherMember: AuthenticatedUser = {
  id: "7aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "other@example.com",
  name: "Other User",
};
const employeeA = "bc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const employeeB = "3efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const employeeC = "9efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const employeeD = "ae0d8a4d-881f-4f95-a86c-01c7f2797cae";

type Membership = EmployeeProfileRecord & { organizationId: string };

class MemoryProfileStore implements EmployeeProfileStore, TenantMembershipStore, AuthorizationStore {
  readonly memberships = new Map<string, Membership>();
  fail = false;
  failProfile = false;

  add(
    id: string,
    organizationId: string,
    user: AuthenticatedUser,
    role: EmployeeProfile["role"],
    fields: Partial<Pick<EmployeeProfile, "employeeName" | "jobTitle" | "department" | "phone" | "employeeNumber" | "active">> = {},
  ) {
    this.memberships.set(id, {
      id,
      userId: user.id,
      organizationId,
      email: user.email,
      employeeName: fields.employeeName ?? "Member Name",
      jobTitle: fields.jobTitle ?? null,
      department: fields.department ?? null,
      phone: fields.phone ?? null,
      employeeNumber: fields.employeeNumber ?? null,
      role,
      active: fields.active ?? true,
    });
  }

  private check() {
    if (this.fail) throw new Error("database connection details must not escape");
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
    const membership = [...this.memberships.values()].find((item) =>
      item.userId === userId && item.active,
    );
    return membership ? { organizationId: membership.organizationId, role: membership.role } : null;
  }

  async getProfile(organizationId: string, employeeId: string) {
    this.check();
    if (this.failProfile) throw new Error("profile storage connection details must not escape");
    const record = this.memberships.get(employeeId);
    if (!record || record.organizationId !== organizationId) return null;
    return { ...record };
  }

  async updateProfile(
    organizationId: string,
    employeeId: string,
    update: EmployeeProfileUpdate,
  ) {
    this.check();
    if (this.failProfile) throw new Error("profile storage connection details must not escape");
    const record = this.memberships.get(employeeId);
    if (!record || record.organizationId !== organizationId) return null;
    if (
      update.employeeNumber !== undefined &&
      update.employeeNumber !== null &&
      [...this.memberships.values()].some((item) =>
        item.id !== employeeId &&
        item.organizationId === organizationId &&
        item.employeeNumber === update.employeeNumber,
      )
    ) throw new EmployeeNumberConflictError();

    if (update.employeeName !== undefined) record.employeeName = update.employeeName;
    if (update.jobTitle !== undefined) record.jobTitle = update.jobTitle;
    if (update.department !== undefined) record.department = update.department;
    if (update.phone !== undefined) record.phone = update.phone;
    if (update.employeeNumber !== undefined) record.employeeNumber = update.employeeNumber;
    return { ...record };
  }
}

function makeHandlers(store: MemoryProfileStore, user: AuthenticatedUser | null, organizationId: string) {
  return createEmployeeProfileHandlers({
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

function request(method: string, value?: unknown, url = "https://lms.example.test/api/organizations/employees/profile") {
  return new Request(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-organization-id": orgB,
      "x-organization-role": "OWNER",
    },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

async function responseProfile(response: Response): Promise<EmployeeProfile> {
  return (await response.json() as { profile: EmployeeProfile }).profile;
}

test("unauthenticated profile reads and updates return 401", async () => {
  const store = new MemoryProfileStore();
  const handlers = makeHandlers(store, null, orgA);
  assert.equal((await handlers.GET(employeeA)).status, 401);
  assert.equal((await handlers.PATCH(request("PATCH", { phone: "123" }), employeeA)).status, 401);
});

test("OWNER and ADMIN can read and update any profile within their organization", async () => {
  const store = new MemoryProfileStore();
  store.add(employeeA, orgA, owner, "OWNER", { employeeName: "Owner Name" });
  store.add(employeeB, orgA, admin, "ADMIN", { employeeName: "Admin Name" });
  store.add(employeeC, orgA, member, "MEMBER", { employeeName: "Member Name" });

  const ownerHandlers = makeHandlers(store, owner, orgA);
  const ownerRead = await ownerHandlers.GET(employeeC);
  assert.equal(ownerRead.status, 200);
  assert.equal(ownerRead.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(await responseProfile(ownerRead)).sort(), [
    "active", "department", "email", "employeeName", "employeeNumber", "id", "jobTitle", "phone", "role",
  ]);
  assert.equal((await ownerHandlers.PATCH(request("PATCH", {
    employeeName: "Updated Member",
    jobTitle: "Teacher",
    department: "Learning",
    phone: "+1 (425) 555-0130",
    employeeNumber: " EMP-001 ",
  }), employeeC)).status, 200);
  assert.equal((await store.getProfile(orgA, employeeC))?.employeeNumber, "EMP-001");

  const adminHandlers = makeHandlers(store, admin, orgA);
  assert.equal((await adminHandlers.GET(employeeA)).status, 200);
  assert.equal((await adminHandlers.PATCH(request("PATCH", { department: "People" }), employeeA)).status, 200);
  assert.equal((await store.getProfile(orgA, employeeA))?.department, "People");
});

test("MEMBER can read and edit only their own permitted profile fields", async () => {
  const store = new MemoryProfileStore();
  store.add(employeeA, orgA, member, "MEMBER", { employeeName: "Member Name", employeeNumber: "MEM-001" });
  store.add(employeeB, orgA, otherMember, "MEMBER", { employeeName: "Other Name" });
  const handlers = makeHandlers(store, member, orgA);

  assert.equal((await handlers.GET(employeeA)).status, 200);
  assert.equal((await handlers.GET(employeeB)).status, 404);
  assert.equal((await handlers.PATCH(request("PATCH", {
    employeeName: "Updated Member",
    jobTitle: "Instructor",
    department: "Learning",
    phone: "+32 2 555 01 23",
  }), employeeA)).status, 200);
  assert.deepEqual(
    {
      employeeName: (await store.getProfile(orgA, employeeA))?.employeeName,
      jobTitle: (await store.getProfile(orgA, employeeA))?.jobTitle,
      department: (await store.getProfile(orgA, employeeA))?.department,
      phone: (await store.getProfile(orgA, employeeA))?.phone,
      employeeNumber: (await store.getProfile(orgA, employeeA))?.employeeNumber,
    },
    {
      employeeName: "Updated Member",
      jobTitle: "Instructor",
      department: "Learning",
      phone: "+32 2 555 01 23",
      employeeNumber: "MEM-001",
    },
  );

  const otherBefore = await store.getProfile(orgA, employeeB);
  assert.equal((await handlers.PATCH(request("PATCH", { phone: "Stolen" }), employeeB)).status, 404);
  assert.deepEqual(await store.getProfile(orgA, employeeB), otherBefore);
});

test("PATCH rejects identity, role, lifecycle, tenant, and MEMBER employee-number tampering", async () => {
  const store = new MemoryProfileStore();
  store.add(employeeA, orgA, member, "MEMBER", { employeeNumber: "MEM-001" });
  const handlers = makeHandlers(store, member, orgA);
  const forbidden = [
    { email: "attacker@example.com" },
    { role: "OWNER" },
    { active: false },
    { organizationId: orgB },
    { tenantId: orgB },
    { userId: owner.id },
    { id: employeeB },
    { employeeNumber: "MEM-999" },
  ];

  for (const input of forbidden) {
    assert.equal((await handlers.PATCH(request("PATCH", input), employeeA)).status, 400);
  }
  assert.equal((await store.getProfile(orgA, employeeA))?.email, member.email);
  assert.equal((await store.getProfile(orgA, employeeA))?.role, "MEMBER");
  assert.equal((await store.getProfile(orgA, employeeA))?.active, true);
  assert.equal((await store.getProfile(orgA, employeeA))?.employeeNumber, "MEM-001");
});

test("cross-tenant reads and updates match missing-ID behavior and ignore forged tenant headers", async () => {
  const store = new MemoryProfileStore();
  store.add(employeeA, orgA, owner, "OWNER");
  store.add(employeeB, orgB, otherMember, "MEMBER", { employeeName: "Tenant B Name" });
  const handlersA = makeHandlers(store, owner, orgA);

  const foreignRead = await handlersA.GET(employeeB);
  const unknownRead = await handlersA.GET(employeeC);
  assert.equal(foreignRead.status, 404);
  assert.deepEqual(await foreignRead.json(), await unknownRead.json());

  const foreignBefore = await store.getProfile(orgB, employeeB);
  assert.equal((await handlersA.PATCH(request("PATCH", { employeeName: "Tampered" }), employeeB)).status, 404);
  assert.deepEqual(await store.getProfile(orgB, employeeB), foreignBefore);
  assert.equal((await handlersA.PATCH(request("PATCH", { employeeName: "Tampered", organizationId: orgB }), employeeA)).status, 400);
  assert.equal((await store.getProfile(orgA, employeeA))?.employeeName, "Member Name");
});

test("profile validation trims bounded values, permits null clearing, and rejects blanks or malformed input", async () => {
  assert.deepEqual(parseEmployeeProfileUpdate({
    employeeName: " Updated Name ",
    jobTitle: " Teacher ",
    department: " Learning ",
    phone: "Extension 8",
    employeeNumber: " EMP-001 ",
  }, true), {
    employeeName: "Updated Name",
    jobTitle: "Teacher",
    department: "Learning",
    phone: "Extension 8",
    employeeNumber: "EMP-001",
  });
  assert.deepEqual(parseEmployeeProfileUpdate({ jobTitle: null, department: null, phone: null, employeeNumber: null }, true), {
    jobTitle: null,
    department: null,
    phone: null,
    employeeNumber: null,
  });
  for (const value of [
    null,
    [],
    {},
    { employeeName: "x" },
    { employeeName: "x".repeat(121) },
    { jobTitle: "   " },
    { jobTitle: "x".repeat(121) },
    { department: 123 },
    { department: "x".repeat(121) },
    { phone: "" },
    { phone: "x".repeat(121) },
    { jobTitle: "Bad\u0000Title" },
    { employeeNumber: 123 },
    { employeeNumber: "  " },
    { employeeNumber: "x".repeat(121) },
    { employeeName: "Valid Name", role: "OWNER" },
  ]) assert.equal(parseEmployeeProfileUpdate(value, true), null);
  assert.equal(parseEmployeeProfileUpdate({ employeeNumber: "EMP-001" }, false), null);

  const store = new MemoryProfileStore();
  store.add(employeeA, orgA, owner, "OWNER");
  const handlers = makeHandlers(store, owner, orgA);
  assert.equal((await handlers.PATCH(request("PATCH", { phone: "   " }), employeeA)).status, 400);
  assert.equal((await handlers.PATCH(request("PATCH", { phone: "x".repeat(121) }), employeeA)).status, 400);
  assert.equal((await handlers.PATCH(request("PATCH", { department: null }), employeeA)).status, 200);
  assert.equal((await store.getProfile(orgA, employeeA))?.department, null);
});

test("organization-local number collisions return 409 without changing the profile", async () => {
  const store = new MemoryProfileStore();
  store.add(employeeA, orgA, owner, "OWNER", { employeeNumber: "EMP-001" });
  store.add(employeeB, orgA, otherMember, "MEMBER", { employeeNumber: "EMP-002" });
  store.add(employeeD, orgB, admin, "ADMIN", { employeeNumber: "EMP-001" });
  const before = await store.getProfile(orgA, employeeB);
  const response = await makeHandlers(store, owner, orgA).PATCH(
    request("PATCH", { employeeNumber: " EMP-001 " }),
    employeeB,
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await store.getProfile(orgA, employeeB), before);
  assert.equal((await store.getProfile(orgB, employeeD))?.employeeNumber, "EMP-001");
});

test("storage errors return a generic profile error", async () => {
  const store = new MemoryProfileStore();
  store.add(employeeA, orgA, owner, "OWNER");
  store.failProfile = true;
  const response = await makeHandlers(store, owner, orgA).GET(employeeA);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "employee_profile_unavailable" });
});
