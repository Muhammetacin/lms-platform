import assert from "node:assert/strict";
import test from "node:test";
import { requireOrganizationPermission, type AuthorizationStore } from "../src/lib/authorization-core.ts";
import { readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  createTeamMembershipHandlers,
  parseTeamMemberAdd,
  TeamMembershipConflictError,
  TeamMembershipTargetNotFoundError,
  type TeamMember,
  type TeamMembershipStore,
} from "../src/lib/team-membership-core.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const owner: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "owner@example.com",
  name: "Organization Owner",
};
const orgA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const orgB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const teamA = "380645db-557b-4d1d-b294-fc65c92da9d3";
const teamB = "f646453b-b600-461f-9b44-c5d236ecdd58";
const employeeA = "b5299aa9-9ee5-43b1-88fd-27661a3f1888";
const employeeB = "9ed3bfae-a174-49e4-9645-3966c2c93043";
const employeeInactive = "3a4f435b-3e5a-4f48-9a0c-cf7e1a2ad75b";

type MemoryEmployee = TeamMember & { organizationId: string; active: boolean };

class MemoryStore implements TeamMembershipStore {
  readonly teams = new Map<string, string>();
  readonly employees = new Map<string, MemoryEmployee>();
  readonly links: Array<{ organizationId: string; teamId: string; employeeId: string }> = [];
  readonly scopes: Array<{ operation: string; organizationId: string; teamId: string; employeeId?: string }> = [];

  async list(organizationId: string, teamId: string) {
    this.scopes.push({ operation: "list", organizationId, teamId });
    if (this.teams.get(teamId) !== organizationId) return null;
    return this.links
      .filter((link) => link.organizationId === organizationId && link.teamId === teamId)
      .map((link) => this.employees.get(link.employeeId))
      .filter((employee): employee is MemoryEmployee => employee !== undefined && employee.active)
      .sort((left, right) => (left.employeeName ?? "").localeCompare(right.employeeName ?? "") || left.id.localeCompare(right.id))
      .map(toPublicEmployee);
  }

  async add(organizationId: string, teamId: string, employeeId: string) {
    this.scopes.push({ operation: "add", organizationId, teamId, employeeId });
    if (this.teams.get(teamId) !== organizationId) throw new TeamMembershipTargetNotFoundError("team");
    const employee = this.employees.get(employeeId);
    if (!employee || employee.organizationId !== organizationId || !employee.active) {
      throw new TeamMembershipTargetNotFoundError("employee");
    }
    if (this.links.some((link) => link.organizationId === organizationId && link.teamId === teamId && link.employeeId === employeeId)) {
      throw new TeamMembershipConflictError();
    }
    this.links.push({ organizationId, teamId, employeeId });
    return toPublicEmployee(employee);
  }

  async remove(organizationId: string, teamId: string, employeeId: string) {
    this.scopes.push({ operation: "remove", organizationId, teamId, employeeId });
    const index = this.links.findIndex((link) =>
      link.organizationId === organizationId && link.teamId === teamId && link.employeeId === employeeId,
    );
    if (index === -1) return false;
    this.links.splice(index, 1);
    return true;
  }
}

function toPublicEmployee(employee: MemoryEmployee): TeamMember {
  return {
    id: employee.id,
    email: employee.email,
    employeeName: employee.employeeName,
    jobTitle: employee.jobTitle,
    department: employee.department,
  };
}

class IdentityStore implements TenantMembershipStore, AuthorizationStore {
  readonly roles = new Map<string, "OWNER" | "ADMIN" | "MEMBER">();

  setRole(userId: string, organizationId: string, role: "OWNER" | "ADMIN" | "MEMBER") {
    this.roles.set(`${userId}:${organizationId}`, role);
  }

  async findOrganizationRole(userId: string, organizationId: string) {
    return this.roles.get(`${userId}:${organizationId}`) ?? null;
  }

