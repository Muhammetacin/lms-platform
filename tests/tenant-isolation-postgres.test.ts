import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  requireOrganizationPermission,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import {
  createEmployeeManagementHandlers,
} from "../src/lib/employee-management-core.ts";
import { createPrismaEmployeeManagementStore } from "../src/lib/employee-management-prisma-store.ts";
import {
  resolveTenantContext,
  type TenantMembershipStore,
} from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL enforces the employee tenant boundary through production handlers and store", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL tenant-isolation tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const store = createPrismaEmployeeManagementStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerASecond: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    multi: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    inactive: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
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

  const makeHandlers = (identity: AuthenticatedUser | null) => createEmployeeManagementHandlers({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, membershipStore);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    store,
    isTrustedRequest: () => true,
    readBody: async (request) => request.json(),
    logError: () => {},
  });
  const asUser = (record: { id: string; email: string }): AuthenticatedUser => ({
    id: record.id,
    email: record.email,
    name: null,
  });
  const request = (method: string, value?: unknown, url = "https://lms.example.test/api/organizations/employees") =>
    new Request(url, {
      method,
      headers: { "content-type": "application/json" },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Tenant A", slug: `${orgA}-test` },
      { id: orgB, name: "Tenant B", slug: `${orgB}-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    const memberships = await db.organizationMembership.createManyAndReturn({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "A Owner" },
      { userId: users.ownerASecond.id, organizationId: orgA, role: "OWNER", employeeName: "A Second Owner" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "B Owner" },
      { userId: users.memberB.id, organizationId: orgB, role: "MEMBER", employeeName: "B Member" },
      { userId: users.multi.id, organizationId: orgA, role: "ADMIN", employeeName: "A Name" },
      { userId: users.multi.id, organizationId: orgB, role: "MEMBER", employeeName: "B Name" },
      { userId: users.inactive.id, organizationId: orgA, role: "OWNER", employeeName: "Inactive Owner", active: false },
    ] });
    const memberIn = (userId: string, organizationId: string) => {
      const membership = memberships.find((item) => item.userId === userId && item.organizationId === organizationId);
      assert.ok(membership);
      return membership;
    };
    const ownerBMembership = memberIn(users.ownerB.id, orgB);
    const multiA = memberIn(users.multi.id, orgA);
    const multiB = memberIn(users.multi.id, orgB);
    const handlersA = makeHandlers(asUser(users.ownerA));
    const handlersB = makeHandlers(asUser(users.ownerB));
    const memberHandlersB = makeHandlers(asUser(users.memberB));

    assert.deepEqual((await (await handlersA.GET()).json() as { employees: { id: string }[] }).employees.map(({ id }) => id).sort(),
      [memberIn(users.ownerA.id, orgA).id, memberIn(users.ownerASecond.id, orgA).id, multiA.id].sort());
    assert.deepEqual((await (await handlersB.GET()).json() as { employees: { id: string }[] }).employees.map(({ id }) => id).sort(),
      [ownerBMembership.id, memberIn(users.memberB.id, orgB).id, multiB.id].sort());
    const foreignRead = await handlersA.GET_ONE(ownerBMembership.id);
    const unknownRead = await handlersA.GET_ONE(crypto.randomUUID());
    assert.equal(foreignRead.status, 404);
    assert.deepEqual(await foreignRead.json(), await unknownRead.json());
    assert.equal((await handlersA.GET_ONE(orgB)).status, 404);
    assert.equal((await handlersA.PATCH(request("PATCH", { name: "Stolen" }), ownerBMembership.id)).status, 404);
    assert.equal((await handlersA.DEACTIVATE(request("POST"), ownerBMembership.id)).status, 404);
    assert.equal((await handlersB.GET_ONE(multiA.id)).status, 404);
    assert.equal((await handlersB.PATCH(request("PATCH", { name: "Stolen" }), multiA.id)).status, 404);
    assert.equal((await handlersB.DEACTIVATE(request("POST"), multiA.id)).status, 404);
    assert.equal((await memberHandlersB.POST(request("POST", {
      email: `${crypto.randomUUID()}@example.test`, name: "Not Allowed",
    }))).status, 403);

    const bBefore = await db.organizationMembership.findUniqueOrThrow({ where: { id: ownerBMembership.id } });
    const forgedCreate = await handlersA.POST(request("POST", {
      email: `${crypto.randomUUID()}@example.test`,
      name: "Forged",
      organizationId: orgB,
      role: "OWNER",
    }));
    assert.equal(forgedCreate.status, 400);
    assert.equal((await handlersA.PATCH(request("PATCH", { name: "Tampered", organizationId: orgB }), multiA.id)).status, 400);
    const forgedQuery = new Request(
      `https://lms.example.test/api/organizations/employees?organizationId=${orgB}&role=OWNER`,
      { headers: { "x-organization-id": orgB, "x-organization-role": "OWNER" } },
    );
    const queryResult = await (handlersA.GET as unknown as (request: Request) => Promise<Response>)(forgedQuery);
    assert.equal((await queryResult.json() as { employees: { id: string }[] }).employees.some(({ id }) => id === ownerBMembership.id), false);

    const afterCrossTenantAttempts = await db.organizationMembership.findUniqueOrThrow({ where: { id: ownerBMembership.id } });
    assert.equal(afterCrossTenantAttempts.employeeName, bBefore.employeeName);
    assert.equal(afterCrossTenantAttempts.active, bBefore.active);
    assert.equal(afterCrossTenantAttempts.role, bBefore.role);

    assert.equal((await handlersA.PATCH(request("PATCH", { name: "A Updated" }), multiA.id)).status, 200);
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: multiA.id } })).employeeName, "A Updated");
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: multiB.id } })).employeeName, "B Name");
    assert.equal((await handlersA.DEACTIVATE(request("POST"), multiA.id)).status, 200);
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: multiA.id } })).active, false);
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: multiB.id } })).active, true);

    const newMembership = await handlersA.POST(request("POST", {
      email: users.ownerB.email,
      name: "A Local Name",
    }));
    assert.equal(newMembership.status, 201);
    const createdMembership = await db.organizationMembership.findFirstOrThrow({
      where: { userId: users.ownerB.id, organizationId: orgA },
    });
    assert.equal(createdMembership.employeeName, "A Local Name");
    assert.equal(createdMembership.role, "MEMBER");
    const ownerBAfterCreate = await db.organizationMembership.findUniqueOrThrow({ where: { id: ownerBMembership.id } });
    assert.equal(ownerBAfterCreate.employeeName, bBefore.employeeName);
    assert.equal(ownerBAfterCreate.role, "OWNER");
    assert.equal(ownerBAfterCreate.active, true);

    const inactiveHandlers = makeHandlers(asUser(users.inactive));
    assert.equal((await inactiveHandlers.GET()).status, 403);
    assert.equal((await handlersB.DEACTIVATE(request("POST"), ownerBMembership.id)).status, 409);
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: ownerBMembership.id } })).active, true);

    const unauthenticated = makeHandlers(null);
    assert.equal((await unauthenticated.GET()).status, 401);

    const ownerResults = await Promise.allSettled([
      store.deactivate(orgA, memberIn(users.ownerA.id, orgA).id).catch(() => null),
      store.deactivate(orgA, memberIn(users.ownerASecond.id, orgA).id).catch(() => null),
    ]);
    assert.ok(ownerResults.some((result) => result.status === "fulfilled" && result.value !== null));
    const activeOwnersA = await db.organizationMembership.count({
      where: { organizationId: orgA, role: "OWNER", active: true },
    });
    assert.ok(activeOwnersA >= 1, "concurrent deactivation must preserve an active owner in tenant A");
    assert.equal(await db.organizationMembership.count({
      where: { organizationId: orgB, role: "OWNER", active: true },
    }), 1, "tenant A owner safety work must not mutate tenant B owners");
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
  }
});
