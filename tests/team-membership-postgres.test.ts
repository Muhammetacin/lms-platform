import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";
import { requireOrganizationPermission, type AuthorizationStore } from "../src/lib/authorization-core.ts";
import { createTeamMembershipHandlers } from "../src/lib/team-membership-core.ts";
import { createPrismaTeamMembershipStore } from "../src/lib/team-membership-prisma-store.ts";
import { createPrismaTeamStore } from "../src/lib/team-prisma-store.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL enforces TeamMembership tenant integrity, lifecycle, uniqueness, and cascades", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL Team membership tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const membershipStore = createPrismaTeamMembershipStore(db);
  const teamStore = createPrismaTeamStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    employeeA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    inactiveA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    employeeToDelete: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    concurrentEmployee: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    employeeB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
  };

  const identityStore: TenantMembershipStore & AuthorizationStore = {
    async findOrganizationRole(userId, organizationId) {
      const membership = await db.organizationMembership.findFirst({
        where: { userId, organizationId, active: true },
        select: { role: true },
      });
      return membership?.role ?? null;
    },
    async findDefaultOrganizationMembership(userId) {
      return db.organizationMembership.findFirst({
        where: { userId, active: true },
        orderBy: [{ createdAt: "asc" }, { organizationId: "asc" }],
        select: { organizationId: true, role: true },
      });
    },
  };

  const asUser = (record: { id: string; email: string }): AuthenticatedUser => ({
    id: record.id,
    email: record.email,
    name: null,
  });
  const makeHandlers = (identity: AuthenticatedUser | null) => createTeamMembershipHandlers({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, identityStore);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, identityStore);
    },
    store: membershipStore,
    isTrustedRequest: () => true,
    readBody: (request) => request.json(),
    logError: () => {},
  });
  const request = (method: string, value?: unknown) => new Request(
    "https://lms.example.test/api/organizations/teams",
    {
      method,
      headers: { "content-type": "application/json" },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    },
  );
  const hasPrismaCode = (error: unknown, code: string) =>
    typeof error === "object" && error !== null && "code" in error && error.code === code;

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Membership Tenant A", slug: `${orgA}-team-membership-test` },
      { id: orgB, name: "Membership Tenant B", slug: `${orgB}-team-membership-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.employeeA.id, organizationId: orgA, role: "MEMBER", employeeName: "Alice Active", jobTitle: "Teacher", department: "Math" },
      { userId: users.inactiveA.id, organizationId: orgA, role: "MEMBER", employeeName: "Inactive A", active: false },
      { userId: users.employeeToDelete.id, organizationId: orgA, role: "MEMBER", employeeName: "Deleted A" },
      { userId: users.concurrentEmployee.id, organizationId: orgA, role: "MEMBER", employeeName: "Concurrent A" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
      { userId: users.employeeB.id, organizationId: orgB, role: "MEMBER", employeeName: "Employee B" },
    ] });

    const ownerA = makeHandlers(asUser(users.ownerA));
    const adminA = makeHandlers(asUser(users.adminA));
    const memberA = makeHandlers(asUser(users.memberA));
    const ownerB = makeHandlers(asUser(users.ownerB));
    const anonymous = makeHandlers(null);
    const teamA = await teamStore.create(orgA, { name: "A Sales", description: null });
    const teamB = await teamStore.create(orgB, { name: "B Sales", description: null });
    const employeeA = await db.organizationMembership.findFirstOrThrow({ where: { userId: users.employeeA.id, organizationId: orgA }, select: { id: true } });
    const inactiveA = await db.organizationMembership.findFirstOrThrow({ where: { userId: users.inactiveA.id, organizationId: orgA }, select: { id: true } });
    const employeeToDelete = await db.organizationMembership.findFirstOrThrow({ where: { userId: users.employeeToDelete.id, organizationId: orgA }, select: { id: true } });
    const concurrentEmployee = await db.organizationMembership.findFirstOrThrow({ where: { userId: users.concurrentEmployee.id, organizationId: orgA }, select: { id: true } });
    const employeeB = await db.organizationMembership.findFirstOrThrow({ where: { userId: users.employeeB.id, organizationId: orgB }, select: { id: true } });

    // Forged tenant fields and global User IDs are not accepted as employee IDs.
    for (const extra of ["organizationId", "tenantId"]) {
      const forged = await ownerA.POST(request("POST", { employeeId: employeeA.id, [extra]: orgB }), teamA.id);
      assert.equal(forged.status, 400);
      assert.deepEqual(await forged.json(), { error: "invalid_request" });
    }
    const globalUserId = await ownerA.POST(request("POST", { employeeId: users.employeeA.id }), teamA.id);
    assert.equal(globalUserId.status, 404);
    assert.deepEqual(await globalUserId.json(), { error: "employee_not_found" });

    // Mixed-tenant requests fail at the API boundary and create no rows.
    const attackOne = await ownerA.POST(request("POST", { employeeId: employeeB.id }), teamA.id);
    assert.equal(attackOne.status, 404);
    assert.deepEqual(await attackOne.json(), { error: "employee_not_found" });
    const attackTwo = await ownerA.POST(request("POST", { employeeId: employeeA.id }), teamB.id);
    const attackThree = await ownerA.POST(request("POST", { employeeId: employeeB.id }), teamB.id);
    assert.equal(attackTwo.status, 404);
    const attackTwoBody = await attackTwo.json();
    assert.deepEqual(attackTwoBody, { error: "team_not_found" });
    assert.deepEqual(await attackThree.json(), attackTwoBody);
    assert.equal(await db.teamMembership.count(), 0);

    // PostgreSQL itself rejects inconsistent Team, Membership, or organization tuples.
    for (const data of [
      { organizationId: orgA, teamId: teamA.id, membershipId: employeeB.id },
      { organizationId: orgA, teamId: teamB.id, membershipId: employeeA.id },
      { organizationId: orgB, teamId: teamA.id, membershipId: employeeA.id },
    ]) {
      const error = await db.teamMembership.create({ data }).then(() => null, (caught: unknown) => caught);
      assert.ok(hasPrismaCode(error, "P2003"), "cross-tenant tuple must fail a PostgreSQL composite foreign key");
    }
    assert.equal(await db.teamMembership.count(), 0);

    // OWNER adds; the persisted tuple links Team and OrganizationMembership in A.
    const added = await ownerA.POST(request("POST", { employeeId: employeeA.id }), teamA.id);
    assert.equal(added.status, 201);
    assert.deepEqual((await added.json() as { member: Record<string, unknown> }).member, {
      id: employeeA.id,
      email: users.employeeA.email,
      employeeName: "Alice Active",
      jobTitle: "Teacher",
      department: "Math",
    });
    const persisted = await db.teamMembership.findFirstOrThrow({
      where: { organizationId: orgA, teamId: teamA.id, membershipId: employeeA.id },
      select: { organizationId: true, teamId: true, membershipId: true, team: { select: { organizationId: true } }, membership: { select: { organizationId: true } } },
    });
    assert.equal(persisted.organizationId, orgA);
    assert.equal(persisted.team.organizationId, orgA);
    assert.equal(persisted.membership.organizationId, orgA);

    const duplicate = await ownerA.POST(request("POST", { employeeId: employeeA.id }), teamA.id);
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: "team_membership_conflict" });
    const duplicateDb = await db.teamMembership.create({ data: {
      organizationId: orgA,
      teamId: teamA.id,
      membershipId: employeeA.id,
    } }).then(() => null, (error: unknown) => error);
    assert.ok(hasPrismaCode(duplicateDb, "P2002"), "the unique Team/employee key is enforced by PostgreSQL");
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgA, teamId: teamA.id, membershipId: employeeA.id } }), 1);

    // Concurrent duplicate requests have one winner and one safe conflict.
    const raced = await Promise.all([
      ownerA.POST(request("POST", { employeeId: concurrentEmployee.id }), teamA.id),
      adminA.POST(request("POST", { employeeId: concurrentEmployee.id }), teamA.id),
    ]);
    assert.deepEqual(raced.map(({ status }) => status).sort(), [201, 409]);
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgA, teamId: teamA.id, membershipId: concurrentEmployee.id } }), 1);

    // OWNER, ADMIN and MEMBER can read; only OWNER/ADMIN can mutate.
    assert.equal((await adminA.POST(request("POST", { employeeId: employeeToDelete.id }), teamA.id)).status, 201);
    assert.equal((await memberA.GET(teamA.id)).status, 200);
    const listA = await ownerA.GET(teamA.id);
    assert.equal(listA.status, 200);
    const membersA = (await listA.json() as { members: Array<Record<string, unknown>> }).members;
    assert.deepEqual(membersA.map(({ id }) => id), [employeeA.id, employeeToDelete.id, concurrentEmployee.id].sort((left, right) => {
      const leftName = left === employeeA.id ? "Alice Active" : left === employeeToDelete.id ? "Deleted A" : "Concurrent A";
      const rightName = right === employeeA.id ? "Alice Active" : right === employeeToDelete.id ? "Deleted A" : "Concurrent A";
      return leftName.localeCompare(rightName) || left.localeCompare(right);
    }));
    assert.equal(Object.hasOwn(membersA[0] ?? {}, "active"), false);
    assert.equal((await memberA.POST(request("POST", { employeeId: employeeA.id }), teamA.id)).status, 403);
    assert.equal((await memberA.DELETE(request("DELETE"), teamA.id, employeeA.id)).status, 403);

    // Inactive employees cannot be added or appear in operational lists.
    await db.teamMembership.create({ data: { organizationId: orgA, teamId: teamA.id, membershipId: inactiveA.id } });
    assert.equal((await ownerA.POST(request("POST", { employeeId: inactiveA.id }), teamA.id)).status, 404);
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgA, teamId: teamA.id, membershipId: inactiveA.id } }), 1);
    await db.organizationMembership.update({ where: { id: employeeA.id }, data: { active: false } });
    const activeOnly = await ownerA.GET(teamA.id);
    assert.equal((await activeOnly.json() as { members: Array<{ id: string }> }).members.some(({ id }) => id === employeeA.id), false);
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgA, teamId: teamA.id, membershipId: employeeA.id } }), 1,
      "deactivation preserves historical TeamMembership rows");

    // Owner B proves the same IDs are readable in B, while A sees a safe not-found.
    assert.equal((await ownerB.POST(request("POST", { employeeId: employeeB.id }), teamB.id)).status, 201);
    const listB = await ownerB.GET(teamB.id);
    assert.deepEqual((await listB.json() as { members: Array<{ id: string }> }).members.map(({ id }) => id), [employeeB.id]);
    const foreignGet = await ownerA.GET(teamB.id);
    const missingGet = await ownerA.GET(crypto.randomUUID());
    assert.equal(foreignGet.status, 404);
    assert.deepEqual(await foreignGet.json(), await missingGet.json());
    const foreignDelete = await ownerA.DELETE(request("DELETE"), teamB.id, employeeB.id);
    const missingDelete = await ownerA.DELETE(request("DELETE"), teamB.id, employeeA.id);
    assert.equal(foreignDelete.status, 404);
    assert.deepEqual(await foreignDelete.json(), await missingDelete.json());
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgB, teamId: teamB.id, membershipId: employeeB.id } }), 1);

    // All removal predicates include tenant, Team, and OrganizationMembership IDs.
    const removed = await adminA.DELETE(request("DELETE"), teamA.id, employeeToDelete.id);
    assert.equal(removed.status, 200);
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgA, teamId: teamA.id, membershipId: employeeToDelete.id } }), 0);
    const repeatedRemoval = await adminA.DELETE(request("DELETE"), teamA.id, employeeToDelete.id);
    assert.equal(repeatedRemoval.status, 404);
    const repeatedRemovalBody = await repeatedRemoval.json();
    assert.deepEqual(repeatedRemovalBody, { error: "team_membership_not_found" });
    const crossTenantRemove = await ownerA.DELETE(request("DELETE"), teamA.id, employeeB.id);
    assert.deepEqual(await crossTenantRemove.json(), repeatedRemovalBody);

    // Hard-deleting an OrganizationMembership and deleting a Team cascade to junction rows.
    assert.equal(await db.teamMembership.count({ where: { membershipId: employeeToDelete.id } }), 0);
    await adminA.POST(request("POST", { employeeId: employeeToDelete.id }), teamA.id).then(async (response) => {
      assert.equal(response.status, 201);
    });
    await db.organizationMembership.delete({ where: { id: employeeToDelete.id } });
    assert.equal(await db.teamMembership.count({ where: { membershipId: employeeToDelete.id } }), 0);
    const cascadeTeam = await teamStore.create(orgA, { name: "Cascade team", description: null });
    assert.equal((await adminA.POST(request("POST", { employeeId: concurrentEmployee.id }), cascadeTeam.id)).status, 201);
    assert.equal(await teamStore.delete(orgA, cascadeTeam.id), true);
    assert.equal(await db.teamMembership.count({ where: { teamId: cascadeTeam.id } }), 0);

    await db.organization.delete({ where: { id: orgB } });
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgB } }), 0);

    assert.equal((await anonymous.GET(teamA.id)).status, 401);
    assert.equal((await anonymous.POST(request("POST", { employeeId: concurrentEmployee.id }), teamA.id)).status, 401);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
  }
});
