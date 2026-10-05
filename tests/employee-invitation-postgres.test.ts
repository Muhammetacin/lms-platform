import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";
import { hashPassword } from "../src/lib/auth-core.ts";
import {
  requireOrganizationPermission,
  type AuthorizationStore,
} from "../src/lib/authorization-core.ts";
import {
  createEmployeeManagementHandlers,
} from "../src/lib/employee-management-core.ts";
import {
  createEmployeeInvitationHandler,
  createInvitationActivationHandlers,
  createInvitationToken,
  hashInvitationToken,
  validateEmployeeInvitation,
  type EmployeeInvitationDelivery,
} from "../src/lib/employee-invitation-core.ts";
import { createPrismaEmployeeInvitationStore } from "../src/lib/employee-invitation-prisma-store.ts";
import { createPrismaEmployeeManagementStore } from "../src/lib/employee-management-prisma-store.ts";
import {
  resolveTenantContext,
  type TenantMembershipStore,
} from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";
const password = "correct horse battery staple";

test("PostgreSQL enforces invitation scope, one-time activation, and transaction guarantees", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL employee-invitation tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const store = createPrismaEmployeeInvitationStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    deactivated: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    existingCredential: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    race: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    rollback: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
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
  const makeInviteHandler = (identity: AuthenticatedUser | null, delivery: EmployeeInvitationDelivery) =>
    createEmployeeInvitationHandler({
      async requireTenantContext() {
        return resolveTenantContext(identity, undefined, membershipStore);
      },
      async requirePermission(organizationId, permission) {
        return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
      },
      store,
      delivery,
      appUrl: "https://lms.example.test",
      isTrustedRequest: () => true,
      readBody: async (request) => request.json(),
      logError: () => {},
    });
  const sentUrls: string[] = [];
  const delivery: EmployeeInvitationDelivery = {
    available: true,
    async send(_email, activationUrl) { sentUrls.push(activationUrl); },
  };
  const makeRequest = (body: unknown) => new Request("https://lms.example.test/api/organizations/employees/invitation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const memberships = new Map<string, { id: string; userId: string; organizationId: string }>();
  const memberId = (userId: string, organizationId: string) => {
    const value = memberships.get(`${userId}:${organizationId}`);
    assert.ok(value);
    return value.id;
  };

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Invitation Tenant A", slug: `${orgA}-invitation-test` },
      { id: orgB, name: "Invitation Tenant B", slug: `${orgB}-invitation-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    const rows = await db.organizationMembership.createManyAndReturn({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
      { userId: users.memberB.id, organizationId: orgB, role: "MEMBER", employeeName: "Member B" },
      { userId: users.deactivated.id, organizationId: orgA, role: "MEMBER", employeeName: "Inactive", active: true },
      { userId: users.existingCredential.id, organizationId: orgA, role: "MEMBER", employeeName: "Existing" },
      { userId: users.race.id, organizationId: orgA, role: "MEMBER", employeeName: "Race" },
      { userId: users.rollback.id, organizationId: orgA, role: "MEMBER", employeeName: "Rollback" },
    ] });
    for (const row of rows) memberships.set(`${row.userId}:${row.organizationId}`, row);
    await db.passwordCredential.create({ data: { userId: users.existingCredential.id, passwordHash: "pre-existing-hash" } });

    const ownerHandler = makeInviteHandler(asUser(users.ownerA), delivery);
    const adminHandler = makeInviteHandler(asUser(users.adminA), delivery);
    const memberHandler = makeInviteHandler(asUser(users.memberA), delivery);
    const unauthenticatedHandler = makeInviteHandler(null, delivery);
    const expiry = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const ownerResponse = await ownerHandler(makeRequest({}), memberId(users.memberA.id, orgA));
    assert.equal(ownerResponse.status, 201);
    const ownerResponseBody = await ownerResponse.json();
    assert.deepEqual(ownerResponseBody, { success: true });
    const firstTokenUrl = new URL(sentUrls[0]);
    const rawToken = new URLSearchParams(firstTokenUrl.hash.slice(1)).get("token");
    assert.ok(rawToken);
    assert.equal(firstTokenUrl.search, "");
    assert.equal(JSON.stringify(ownerResponseBody).includes(rawToken), false);
    const ownerHash = [...(await db.employeeInvitation.findMany({
      where: { membershipId: memberId(users.memberA.id, orgA) },
      select: { tokenHash: true },
    }))][0]?.tokenHash;
    assert.ok(ownerHash);

    const persisted = await db.employeeInvitation.findUniqueOrThrow({ where: { tokenHash: ownerHash } });
    assert.equal(persisted.tokenHash, hashInvitationToken(rawToken));
    assert.equal(persisted.tokenHash.includes("postgres-token"), false);
    assert.equal(await db.employeeInvitation.findUnique({ where: { tokenHash: rawToken } }), null);
    const persistedLifetime = persisted.expiresAt.getTime() - persisted.createdAt.getTime();
    assert.equal(persistedLifetime <= 72 * 60 * 60 * 1000, true);
    assert.equal(persistedLifetime > 72 * 60 * 60 * 1000 - 1000, true);

    const employeeHandlers = createEmployeeManagementHandlers({
      async requireTenantContext() {
        return resolveTenantContext(asUser(users.ownerA), undefined, membershipStore);
      },
      async requirePermission(organizationId, permission) {
        return requireOrganizationPermission(asUser(users.ownerA), organizationId, permission, membershipStore);
      },
      store: createPrismaEmployeeManagementStore(db),
      isTrustedRequest: () => true,
      readBody: async (request) => request.json(),
      logError: () => {},
    });
    const normalEmployeeRead = await employeeHandlers.GET_ONE(memberId(users.memberA.id, orgA));
    assert.equal(normalEmployeeRead.status, 200);
    const normalEmployeeJson = JSON.stringify(await normalEmployeeRead.json());
    assert.equal(normalEmployeeJson.includes(rawToken), false);
    assert.equal(normalEmployeeJson.includes(persisted.tokenHash), false);

    const duplicateToken = await db.employeeInvitation.create({
      data: {
        userId: users.memberA.id,
        organizationId: orgA,
        membershipId: memberId(users.memberA.id, orgA),
        tokenHash: ownerHash,
        expiresAt: expiry,
      },
    }).then(() => null, (error: unknown) => error);
    assert.equal(typeof duplicateToken, "object");
    assert.ok(
      duplicateToken !== undefined &&
      duplicateToken !== null &&
      typeof duplicateToken === "object" &&
      "code" in duplicateToken &&
      duplicateToken.code === "P2002",
    );

    assert.equal((await adminHandler(makeRequest({}), memberId(users.memberA.id, orgA))).status, 201);
    assert.ok((await db.employeeInvitation.findUniqueOrThrow({ where: { tokenHash: ownerHash } })).consumedAt);
    assert.equal((await memberHandler(makeRequest({}), memberId(users.memberA.id, orgA))).status, 403);
    assert.equal((await unauthenticatedHandler(makeRequest({}), memberId(users.memberA.id, orgA))).status, 401);
    assert.equal((await ownerHandler(makeRequest({ organizationId: orgB, tenantId: orgB }), memberId(users.memberA.id, orgA))).status, 400);
    const foreignId = memberId(users.memberB.id, orgB);
    assert.equal((await ownerHandler(makeRequest({}), foreignId)).status, 404);
    assert.equal((await ownerHandler(makeRequest({}), crypto.randomUUID())).status, 404);
    assert.deepEqual(await (await ownerHandler(makeRequest({}), foreignId)).json(),
      await (await ownerHandler(makeRequest({}), crypto.randomUUID())).json());
    assert.equal((await ownerHandler(makeRequest({}), memberId(users.existingCredential.id, orgA))).status, 409);

    const inactiveMembershipId = memberId(users.deactivated.id, orgA);
    const inactiveToken = createInvitationToken();
    const inactiveHash = hashInvitationToken(inactiveToken);
    const inactiveCreation = await store.createInvitation(orgA, inactiveMembershipId, inactiveHash, expiry, new Date());
    assert.equal(inactiveCreation.status, "created");
    await db.organizationMembership.update({ where: { id: inactiveMembershipId }, data: { active: false } });
    assert.equal(await validateEmployeeInvitation(inactiveToken, store), "inactive");
    assert.equal(await store.activate(inactiveHash, "unused-hash", new Date()), "inactive");
    assert.equal(await db.passwordCredential.findUnique({ where: { userId: users.deactivated.id } }), null);

    const raceMembershipId = memberId(users.race.id, orgA);
    const raceToken = createInvitationToken();
    const raceHash = hashInvitationToken(raceToken);
    assert.equal((await store.createInvitation(orgA, raceMembershipId, raceHash, expiry, new Date())).status, "created");
    const hashedPassword = await hashPassword(password);
    const concurrent = await Promise.all([
      store.activate(raceHash, hashedPassword, new Date()),
      store.activate(raceHash, hashedPassword, new Date()),
    ]);
    assert.equal(concurrent.filter((result) => result === "valid").length, 1);
    assert.equal((await db.passwordCredential.count({ where: { userId: users.race.id } })), 1);
    assert.ok((await db.employeeInvitation.findUniqueOrThrow({ where: { tokenHash: raceHash } })).consumedAt);

    const rollbackMembershipId = memberId(users.rollback.id, orgA);
    const rollbackToken = createInvitationToken();
    const rollbackHash = hashInvitationToken(rollbackToken);
    assert.equal((await store.createInvitation(orgA, rollbackMembershipId, rollbackHash, expiry, new Date())).status, "created");
    await db.$executeRawUnsafe('ALTER TABLE "PasswordCredential" ADD CONSTRAINT "lms014_test_reject_hash" CHECK ("passwordHash" <> \'rollback-test-hash\')');
    try {
      await assert.rejects(store.activate(rollbackHash, "rollback-test-hash", new Date()));
      assert.equal((await db.employeeInvitation.findUniqueOrThrow({ where: { tokenHash: rollbackHash } })).consumedAt, null);
      assert.equal(await db.passwordCredential.findUnique({ where: { userId: users.rollback.id } }), null);
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "PasswordCredential" DROP CONSTRAINT IF EXISTS "lms014_test_reject_hash"');
    }

    const expiredToken = createInvitationToken();
    const expiredHash = hashInvitationToken(expiredToken);
    await db.employeeInvitation.create({
      data: {
        userId: users.memberA.id,
        organizationId: orgA,
        membershipId: memberId(users.memberA.id, orgA),
        tokenHash: expiredHash,
        expiresAt: new Date(Date.now() - 1),
      },
    });
    assert.equal(await validateEmployeeInvitation(expiredToken, store), "expired");

    const activation = createInvitationActivationHandlers({
      store,
      isTrustedRequest: () => true,
      readBody: async (request) => request.json(),
    });
    const forgedTenant = await activation.VALIDATE(new Request("https://lms.example.test/api/auth/invitations/validate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: expiredToken, organizationId: orgB, tenantId: orgB }),
    }));
    assert.equal(forgedTenant.status, 400);
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
  }
});
