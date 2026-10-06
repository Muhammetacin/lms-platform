import assert from "node:assert/strict";
import test from "node:test";
import {
  requireOrganizationPermission,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import { readJsonBody, type AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  createTeamHandlers,
  parseTeamCreate,
  parseTeamUpdate,
  TeamNameConflictError,
  type Team,
  type TeamCreate,
  type TeamStore,
  type TeamUpdate,
} from "../src/lib/team-core.ts";
import {
  resolveTenantContext,
  type TenantMembershipStore,
} from "../src/lib/tenant-context-core.ts";

const owner: AuthenticatedUser = {
  id: "5aa6d920-65d1-4d2e-97c0-7b236f40d8ef",
  email: "owner@example.com",
  name: "Organization Owner",
};
const orgA = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const orgB = "2efc943b-32ac-4af9-8db7-8d5bfa9cc6aa";
const teamA = "380645db-557b-4d1d-b294-fc65c92da9d3";
const teamB = "f646453b-b600-461f-9b44-c5d236ecdd58";

function withoutOrganization(team: Team & { organizationId: string }): Team {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

class MemoryStore implements TeamStore {
  readonly teams = new Map<string, Team & { organizationId: string }>();
  readonly scopes: Array<{ operation: string; organizationId: string; teamId?: string }> = [];
  private sequence = 0;

  async list(organizationId: string) {
    this.scopes.push({ operation: "list", organizationId });
    return [...this.teams.values()]
      .filter((team) => team.organizationId === organizationId)
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      .map(withoutOrganization);
  }

  async get(organizationId: string, teamId: string) {
    this.scopes.push({ operation: "get", organizationId, teamId });
    const team = this.teams.get(teamId);
    if (!team || team.organizationId !== organizationId) return null;
    return withoutOrganization(team);
  }

  async create(organizationId: string, input: TeamCreate) {
    this.scopes.push({ operation: "create", organizationId });
    if ([...this.teams.values()].some((team) => team.organizationId === organizationId && team.name === input.name)) {
      throw new TeamNameConflictError();
    }
    const now = new Date();
    const id = `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, "0")}`;
    const team = { id, ...input, organizationId, createdAt: now, updatedAt: now };
    this.teams.set(id, team);
    return withoutOrganization(team);
  }

  async update(organizationId: string, teamId: string, input: TeamUpdate) {
    this.scopes.push({ operation: "update", organizationId, teamId });
    const prior = this.teams.get(teamId);
    if (!prior || prior.organizationId !== organizationId) return null;
    const name = input.name ?? prior.name;
    if ([...this.teams.values()].some((team) => team.id !== teamId && team.organizationId === organizationId && team.name === name)) {
      throw new TeamNameConflictError();
    }
    const updated = { ...prior, ...input, updatedAt: new Date() };
    this.teams.set(teamId, updated);
    return withoutOrganization(updated);
  }

  async delete(organizationId: string, teamId: string) {
    this.scopes.push({ operation: "delete", organizationId, teamId });
    const team = this.teams.get(teamId);
    if (!team || team.organizationId !== organizationId) return false;
    this.teams.delete(teamId);
    return true;
  }
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
    const membership = [...this.roles.entries()].find(([key]) => key.startsWith(`${userId}:`));
    if (!membership) return null;
    return {
      organizationId: membership[0].slice(userId.length + 1),
      role: membership[1],
    };
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
  return createTeamHandlers({
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

test("team create and update normalization enforce Unicode lengths and control characters", () => {
  assert.deepEqual(parseTeamCreate({ name: "  Sales  " }), { name: "Sales", description: null });
  assert.deepEqual(parseTeamCreate({ name: "😀😀" }), { name: "😀😀", description: null });
  assert.deepEqual(parseTeamCreate({ name: "Sales", description: "   " }), { name: "Sales", description: null });
  assert.deepEqual(parseTeamCreate({ name: "Sales", description: "  Commercial  " }), { name: "Sales", description: "Commercial" });
  assert.equal(parseTeamCreate({ name: " x " }), null);
  assert.equal(parseTeamCreate({ name: "   " }), null);
  assert.equal(parseTeamCreate({ name: `a${"x".repeat(120)}` }), null);
  assert.equal(parseTeamCreate({ name: "x".repeat(121) }), null);
  assert.deepEqual(parseTeamCreate({ name: "x".repeat(120) })?.name, "x".repeat(120));
  assert.equal(parseTeamCreate({ name: "Sales\u0000Team" }), null);
  assert.equal(parseTeamCreate({ name: "Sales\u0085Team" }), null);
  assert.equal(parseTeamCreate({ name: "Sales", description: "d".repeat(501) }), null);
  assert.deepEqual(parseTeamCreate({ name: "Sales", description: "d".repeat(500) })?.description, "d".repeat(500));
  assert.equal(parseTeamCreate({ name: "Sales", description: "bad\u0007text" }), null);
  assert.deepEqual(parseTeamUpdate({ description: null }), { description: null });
  assert.deepEqual(parseTeamUpdate({ description: "  " }), { description: null });
  assert.equal(parseTeamUpdate({}), null);
});

test("strict request allowlists reject tenant, ownership, role, and other fields", () => {
  for (const extra of ["organizationId", "tenantId", "ownerId", "role", "id", "createdAt", "updatedAt", "unknown"]) {
    assert.equal(parseTeamCreate({ name: "Sales", [extra]: orgB }), null, `create accepted ${extra}`);
    assert.equal(parseTeamUpdate({ name: "Support", [extra]: orgB }), null, `update accepted ${extra}`);
  }
  assert.equal(parseTeamCreate({ name: "Sales", description: undefined }), null);
  assert.equal(parseTeamUpdate({ description: undefined }), null);
  assert.equal(parseTeamUpdate({ name: "Valid", description: "a".repeat(501) }), null);
});

test("OWNER and ADMIN manage Teams while MEMBER can only read", async () => {
  for (const role of ["OWNER", "ADMIN", "MEMBER"] as const) {
    const memberships = new IdentityStore();
    memberships.setRole(owner.id, orgA, role);
    const store = new MemoryStore();
    store.teams.set(teamA, {
      id: teamA,
      organizationId: orgA,
      name: "Sales",
      description: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const handlers = makeHandlers(store, owner, memberships);

    assert.equal((await handlers.GET()).status, 200);
    assert.equal((await handlers.GET_ONE(teamA)).status, 200);
    assert.equal((await handlers.POST(request("POST", { name: "New Team" }))).status, role === "MEMBER" ? 403 : 201);
    assert.equal((await handlers.PATCH(request("PATCH", { name: "Updated" }), teamA)).status, role === "MEMBER" ? 403 : 200);
    assert.equal((await handlers.DELETE(request("DELETE"), teamA)).status, role === "MEMBER" ? 403 : 200);
  }
});

test("tenant-scoped reads, writes and deletes keep foreign and missing IDs indistinguishable", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  store.teams.set(teamA, {
    id: teamA,
    organizationId: orgA,
    name: "A Sales",
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  store.teams.set(teamB, {
    id: teamB,
    organizationId: orgB,
    name: "B Sales",
    description: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const handlers = makeHandlers(store, owner, memberships);
  const listing = await handlers.GET();
  assert.deepEqual((await listing.json() as { teams: Team[] }).teams.map(({ id }) => id), [teamA]);
  assert.equal(store.scopes[0]?.organizationId, orgA);
  const forgedTenantRequest = request("GET", undefined,
    `https://lms.example.test/api/organizations/teams?organizationId=${orgB}&tenantId=${orgB}`);
  const queryResult = await handlers.GET(forgedTenantRequest);
  assert.deepEqual((await queryResult.json() as { teams: Team[] }).teams.map(({ id }) => id), [teamA]);
  assert.equal((await handlers.GET_ONE(teamA)).status, 200);

  const foreignRead = await handlers.GET_ONE(teamB);
  const missingRead = await handlers.GET_ONE("ee16d3c5-4161-43ef-9df0-296e7ba8a46d");
  assert.equal(foreignRead.status, 404);
  assert.deepEqual(await foreignRead.json(), await missingRead.json());
  assert.equal((await handlers.PATCH(request("PATCH", { name: "Stolen" }), teamB)).status, 404);
  assert.equal((await handlers.DELETE(request("DELETE"), teamB)).status, 404);
  assert.equal(store.teams.get(teamB)?.name, "B Sales");
  assert.equal(store.teams.has(teamB), true);
  assert.deepEqual(store.scopes.filter(({ teamId }) => teamId === teamB).map(({ organizationId }) => organizationId), [orgA, orgA, orgA]);
});

test("client tenant fields cannot set ownership and authenticated members are required", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  const handlers = makeHandlers(store, owner, memberships);
  for (const field of ["organizationId", "tenantId", "ownerId", "role"]) {
    assert.equal((await handlers.POST(request("POST", { name: "Forged Team", [field]: orgB }))).status, 400);
    assert.equal((await handlers.PATCH(request("PATCH", { [field]: orgB }), teamA)).status, 400);
  }
  assert.equal(store.teams.size, 0);

  const anonymous = makeHandlers(store, null, memberships);
  assert.equal((await anonymous.GET()).status, 401);
  assert.equal((await anonymous.GET_ONE(teamA)).status, 401);
  assert.equal((await anonymous.POST(request("POST", { name: "Unauthorized" }))).status, 401);
});

test("duplicate names produce a conflict and case changes remain distinct", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  const handlers = makeHandlers(store, owner, memberships);
  assert.equal((await handlers.POST(request("POST", { name: "Sales" }))).status, 201);
  const duplicate = await handlers.POST(request("POST", { name: "Sales" }));
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: "team_name_conflict" });
  assert.equal((await handlers.POST(request("POST", { name: "sales" }))).status, 201);
});

test("database failures use a safe generic response", async () => {
  const memberships = new IdentityStore();
  memberships.setRole(owner.id, orgA, "OWNER");
  const store = new MemoryStore();
  store.list = async () => { throw new Error("internal database detail"); };
  const response = await makeHandlers(store, owner, memberships).GET();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body, { error: "team_management_unavailable" });
  assert.equal(JSON.stringify(body).includes("internal database detail"), false);
});