  async findDefaultOrganizationMembership(userId: string) {
    const found = [...this.roles.entries()].find(([key]) => key.startsWith(`${userId}:`));
    return found ? { organizationId: found[0].slice(userId.length + 1), role: found[1] } : null;
  }
}

function request(method: string, value?: unknown, url = "https://lms.example.test/api/organizations/teams") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
}

function makeHandlers(store: MemoryStore, identity: AuthenticatedUser | null, memberships: IdentityStore) {
  return createTeamMembershipHandlers({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, memberships);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, memberships);
    },
    store,
    isTrustedRequest: () => true,
    readBody: (incoming) => readJsonBody(incoming),
    logError: () => {},
  });
}

function setup(role: "OWNER" | "ADMIN" | "MEMBER" = "OWNER") {
  const identities = new IdentityStore();
  identities.setRole(owner.id, orgA, role);
  const store = new MemoryStore();
  store.teams.set(teamA, orgA);
  store.teams.set(teamB, orgB);
  store.employees.set(employeeA, {
    id: employeeA,
    organizationId: orgA,
    email: "employee-a@example.test",
    employeeName: "Alice A",
    jobTitle: "Teacher",
    department: "Math",
    active: true,
  });
  store.employees.set(employeeB, {
    id: employeeB,
    organizationId: orgB,
    email: "employee-b@example.test",
    employeeName: "Bob B",
    jobTitle: null,
    department: null,
    active: true,
  });
  store.employees.set(employeeInactive, {
    id: employeeInactive,
    organizationId: orgA,
    email: "inactive@example.test",
    employeeName: "Inactive Employee",
    jobTitle: null,
    department: null,
    active: false,
  });
  return { identities, store, handlers: makeHandlers(store, owner, identities) };
}

test("add request accepts only a valid OrganizationMembership employeeId", () => {
  assert.deepEqual(parseTeamMemberAdd({ employeeId: employeeA }), { employeeId: employeeA });
  assert.equal(parseTeamMemberAdd({ employeeId: "not-a-uuid" }), null);
  for (const field of ["organizationId", "tenantId", "teamId", "userId", "role", "active", "other"]) {
    assert.equal(parseTeamMemberAdd({ employeeId: employeeA, [field]: orgB }), null);
  }
  assert.equal(parseTeamMemberAdd({}), null);
  assert.equal(parseTeamMemberAdd(null), null);
  assert.equal(parseTeamMemberAdd([employeeA]), null);
});

test("OWNER, ADMIN, and MEMBER can read active members; only OWNER and ADMIN can mutate", async () => {
  for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
    const { store, handlers } = setup(role);
    store.links.push({ organizationId: orgA, teamId: teamA, employeeId: employeeA });
    store.links.push({ organizationId: orgA, teamId: teamA, employeeId: employeeInactive });

    const listing = await handlers.GET(teamA);
    assert.equal(listing.status, 200);
    assert.deepEqual(await listing.json(), {
      members: [{
        id: employeeA,
        email: "employee-a@example.test",
        employeeName: "Alice A",
        jobTitle: "Teacher",
        department: "Math",
      }],
    });
    assert.equal((await handlers.POST(request("POST", { employeeId: employeeA }), teamA)).status, role === "MEMBER" ? 403 : 409);
    assert.equal((await handlers.POST(request("POST", { employeeId: employeeA }), teamA)).status, role === "MEMBER" ? 403 : 409);
    assert.equal((await handlers.DELETE(request("DELETE"), teamA, employeeA)).status, role === "MEMBER" ? 403 : 200);
    if (role !== "MEMBER") {
      assert.equal((await handlers.DELETE(request("DELETE"), teamA, employeeA)).status, 404);
    }
  }
});

