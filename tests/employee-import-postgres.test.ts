import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import type { AuthenticatedUser } from "../src/lib/auth-core.ts";
import { requireOrganizationPermission, type AuthorizationStore } from "../src/lib/authorization-core.ts";
import { createEmployeeImportHandler } from "../src/lib/employee-import-core.ts";
import { createPrismaEmployeeImportStore } from "../src/lib/employee-import-prisma-store.ts";
import { resolveTenantContext, type TenantMembershipStore } from "../src/lib/tenant-context-core.ts";

const databaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = "lms_platform_test";

test("PostgreSQL employee imports enforce scope, create-only semantics, limits, atomicity, and concurrency", {
  skip: !databaseUrl && process.env.CI !== "true",
}, async () => {
  if (!databaseUrl) throw new Error("CI requires TEST_DATABASE_URL for PostgreSQL employee-import tests");
  const parsedUrl = new URL(databaseUrl);
  assert.equal(parsedUrl.pathname.slice(1), testDatabaseName,
    "TEST_DATABASE_URL must target the dedicated lms_platform_test database");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const store = createPrismaEmployeeImportStore(db);
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const testEmailDomain = `lms017-${crypto.randomUUID()}.example.test`;
  const generatedEmails = new Set<string>();
  const testEmail = () => {
    const email = `${crypto.randomUUID()}@${testEmailDomain}`;
    generatedEmails.add(email);
    return email;
  };
  const users = {
    ownerA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: "Owner A" },
    adminA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: "Admin A" },
    memberA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: "Member A" },
    ownerB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: "Owner B" },
    sharedB: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: "Shared User Name" },
    existingA: { id: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: "Existing A" },
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
  const makeHandler = (identity: AuthenticatedUser | null) => createEmployeeImportHandler({
    async requireTenantContext() {
      return resolveTenantContext(identity, undefined, membershipStore);
    },
    async requirePermission(organizationId, permission) {
      return requireOrganizationPermission(identity, organizationId, permission, membershipStore);
    },
    store,
    isTrustedRequest: () => true,
    logError: () => {},
  });
  const request = (
    csv: string | Uint8Array,
    fields: Record<string, string> = {},
    filename = "employees.csv",
  ) => {
    const form = new FormData();
    let blobPart: BlobPart;
    if (typeof csv === "string") {
      blobPart = csv;
    } else {
      const bytes = new ArrayBuffer(csv.byteLength);
      new Uint8Array(bytes).set(csv);
      blobPart = bytes;
    }
    form.append("file", new Blob([blobPart], { type: "text/csv" }), filename);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return new Request(`https://lms.example.test/api/organizations/employees/import?organizationId=${orgB}`, {
      method: "POST",
      headers: {
        "x-organization-id": orgB,
        "x-organization-role": "OWNER",
      },
      body: form,
    });
  };

  let triggerName: string | null = null;
  let functionName: string | null = null;
  try {
    await db.organization.createMany({ data: [
      { id: orgA, name: "Import Tenant A", slug: `${orgA}-employee-import-test` },
      { id: orgB, name: "Import Tenant B", slug: `${orgB}-employee-import-test` },
    ] });
    await db.user.createMany({ data: Object.values(users) });
    const memberships = await db.organizationMembership.createManyAndReturn({ data: [
      { userId: users.ownerA.id, organizationId: orgA, role: "OWNER", employeeName: "Owner A" },
      { userId: users.adminA.id, organizationId: orgA, role: "ADMIN", employeeName: "Admin A" },
      { userId: users.memberA.id, organizationId: orgA, role: "MEMBER", employeeName: "Member A" },
      { userId: users.existingA.id, organizationId: orgA, role: "MEMBER", employeeName: "Existing A", employeeNumber: "A-TAKEN" },
      { userId: users.ownerB.id, organizationId: orgB, role: "OWNER", employeeName: "Owner B" },
      { userId: users.sharedB.id, organizationId: orgB, role: "MEMBER", employeeName: "Shared B", jobTitle: "B-only title", department: "Tenant B", phone: "B-only phone", employeeNumber: "CROSS-ORG-001" },
    ] });
    const sharedMembershipB = memberships.find((item) => item.userId === users.sharedB.id && item.organizationId === orgB);
    assert.ok(sharedMembershipB);
    const teamB = await db.team.create({
      data: { organizationId: orgB, name: "Tenant B team" },
      select: { id: true },
    });
    await db.teamMembership.create({
      data: { organizationId: orgB, teamId: teamB.id, membershipId: sharedMembershipB.id },
    });

    const owner = makeHandler(asUser(users.ownerA));
    const admin = makeHandler(asUser(users.adminA));
    const member = makeHandler(asUser(users.memberA));
    const anonymous = makeHandler(null);

    const oneRowEmail = testEmail();
    const oneRow = await admin(request(`email,name\n${oneRowEmail},One Row Employee\n`));
    assert.equal(oneRow.status, 200);
    assert.deepEqual(await oneRow.json(), { imported: 1 });
    const oneRowMembership = await db.organizationMembership.findFirstOrThrow({
      where: { organizationId: orgA, user: { email: oneRowEmail } },
    });
    assert.equal(oneRowMembership.role, "MEMBER");
    assert.equal(oneRowMembership.active, true);
    assert.equal(oneRowMembership.organizationId, orgA);

    const newEmployeeEmail = testEmail();
    const importedCsv = [
      "employeeNumber,email,department,name,phone,jobTitle",
      `NEW-001,${newEmployeeEmail},\"People, Ops\",\"Doe, Jane\",+32-1,\"Head of, People\"`,
      `CROSS-ORG-001,${users.sharedB.email},Learning,Shared Imported,+32-2,Teacher`,
    ].join("\r\n");
    const importedResponse = await owner(request(importedCsv, {}, "../../untrusted.csv"));
    assert.equal(importedResponse.status, 200);
    assert.equal(importedResponse.headers.get("cache-control"), "no-store");
    assert.deepEqual(await importedResponse.json(), { imported: 2 });

    const newUser = await db.user.findUniqueOrThrow({ where: { email: newEmployeeEmail } });
    assert.ok(newUser);
    const created = await db.organizationMembership.findMany({
      where: { organizationId: orgA, employeeName: { in: ["Doe, Jane", "Shared Imported"] } },
      include: { user: true },
      orderBy: { employeeName: "asc" },
    });
    assert.equal(created.length, 2);
    const jane = created.find((item) => item.employeeName === "Doe, Jane");
    const sharedA = created.find((item) => item.employeeName === "Shared Imported");
    assert.ok(jane && sharedA);
    assert.equal(jane.role, "MEMBER");
    assert.equal(jane.active, true);
    assert.equal(jane.organizationId, orgA);
    assert.equal(jane.employeeNumber, "NEW-001");
    assert.equal(jane.department, "People, Ops");
    assert.equal(jane.jobTitle, "Head of, People");
    assert.equal(jane.phone, "+32-1");
    assert.equal(jane.user.email, newEmployeeEmail);
    assert.equal(sharedA.userId, users.sharedB.id, "a global identity from B is reused in A");
    assert.equal(sharedA.employeeNumber, "CROSS-ORG-001", "employee numbers are unique only within an organization");
    assert.equal(sharedA.role, "MEMBER");
    assert.equal(sharedA.active, true);

    const sharedAfter = await db.organizationMembership.findUniqueOrThrow({ where: { id: sharedMembershipB.id } });
    assert.equal(sharedAfter.employeeName, "Shared B");
    assert.equal(sharedAfter.jobTitle, "B-only title");
    assert.equal(sharedAfter.department, "Tenant B");
    assert.equal(sharedAfter.phone, "B-only phone");
    assert.equal(sharedAfter.employeeNumber, "CROSS-ORG-001");
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgB, membershipId: sharedMembershipB.id } }), 1);
    assert.equal(await db.passwordCredential.count({ where: { userId: sharedA.userId } }), 0);
    assert.equal(await db.passwordCredential.count({ where: { userId: jane.userId } }), 0);
    assert.equal(await db.employeeInvitation.count({ where: { membershipId: sharedA.id } }), 0);
    assert.equal(await db.employeeInvitation.count({ where: { membershipId: jane.id } }), 0);
    assert.equal(await db.teamMembership.count({ where: { organizationId: orgA, membershipId: { in: created.map(({ id }) => id) } } }), 0);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: users.sharedB.id } })).name, "Shared User Name");

    const beforeConflictCount = await db.organizationMembership.count({ where: { organizationId: orgA } });
    const beforeUser = await db.user.findUnique({ where: { email: users.existingA.email } });
    assert.ok(beforeUser);
    const attemptedBeforeConflict = testEmail();
    const currentEmployeeConflict = await owner(request(
      `email,name\n${attemptedBeforeConflict},New Employee\n${users.existingA.email},Changed Existing\n`,
    ));
    assert.equal(currentEmployeeConflict.status, 409);
    assert.deepEqual((await currentEmployeeConflict.json() as { errors: unknown[] }).errors, [
      { row: 3, field: "email", code: "employee_already_exists" },
    ]);
    assert.equal(await db.organizationMembership.count({ where: { organizationId: orgA } }), beforeConflictCount);
    assert.equal(await db.user.findUnique({ where: { email: attemptedBeforeConflict } }), null);
    const unchangedExisting = await db.organizationMembership.findFirstOrThrow({
      where: { organizationId: orgA, userId: users.existingA.id },
    });
    assert.equal(unchangedExisting.employeeName, "Existing A");

    const numberConflictEmail = testEmail();
    const numberConflict = await owner(request(
      `email,name,employeeNumber\n${numberConflictEmail},New Number,A-TAKEN\n`,
    ));
    assert.equal(numberConflict.status, 409);
    assert.deepEqual((await numberConflict.json() as { errors: unknown[] }).errors, [
      { row: 2, field: "employeeNumber", code: "employee_number_conflict" },
    ]);
    assert.equal(await db.user.findUnique({ where: { email: numberConflictEmail } }), null);

    const invalidBatchEmail = testEmail();
    const invalidBatch = await owner(request(
      `email,name\n${invalidBatchEmail},Valid Name\nbad-email,Invalid Name\n`,
    ));
    assert.equal(invalidBatch.status, 400);
    assert.equal(await db.user.findUnique({ where: { email: invalidBatchEmail } }), null);

    for (const [csv, expectedCode] of [
      [`email,name,unknown\n${testEmail()},Valid Name,value\n`, "unsupported_header"],
      [`email,email,name\n${testEmail()},${testEmail()},Valid Name\n`, "duplicate_header"],
      [`email\n${testEmail()}\n`, "missing_required_header"],
      ["email,name\n\"bad\n", "malformed_csv"],
      ["", "empty_file"],
      ["email,name\n", "no_employee_rows"],
    ] as const) {
      const rejected = await owner(request(csv));
      assert.equal(rejected.status, 400);
      assert.equal((await rejected.json() as { errors: { code: string }[] }).errors[0]?.code, expectedCode);
    }

    const wrongColumns = await owner(request(`email,name\n${testEmail()},Valid Name,extra\n`));
    assert.equal(wrongColumns.status, 400);
    assert.deepEqual((await wrongColumns.json() as { errors: unknown[] }).errors, [
      { row: 2, field: "row", code: "column_count_mismatch" },
    ]);

    const csvDuplicate = await owner(request(
      `email,name,employeeNumber\n${testEmail()},First Person,CSV-DUP\n${testEmail()},Second Person,CSV-DUP\n`,
    ));
    assert.equal(csvDuplicate.status, 400);
    assert.equal((await csvDuplicate.json() as { errors: { code: string }[] }).errors[0]?.code, "duplicate_employee_number");

    const duplicateEmail = testEmail();
    const duplicateEmails = await owner(request(
      `email,name\n${duplicateEmail},First Person\n${duplicateEmail},Second Person\n`,
    ));
    assert.equal(duplicateEmails.status, 400);
    assert.equal((await duplicateEmails.json() as { errors: { code: string }[] }).errors[0]?.code, "duplicate_email");

    const forbiddenHeaders = await owner(request(
      `email,name,role,active,organizationId,tenantId,team,teamId,password\n${testEmail()},Valid Name,MEMBER,true,forged,forged,x,x,x\n`,
    ));
    assert.equal(forbiddenHeaders.status, 400);
    const extraFormValue = await owner(request(`email,name\n${testEmail()},Valid Name\n`, { organizationId: orgB }));
    assert.equal(extraFormValue.status, 400);

    const tooManyRows = await owner(request(`email,name\n${Array.from(
      { length: 501 }, (_, index) => `${testEmail()},Employee ${index}`,
    ).join("\n")}`));
    assert.equal(tooManyRows.status, 400);
    assert.equal((await tooManyRows.json() as { errors: { code: string }[] }).errors[0]?.code, "too_many_rows");

    const tooLarge = await owner(request("x".repeat(1024 * 1024 + 1)));
    assert.equal(tooLarge.status, 413);
    assert.equal((await tooLarge.json() as { errors: { code: string }[] }).errors[0]?.code, "file_too_large");

    const deniedMemberEmail = testEmail();
    const deniedMemberAgain = await member(request(`email,name\n${deniedMemberEmail},Denied Member\n`));
    assert.equal(deniedMemberAgain.status, 403);
    const deniedAnonymousEmail = testEmail();
    const deniedAnonymousAgain = await anonymous(request(`email,name\n${deniedAnonymousEmail},Anonymous User\n`));
    assert.equal(deniedAnonymousAgain.status, 401);
    assert.equal(await db.user.findUnique({ where: { email: deniedMemberEmail } }), null);
    assert.equal(await db.user.findUnique({ where: { email: deniedAnonymousEmail } }), null);

    const concurrentEmail = testEmail();
    const concurrentCsv = `email,name\n${concurrentEmail},Concurrent Employee\n`;
    const concurrent = await Promise.all([
      owner(request(concurrentCsv)),
      admin(request(concurrentCsv)),
    ]);
    assert.deepEqual(concurrent.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(await db.organizationMembership.count({ where: { organizationId: orgA, user: { email: concurrentEmail } } }), 1);

    const concurrentNumber = "PARALLEL-NUMBER-001";
    const concurrentNumberResults = await Promise.all([
      owner(request(`email,name,employeeNumber\n${testEmail()},Parallel One,${concurrentNumber}\n`)),
      admin(request(`email,name,employeeNumber\n${testEmail()},Parallel Two,${concurrentNumber}\n`)),
    ]);
    assert.deepEqual(concurrentNumberResults.map(({ status }) => status).sort(), [200, 409]);
    assert.equal(await db.organizationMembership.count({ where: { organizationId: orgA, employeeNumber: concurrentNumber } }), 1);

    // A database trigger introduces an organization-local employee-number
    // collision after the store's preflight read but inside its transaction.
    // The failed membership insert must roll back both its User and trigger row.
    const triggerSuffix = crypto.randomUUID().replaceAll("-", "");
    triggerName = `lms017_import_trigger_${triggerSuffix}`;
    functionName = `lms017_import_function_${triggerSuffix}`;
    const triggerEmail = testEmail();
    const triggerCsv = `email,name,employeeNumber\n${triggerEmail},Trigger Employee,ROLLBACK-DB-001\n`;
    await db.$executeRawUnsafe(`CREATE FUNCTION "${functionName}"() RETURNS trigger AS $body$
      BEGIN
        IF NEW."email" = '${triggerEmail}' THEN
          INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "employeeName", "employeeNumber", "createdAt", "updatedAt")
          VALUES (gen_random_uuid(), NEW."id", '${orgA}'::uuid, 'MEMBER', 'Trigger conflict', 'ROLLBACK-DB-001', now(), now());
        END IF;
        RETURN NEW;
      END;
    $body$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "${triggerName}" AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION "${functionName}"()`);
    const databaseConflict = await owner(request(triggerCsv));
    assert.equal(databaseConflict.status, 503);
    assert.deepEqual(await databaseConflict.json(), { error: "employee_import_unavailable" });
    assert.equal(await db.user.findUnique({ where: { email: triggerEmail } }), null);
    assert.equal(await db.organizationMembership.count({ where: { organizationId: orgA, employeeNumber: "ROLLBACK-DB-001" } }), 0);

    const conflictRollbackNewUser = testEmail();
    // Validation of an existing employee conflict also rejects the complete
    // batch before creating earlier rows in it.
    const allOrNothing = await owner(request(
      `email,name\n${conflictRollbackNewUser},New First\n${users.existingA.email},Existing Second\n`,
    ));
    assert.equal(allOrNothing.status, 409);
    assert.equal(await db.user.findUnique({ where: { email: conflictRollbackNewUser } }), null);
  } finally {
    if (triggerName) await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${triggerName}" ON "User"`).catch(() => {});
    if (functionName) await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${functionName}"()`).catch(() => {});
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.user.deleteMany({ where: { email: { in: [...generatedEmails] } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(users).map(({ id }) => id) } } });
    await db.$disconnect();
  }
});
