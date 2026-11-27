import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { recordAuditEvent } from "../src/lib/audit-event.ts";
import { createPrismaCourseAssignmentStore } from "../src/lib/course-assignment-prisma-store.ts";
import { createPrismaEmployeeManagementStore } from "../src/lib/employee-management-prisma-store.ts";
import { createLoginRateLimitStore, loginRateLimitKeys, LOGIN_ACCOUNT_LIMIT } from "../src/lib/login-rate-limit.ts";

const dbUrl = process.env.TEST_DATABASE_URL;
const skip = !dbUrl && process.env.CI !== "true";

function testClient() {
  if (!dbUrl) throw new Error("TEST_DATABASE_URL is required for release gate integration tests.");
  assert.equal(new URL(dbUrl).pathname, "/lms_platform_test");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: dbUrl }) });
}

async function checkDatabase(db: PrismaClient) {
  const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  assert.equal(database?.name, "lms_platform_test");
}

test("production login limiter requires a secret and one valid ingress address", () => {
  const headers = new Headers({ "x-client-ip": "2001:0DB8:0000::1", "x-forwarded-for": "192.0.2.2" });
  const config = { production: true, secret: "fixture-secret-for-tests-only-12345678", trustedHeader: "x-client-ip" };
  assert.throws(() => loginRateLimitKeys(headers, "test@example.test", { ...config, secret: "" }));
  assert.throws(() => loginRateLimitKeys(headers, "test@example.test", { ...config, trustedHeader: undefined }));
  const keys = loginRateLimitKeys(headers, "test@example.test", config);
  headers.set("x-client-ip", "2001:db8::1");
  assert.deepEqual(loginRateLimitKeys(headers, "test@example.test", config), keys);
  assert.notEqual(loginRateLimitKeys(headers, "other@example.test", config).account, keys.account);
  assert.notEqual(loginRateLimitKeys(headers, "test@example.test", { ...config, secret: config.secret + "2" }).account, keys.account);
  headers.set("x-client-ip", "192.0.2.1, 192.0.2.2");
  assert.throws(() => loginRateLimitKeys(headers, "test@example.test", config));
});

test("PostgreSQL shares attempt limits across instances and cleans expired windows", { skip }, async () => {
  const db = testClient();
  const other = testClient();
  const key = createHash("sha256").update(crypto.randomUUID()).digest("hex");
  let databaseVerified = false;
  try {
    await checkDatabase(db);
    databaseVerified = true;
    const stores = [createLoginRateLimitStore(db), createLoginRateLimitStore(other)];
    const oldWindow = new Date("2000-01-01T00:05:00Z");
    await db.loginAttemptBucket.create({ data: { key, windowEnd: oldWindow, attempts: LOGIN_ACCOUNT_LIMIT } });
    const reservations = await Promise.all(Array.from({ length: 22 }, (_, index) =>
      stores[index % stores.length]!.reserve(key, LOGIN_ACCOUNT_LIMIT),
    ));
    const allowed = reservations.filter((window): window is Date => window !== null);
    assert.ok(allowed.length >= LOGIN_ACCOUNT_LIMIT);
    assert.ok(allowed.length < reservations.length);
    const current = await db.loginAttemptBucket.findMany({ where: { key, windowEnd: { gt: oldWindow } } });
    assert.equal(current.reduce((sum, row) => sum + row.attempts, 0), allowed.length);
    assert.ok(current.every(({ attempts }) => attempts <= LOGIN_ACCOUNT_LIMIT));
    const activeWindow = allowed[0]!;
    const bucket = current.find(({ windowEnd }) => windowEnd.getTime() === activeWindow.getTime())!;
    await stores[1]!.release(key, activeWindow);
    const updated = await db.loginAttemptBucket.findUniqueOrThrow({ where: { key_windowEnd: { key, windowEnd: activeWindow } } });
    assert.equal(updated.attempts, bucket.attempts - 1);
    await stores[0]!.pruneExpired();
    assert.equal(await db.loginAttemptBucket.findUnique({ where: { key_windowEnd: { key, windowEnd: oldWindow } } }), null);
  } finally {
    try {
      if (databaseVerified) await db.loginAttemptBucket.deleteMany({ where: { key } });
    } finally {
      await Promise.all([db.$disconnect(), other.$disconnect()]);
    }
  }
});

test("audit events share the mutation transaction and retain actor and target IDs", { skip }, async () => {
  const db = testClient();
  const [organizationId, foreignOrgId, actorUserId, foreignUserId] = Array.from({ length: 4 }, () => crypto.randomUUID());
  let seeded = false;
  try {
    await checkDatabase(db);
    seeded = true;
    await db.organization.createMany({
      data: [organizationId, foreignOrgId].map((id) => ({ id, slug: id, name: "Audit fixtures" })),
    });
    await db.user.createMany({ data: [actorUserId, foreignUserId].map((id) => ({ id, email: `${id}@example.test` })) });
    await db.organizationMembership.createMany({ data: [
      { organizationId, userId: actorUserId, role: "ADMIN" },
      { organizationId: foreignOrgId, userId: foreignUserId, role: "ADMIN" },
    ] });
    const employeeStore = createPrismaEmployeeManagementStore(db);
    const employeeEmail = `${organizationId}@fixture.test`;
    await assert.rejects(employeeStore.create(organizationId, employeeEmail, "Fixture", foreignUserId));
    assert.equal(await db.user.findUnique({ where: { email: employeeEmail } }), null);
    const employee = await employeeStore.create(organizationId, employeeEmail, "Fixture", actorUserId);
    const course = await db.course.create({ data: { organizationId, title: "Course", status: "PUBLISHED", publishedAt: new Date() } });
    const assignments = createPrismaCourseAssignmentStore(db);
    const target = { type: "member" as const, targetId: employee.id };
    assert.equal(await assignments.grant(organizationId, course.id, target, actorUserId), true);
    assert.equal(await assignments.grant(organizationId, course.id, target, actorUserId), true);
    await assignments.revoke(organizationId, course.id, target, actorUserId);
    await assignments.revoke(organizationId, course.id, target, actorUserId);

    await assert.rejects(db.$transaction(async (transaction) => {
      await recordAuditEvent(transaction, organizationId, actorUserId, "EMPLOYEE_UPDATED", employee.id);
      throw new Error("Rollback");
    }), /Rollback/);
    await db.organizationMembership.delete({ where: { id: employee.id } });
    const events = await db.auditEvent.findMany({
      where: { organizationId }, orderBy: { action: "asc" },
      select: { actorUserId: true, action: true, targetId: true, relatedId: true },
    });
    assert.deepEqual(events, [
      { actorUserId, action: "EMPLOYEE_CREATED", targetId: employee.id, relatedId: null },
      { actorUserId, action: "COURSE_MEMBER_GRANTED", targetId: course.id, relatedId: employee.id },
      { actorUserId, action: "COURSE_MEMBER_REVOKED", targetId: course.id, relatedId: employee.id },
    ]);
    assert.equal(await db.auditEvent.count({ where: { organizationId: foreignOrgId } }), 0);
  } finally {
    try {
      if (seeded) {
        await db.organization.deleteMany({ where: { id: { in: [organizationId, foreignOrgId] } } });
        await db.user.deleteMany({
          where: { OR: [{ id: { in: [actorUserId, foreignUserId] } }, { email: `${organizationId}@fixture.test` }] },
        });
      }
    } finally {
      await db.$disconnect();
    }
  }
});