test("OWNER and ADMIN add active employees; inactive employees and duplicate adds are rejected", async () => {
  for (const role of ["OWNER", "ADMIN"] as const) {
    const { store, handlers } = setup(role);
    const added = await handlers.POST(request("POST", { employeeId: employeeA }), teamA);
    assert.equal(added.status, 201);
    assert.deepEqual(await added.json(), {
      member: {
        id: employeeA,
        email: "employee-a@example.test",
        employeeName: "Alice A",
        jobTitle: "Teacher",
        department: "Math",
      },
    });
    assert.equal(store.links.length, 1);
    const duplicate = await handlers.POST(request("POST", { employeeId: employeeA }), teamA);
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: "team_membership_conflict" });
    assert.equal((await handlers.POST(request("POST", { employeeId: employeeInactive }), teamA)).status, 404);
    assert.equal(store.links.length, 1);
  }
});

test("tenant boundaries make foreign Teams and employees indistinguishable from missing targets", async () => {
  const { store, handlers } = setup();
  const foreignTeam = await handlers.POST(request("POST", { employeeId: employeeB }), teamB);
  const foreignEmployee = await handlers.POST(request("POST", { employeeId: employeeB }), teamA);
  const missingEmployee = await handlers.POST(request("POST", { employeeId: "b3f5c550-48d4-43ef-8b48-1ee57904e301" }), teamA);
  assert.equal(foreignTeam.status, 404);
  assert.deepEqual(await foreignTeam.json(), { error: "team_not_found" });
  assert.equal(foreignEmployee.status, 404);
  assert.deepEqual(await foreignEmployee.json(), await missingEmployee.json());
  assert.equal((await handlers.POST(request("POST", { employeeId: employeeA }), "bad-id")).status, 404);
  assert.equal((await handlers.GET(teamB)).status, 404);
  assert.equal((await handlers.GET("bad-id")).status, 404);

  store.links.push({ organizationId: orgB, teamId: teamB, employeeId: employeeB });
  const getForeignTeam = await handlers.GET(teamB);
  const getMissingTeam = await handlers.GET("d8c31936-9988-42bc-b821-7716f28e6767");
  assert.equal(getForeignTeam.status, 404);
  assert.deepEqual(await getForeignTeam.json(), await getMissingTeam.json());

  const foreignDelete = await handlers.DELETE(request("DELETE"), teamA, employeeB);
  const missingDelete = await handlers.DELETE(request("DELETE"), teamA, employeeB);
  assert.equal(foreignDelete.status, 404);
  const foreignDeleteBody = await foreignDelete.json();
  assert.deepEqual(foreignDeleteBody, { error: "team_membership_not_found" });
  assert.deepEqual(foreignDeleteBody, await missingDelete.json());
  assert.equal((await handlers.DELETE(request("DELETE"), "bad-id", employeeA)).status, 404);
  assert.deepEqual(store.scopes.filter(({ operation }) => operation !== "list").map(({ organizationId }) => organizationId), [orgA, orgA, orgA, orgA, orgA]);
});

test("forged tenant fields, malformed employee IDs, and global User IDs are rejected", async () => {
  const { handlers } = setup();
  for (const field of ["organizationId", "tenantId", "teamId", "userId", "role", "active"]) {
    const response = await handlers.POST(request("POST", { employeeId: employeeA, [field]: orgB }), teamA);
    assert.equal(response.status, 400, `accepted ${field}`);
    assert.deepEqual(await response.json(), { error: "invalid_request" });
  }
  assert.equal((await handlers.POST(request("POST", { employeeId: "malformed" }), teamA)).status, 400);
  assert.equal((await handlers.DELETE(request("DELETE"), teamA, "malformed")).status, 404);
  assert.equal((await handlers.POST(request("POST", { employeeId: owner.id }), teamA)).status, 404);
});

test("unauthenticated users are denied and storage failures return generic errors", async () => {
  const { store, identities, handlers } = setup();
  const anonymous = makeHandlers(store, null, identities);
  assert.equal((await anonymous.GET(teamA)).status, 401);
  assert.equal((await anonymous.POST(request("POST", { employeeId: employeeA }), teamA)).status, 401);

  store.list = async () => { throw new Error("private database detail"); };
  const unavailable = await handlers.GET(teamA);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: "team_membership_unavailable" });
});
