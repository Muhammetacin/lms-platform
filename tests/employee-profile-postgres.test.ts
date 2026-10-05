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
  createPrismaEmployeeManagementStore,
} from "../src/lib/employee-management-prisma-store.ts";
import { createEmployeeProfileHandlers } from "../src/lib/employee-profile-core.ts";
import {
  resolveTenantContext,
  type TenantMembershipStore,
} from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL enforces employee profile tenant scope, membership ownership, and employee-number uniqueness", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL employee-profile tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const store = createPrismaEmployeeManagementStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    otherMemberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
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
  const makeHandlers = (identity: AuthenticatedUser | null) => createEmployeeProfileHandlers({
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
  const request = (value: unknown) => new Request(
    "https://lms.example.test/api/organizations/employees/profile",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-organization-id": orgB,
        "x-organization-role": "OWNER",
      },
      body: JSON.stringify(value),
    },
  );
  const profiles = {
    ownerA: "Owner A",
    ownerB: "Owner B",
    adminA: "Admin A",
    memberA: "Member A",
    otherMemberA: "Other A",
    memberB: "Member B",
  } as const;

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Profile Tenant A", slug: `${orgA}-profile-test` },
      { id: orgB, name: "Profile Tenant B", slug: `${orgB}-profile-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    const memberships = await db.organizationMembership.createManyAndReturn({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: profiles.ownerA },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: profiles.adminA },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: profiles.memberA, employeeNumber: "EMP-001" },
      { userId: users.otherMemberA.id, organizationId: orgA, role: "MEMBER", employeeName: profiles.otherMemberA },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: profiles.ownerB },
      { userId: users.memberB.id, organizationId: orgB, role: "MEMBER", employeeName: profiles.memberB, employeeNumber: "EMP-001" },
    ] });
    const memberIn = (userId: string, organizationId: string) => {
      const membership = memberships.find((item) => item.userId === userId && item.organizationId === organizationId);
      assert.ok(membership);
      return membership;
    };
    const ownerA = memberIn(users.ownerA.id, orgA);
    const ownerB = memberIn(users.ownerB.id, orgB);
    const adminA = memberIn(users.adminA.id, orgA);
    const memberA = memberIn(users.memberA.id, orgA);
    const otherMemberA = memberIn(users.otherMemberA.id, orgA);
    const memberB = memberIn(users.memberB.id, orgB);
    const ownerHandlersA = makeHandlers(asUser(users.ownerA));
    const ownerHandlersB = makeHandlers(asUser(users.ownerB));
    const adminHandlersA = makeHandlers(asUser(users.adminA));
    const memberHandlersA = makeHandlers(asUser(users.memberA));

    const ownerRead = await ownerHandlersA.GET(memberA.id);
    assert.equal(ownerRead.status, 200);
    const ownerProfile = (await ownerRead.json() as { profile: Record<string, unknown> }).profile;
    assert.equal(ownerProfile.email, users.memberA.email);
    assert.equal(Object.hasOwn(ownerProfile, "userId"), false);
    assert.equal(Object.hasOwn(ownerProfile, "organizationId"), false);
    assert.equal((await adminHandlersA.GET(ownerA.id)).status, 200);
    assert.equal((await adminHandlersA.PATCH(request({ jobTitle: "Administrator edit" }), memberA.id)).status, 200);
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: memberA.id } })).jobTitle, "Administrator edit");
    assert.equal((await ownerHandlersA.PATCH(request({ employeeNumber: "EMP-SHARED" }), otherMemberA.id)).status, 200);
    assert.equal((await ownerHandlersB.PATCH(request({ employeeNumber: "EMP-SHARED" }), memberB.id)).status, 200);

    const selfRead = await memberHandlersA.GET(memberA.id);
    assert.equal(selfRead.status, 200);
    const memberBefore = await db.organizationMembership.findUniqueOrThrow({ where: { id: memberA.id } });
    assert.equal((await memberHandlersA.PATCH(request({
      employeeName: "Member A Updated",
      department: "Learning",
      phone: "+32 2 555 01 23",
    }), memberA.id)).status, 200);
    const memberAfter = await db.organizationMembership.findUniqueOrThrow({ where: { id: memberA.id } });
    assert.equal(memberAfter.employeeName, "Member A Updated");
    assert.equal(memberAfter.department, "Learning");
    assert.equal(memberAfter.phone, "+32 2 555 01 23");
    assert.equal(memberAfter.employeeNumber, memberBefore.employeeNumber);

    const otherBefore = await db.organizationMembership.findUniqueOrThrow({ where: { id: otherMemberA.id } });
    const unauthorizedRead = await memberHandlersA.GET(otherMemberA.id);
    const missingRead = await memberHandlersA.GET(crypto.randomUUID());
    assert.equal(unauthorizedRead.status, 404);
    assert.deepEqual(await unauthorizedRead.json(), await missingRead.json());
    assert.equal((await memberHandlersA.PATCH(request({ phone: "Not yours" }), otherMemberA.id)).status, 404);
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: otherMemberA.id } })).phone, otherBefore.phone);

    for (const forbidden of [
      { email: "forged@example.test" },
      { role: "OWNER" },
      { active: false },
      { organizationId: orgB },
      { tenantId: orgB },
      { userId: users.ownerA.id },
      { id: otherMemberA.id },
      { employeeNumber: "EMP-999" },
    ]) {
      assert.equal((await memberHandlersA.PATCH(request(forbidden), memberA.id)).status, 400);
    }
    const unchangedAfterTampering = await db.organizationMembership.findUniqueOrThrow({ where: { id: memberA.id } });
    assert.equal(unchangedAfterTampering.role, "MEMBER");
    assert.equal(unchangedAfterTampering.active, true);
    assert.equal(unchangedAfterTampering.employeeNumber, "EMP-001");

    const foreignRead = await ownerHandlersA.GET(ownerB.id);
    const missingForeignId = await ownerHandlersA.GET(crypto.randomUUID());
    assert.equal(foreignRead.status, 404);
    assert.deepEqual(await foreignRead.json(), await missingForeignId.json());
    const foreignBefore = await db.organizationMembership.findUniqueOrThrow({ where: { id: ownerB.id } });
    assert.equal((await ownerHandlersA.PATCH(request({ employeeName: "Cross tenant" }), ownerB.id)).status, 404);
    const foreignAfter = await db.organizationMembership.findUniqueOrThrow({ where: { id: ownerB.id } });
    assert.equal(foreignAfter.employeeName, foreignBefore.employeeName);
    assert.equal(foreignAfter.active, foreignBefore.active);
    assert.equal((await ownerHandlersA.PATCH(request({
      jobTitle: "Forged tenant",
      organizationId: orgB,
      tenantId: orgB,
    }), ownerA.id)).status, 400);

    const duplicateNumber = await ownerHandlersA.PATCH(
      request({ employeeNumber: "EMP-001" }),
      otherMemberA.id,
    );
    assert.equal(duplicateNumber.status, 409);
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: otherMemberA.id } })).employeeNumber, null);
    assert.equal((await db.organizationMembership.findUniqueOrThrow({ where: { id: memberB.id } })).employeeNumber, "EMP-001");
    assert.equal(adminA.role, "ADMIN");
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
  }
});
