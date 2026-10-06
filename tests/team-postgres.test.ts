import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  requireOrganizationPermission,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import { createTeamHandlers } from "../src/lib/team-core.ts";
import { createPrismaTeamStore } from "../src/lib/team-prisma-store.ts";
import {
  resolveTenantContext,
  type TenantMembershipStore,
} from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL enforces Team authorization, ownership, isolation, and name uniqueness", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL Team tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const store = createPrismaTeamStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
  };

  const membershipStore: TenantMembershipStore & AuthorizationStore = {
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
  const makeHandlers = (identity: AuthenticatedUser | null) => createTeamHandlers({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, membershipStore);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    store,
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

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Team Tenant A", slug: `${orgA}-team-test` },
      { id: orgB, name: "Team Tenant B", slug: `${orgB}-team-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
    ] });

    const ownerA = makeHandlers(asUser(users.ownerA));
    const adminA = makeHandlers(asUser(users.adminA));
    const memberA = makeHandlers(asUser(users.memberA));
    const ownerB = makeHandlers(asUser(users.ownerB));
    const anonymous = makeHandlers(null);

    const forged = await ownerA.POST(request("POST", {
      name: "Forged",
      organizationId: orgB,
      tenantId: orgB,
    }));
    assert.equal(forged.status, 400);
    assert.equal(await db.team.count(), 0);

    const createdA = await ownerA.POST(request("POST", { name: "  Sales  ", description: "  Commercial  " }));
    assert.equal(createdA.status, 201);
    const teamA = (await createdA.json() as { team: { id: string; name: string; description: string | null } }).team;
    assert.equal(teamA.name, "Sales");
    assert.equal(teamA.description, "Commercial");
    const persistedA = await db.team.findUniqueOrThrow({ where: { id: teamA.id } });
    assert.equal(persistedA.organizationId, orgA);
    assert.equal(persistedA.name, "Sales");
    assert.equal(persistedA.description, "Commercial");

    const duplicate = await ownerA.POST(request("POST", { name: "Sales" }));
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: "team_name_conflict" });
    const dbConstraintError = await db.team.create({ data: {
      organizationId: orgA,
      name: "Sales",
      description: null,
    } }).then(() => null, (error: unknown) => error);
    assert.ok(dbConstraintError !== null && typeof dbConstraintError === "object" && "code" in dbConstraintError);
    assert.equal((dbConstraintError as { code: string }).code, "P2002");

    const sameNameB = await ownerB.POST(request("POST", { name: "Sales" }));
    assert.equal(sameNameB.status, 201);
    const teamB = (await sameNameB.json() as { team: { id: string; name: string } }).team;
    assert.equal((await db.team.findUniqueOrThrow({ where: { id: teamB.id } })).organizationId, orgB);
    const lowerCaseName = await ownerA.POST(request("POST", { name: "sales" }));
    assert.equal(lowerCaseName.status, 201);

    const adminCreated = await adminA.POST(request("POST", { name: "Support" }));
    assert.equal(adminCreated.status, 201);
    const adminTeamId = (await adminCreated.json() as { team: { id: string } }).team.id;
    const duplicateRename = await adminA.PATCH(request("PATCH", { name: "Sales" }), adminTeamId);
    assert.equal(duplicateRename.status, 409);
    assert.equal((await db.team.findUniqueOrThrow({ where: { id: adminTeamId } })).name, "Support");
    const memberCreate = await memberA.POST(request("POST", { name: "Nope" }));
    assert.equal(memberCreate.status, 403);

    const listA = await ownerA.GET();
    const idsA = (await listA.json() as { teams: { id: string }[] }).teams.map(({ id }) => id);
    assert.ok(idsA.includes(teamA.id));
    assert.ok(idsA.includes(adminTeamId));
    assert.equal(idsA.includes(teamB.id), false);
    const forgedQuery = new Request(
      `https://lms.example.test/api/organizations/teams?organizationId=${orgB}&tenantId=${orgB}`,
      { headers: { "x-organization-id": orgB, "x-tenant-id": orgB } },
    );
    const queryResult = await ownerA.GET(forgedQuery);
    assert.equal((await queryResult.json() as { teams: { id: string }[] }).teams.some(({ id }) => id === teamB.id), false);
    assert.equal((await memberA.GET()).status, 200);
    assert.equal((await memberA.GET_ONE(teamA.id)).status, 200);
    assert.equal((await ownerA.GET_ONE(teamA.id)).status, 200);

    const foreignRead = await ownerA.GET_ONE(teamB.id);
    const missingRead = await ownerA.GET_ONE(crypto.randomUUID());
    assert.equal(foreignRead.status, 404);
    assert.deepEqual(await foreignRead.json(), await missingRead.json());
    assert.equal((await ownerA.PATCH(request("PATCH", { name: "Stolen" }), teamB.id)).status, 404);
    assert.equal((await ownerA.DELETE(request("DELETE"), teamB.id)).status, 404);
    assert.equal((await db.team.findUniqueOrThrow({ where: { id: teamB.id } })).name, "Sales");

    for (const field of ["organizationId", "tenantId", "ownerId", "role", "id", "createdAt", "updatedAt"]) {
      assert.equal((await ownerA.PATCH(request("PATCH", { [field]: orgB }), teamA.id)).status, 400);
    }
    const memberTeam = await db.team.findUniqueOrThrow({ where: { id: teamA.id } });
    assert.equal((await memberA.PATCH(request("PATCH", { name: "Member edit" }), teamA.id)).status, 403);
    assert.equal((await memberA.DELETE(request("DELETE"), teamA.id)).status, 403);
    assert.equal((await db.team.findUniqueOrThrow({ where: { id: teamA.id } })).name, memberTeam.name);

    const updated = await adminA.PATCH(request("PATCH", { name: "Commercial", description: null }), teamA.id);
    assert.equal(updated.status, 200);
    const persistedUpdate = await db.team.findUniqueOrThrow({ where: { id: teamA.id } });
    assert.equal(persistedUpdate.organizationId, orgA);
    assert.equal(persistedUpdate.name, "Commercial");
    assert.equal(persistedUpdate.description, null);
    assert.equal((await db.team.findUniqueOrThrow({ where: { id: teamB.id } })).name, "Sales");

    const raceName = `Concurrent ${crypto.randomUUID()}`;
    const concurrent = await Promise.all([
      ownerA.POST(request("POST", { name: raceName })),
      adminA.POST(request("POST", { name: raceName })),
    ]);
    assert.deepEqual(concurrent.map(({ status }) => status).sort(), [201, 409]);
    assert.equal(await db.team.count({ where: { organizationId: orgA, name: raceName } }), 1);

    assert.equal((await ownerA.DELETE(request("DELETE"), teamA.id)).status, 200);
    assert.equal(await db.team.findUnique({ where: { id: teamA.id } }), null);
    assert.equal((await db.team.findUnique({ where: { id: teamB.id } }))?.organizationId, orgB);
    assert.equal((await adminA.DELETE(request("DELETE"), adminTeamId)).status, 200);
    assert.equal(await db.team.findUnique({ where: { id: adminTeamId } }), null);

    assert.equal((await anonymous.GET()).status, 401);
    assert.equal((await anonymous.GET_ONE(teamB.id)).status, 401);
    assert.equal((await anonymous.POST(request("POST", { name: "No identity" }))).status, 401);
    assert.equal(await db.team.count({ where: { organizationId: orgA, name: "Commercial" } }), 0);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
  }
});
