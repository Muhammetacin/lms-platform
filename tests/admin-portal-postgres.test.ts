import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  requireOrganizationPermission,
  type AuthorizationStore,
  type OrganizationPermission,
} from "../src/lib/authorization-core.ts";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";
import {
  resolveAdminPortalAccess,
  type AdminPortalStore,
} from "../src/lib/admin-portal-core.ts";
import { createPrismaAdminPortalStore } from "../src/lib/admin-portal-prisma-store.ts";
import { createPrismaCourseStore } from "../src/lib/course-prisma-store.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL Admin Portal reads are permission-gated and tenant-scoped", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async (context) => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for Admin Portal tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const orgEmpty = crypto.randomUUID();
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    inactiveA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    unlinked: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
    ownerEmpty: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test` },
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
  const asUser = (user: { id: string; email: string }): AuthenticatedUser => ({
    id: user.id,
    email: user.email,
    name: null,
  });

  const prismaPortalStore = createPrismaAdminPortalStore(db);
  let profileReads = 0;
  let dashboardReads = 0;
  const measuredPortalStore: AdminPortalStore = {
    async getProfile(userId, organizationId) {
      profileReads += 1;
      return prismaPortalStore.getProfile(userId, organizationId);
    },
    async getCourseCounts(organizationId) {
      dashboardReads += 1;
      return prismaPortalStore.getCourseCounts(organizationId);
    },
  };
  const resolveAccess = (identity: AuthenticatedUser | null) => resolveAdminPortalAccess({
    requireTenantContext: () => resolveTenantContext(identity, undefined, membershipStore),
    requirePermission: (organizationId: string, permission: OrganizationPermission) =>
      requireOrganizationPermission(identity, organizationId, permission, membershipStore),
    store: measuredPortalStore,
  });
  const courses = createPrismaCourseStore(db);

  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Northwind Safety A", slug: `${orgA}-admin-test` },
      { id: orgB, name: "Contoso Safety B", slug: `${orgB}-admin-test` },
      { id: orgEmpty, name: "Empty Safety C", slug: `${orgEmpty}-admin-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    await db.organizationMembership.createMany({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER" },
      { userId: users.inactiveA.id, organizationId: orgA, role: "ADMIN", active: false },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER" },
      { userId: users.ownerEmpty.id, organizationId: orgEmpty, role: "OWNER" },
    ] });

    await db.course.createMany({ data: [
      { organizationId: orgA, title: "Old Draft", status: "DRAFT", createdAt: new Date("2026-01-01T00:00:00Z") },
      { organizationId: orgA, title: "Published A", status: "PUBLISHED", publishedAt: new Date("2026-02-01T00:00:00Z"), createdAt: new Date("2026-02-01T00:00:00Z") },
      { organizationId: orgA, title: "Newest Draft", status: "DRAFT", createdAt: new Date("2026-03-01T00:00:00Z") },
      { organizationId: orgB, title: "Tenant B Secret", status: "PUBLISHED", publishedAt: new Date("2026-02-01T00:00:00Z") },
    ] });

    await context.test("OWNER and ADMIN access uses the trusted organization profile", async () => {
      const owner = await resolveAccess(asUser(users.ownerA));
      assert.equal(owner.kind, "allowed");
      if (owner.kind === "allowed") {
        assert.equal(owner.tenant.role, "OWNER");
        assert.deepEqual(owner.profile, {
          email: users.ownerA.email,
          name: null,
          organizationName: "Northwind Safety A",
        });
      }

      const admin = await resolveAccess(asUser(users.adminA));
      assert.equal(admin.kind, "allowed");
      if (admin.kind === "allowed") assert.equal(admin.tenant.role, "ADMIN");
    });

    await context.test("MEMBER is denied before profile, dashboard, or Course reads", async () => {
      const beforeProfiles = profileReads;
      const beforeDashboards = dashboardReads;
      const member = await resolveAccess(asUser(users.memberA));
      assert.deepEqual(member, { kind: "forbidden" });
      assert.equal(profileReads, beforeProfiles);
      assert.equal(dashboardReads, beforeDashboards);
    });

    await context.test("tenant A dashboard counts only tenant A Courses", async () => {
      const counts = await measuredPortalStore.getCourseCounts(orgA);
      assert.deepEqual(counts, { total: 3, draft: 2, published: 1 });
    });

    await context.test("Draft and Published totals match the persisted tenant A rows", async () => {
      const grouped = await db.course.groupBy({
        by: ["status"],
        where: { organizationId: orgA },
        _count: { _all: true },
      });
      assert.deepEqual(Object.fromEntries(grouped.map(({ status, _count }) => [status, _count._all])), {
        DRAFT: 2,
        PUBLISHED: 1,
      });
    });

    await context.test("tenant B data does not enter tenant A Course counts or lists", async () => {
      const tenantACounts = await measuredPortalStore.getCourseCounts(orgA);
      const tenantBCourses = await courses.list(orgB);
      const tenantACourses = await courses.list(orgA);
      assert.deepEqual(tenantACounts, { total: 3, draft: 2, published: 1 });
      assert.deepEqual(tenantBCourses.map(({ title }) => title), ["Tenant B Secret"]);
      assert.deepEqual(tenantACourses.map(({ title }) => title), ["Newest Draft", "Published A", "Old Draft"]);
      assert.equal(tenantACourses.some(({ title }) => title.includes("Tenant B")), false);
    });

    await context.test("an empty organization gets real zero counts and an empty Course list", async () => {
      assert.deepEqual(await measuredPortalStore.getCourseCounts(orgEmpty), {
        total: 0,
        draft: 0,
        published: 0,
      });
      assert.deepEqual(await courses.list(orgEmpty), []);
    });

    await context.test("Organization name comes from the tenant-scoped Organization record", async () => {
      const access = await resolveAccess(asUser(users.ownerB));
      assert.equal(access.kind, "allowed");
      if (access.kind === "allowed") assert.equal(access.profile.organizationName, "Contoso Safety B");
    });

    await context.test("inactive or missing memberships do not produce admin access or data reads", async () => {
      const beforeProfiles = profileReads;
      const inactive = await resolveAccess(asUser(users.inactiveA));
      assert.deepEqual(inactive, { kind: "forbidden" });
      const unlinked = await resolveAccess(asUser(users.unlinked));
      assert.deepEqual(unlinked, { kind: "forbidden" });
      assert.equal(profileReads, beforeProfiles);
    });
  } finally {
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB, orgEmpty] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
  }
});
