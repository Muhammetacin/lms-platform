import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { hashPassword } from "../../src/lib/auth-core.ts";
import { assertCurrentDatabase, validateE2EDatabaseUrl } from "./support/database-url.ts";
import type { E2EData } from "./support/fixtures.ts";

export default async function globalSetup() {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required for E2E setup.");
  validateE2EDatabaseUrl(databaseUrl);
  const db = new Pool({ connectionString: databaseUrl, max: 1 });
  const runId = randomUUID();
  const password = `Lms087-${randomUUID()}-pass`;
  const fixtures: E2EData = {
    organizationA: { id: randomUUID(), name: `LMS E2E Organization A ${runId.slice(0, 8)}` },
    organizationB: { id: randomUUID(), name: `LMS E2E Organization B ${runId.slice(0, 8)}` },
    users: {
      ownerA: { email: `owner-a-${runId}@example.test`, password, role: "OWNER" },
      adminA: { email: `admin-a-${runId}@example.test`, password, role: "ADMIN" },
      memberA: { email: `member-a-${runId}@example.test`, password, role: "MEMBER" },
      ownerB: { email: `owner-b-${runId}@example.test`, password, role: "OWNER" },
      inactiveMember: { email: `inactive-member-${runId}@example.test`, password, role: "MEMBER" },
    },
  };
  const users = [
    { user: fixtures.users.ownerA, organizationId: fixtures.organizationA.id, active: true },
    { user: fixtures.users.adminA, organizationId: fixtures.organizationA.id, active: true },
    { user: fixtures.users.memberA, organizationId: fixtures.organizationA.id, active: true },
    { user: fixtures.users.ownerB, organizationId: fixtures.organizationB.id, active: true },
    { user: fixtures.users.inactiveMember, organizationId: fixtures.organizationA.id, active: false },
  ];

  try {
    const current = await db.query<{ current_database: string }>("SELECT current_database()");
    assertCurrentDatabase(current.rows[0]?.current_database ?? "");
    await db.query('TRUNCATE TABLE "Organization", "User", "LoginAttemptBucket" CASCADE');

    const seedUsers = await Promise.all(users.map(async (entry) => ({
      ...entry,
      passwordHash: await hashPassword(entry.user.password),
    })));
    await db.query("BEGIN");
    try {
      await db.query(
        'INSERT INTO "Organization" ("id", "name", "slug", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW()), ($4, $5, $6, NOW(), NOW())',
        [fixtures.organizationA.id, fixtures.organizationA.name, `lms-e2e-a-${runId}`, fixtures.organizationB.id, fixtures.organizationB.name, `lms-e2e-b-${runId}`],
      );
      for (const { user, organizationId, active, passwordHash } of seedUsers) {
        const userId = randomUUID();
        await db.query(
          'INSERT INTO "User" ("id", "email", "name", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())',
          [userId, user.email, user.role],
        );
        await db.query(
          'INSERT INTO "PasswordCredential" ("id", "userId", "passwordHash", "createdAt", "updatedAt") VALUES ($1, $2, $3, NOW(), NOW())',
          [randomUUID(), userId, passwordHash],
        );
        await db.query(
          'INSERT INTO "OrganizationMembership" ("id", "userId", "organizationId", "role", "active", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, NOW(), NOW())',
          [randomUUID(), userId, organizationId, user.role, active],
        );
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }

    const fixturePath = join(tmpdir(), `lms-e2e-${runId}.json`);
    await writeFile(fixturePath, JSON.stringify(fixtures), { encoding: "utf8", mode: 0o600, flag: "wx" });
    process.env.LMS_E2E_FIXTURE_FILE = fixturePath;
  } catch (error) {
    try {
      const current = await db.query<{ current_database: string }>("SELECT current_database()");
      assertCurrentDatabase(current.rows[0]?.current_database ?? "");
      await db.query('TRUNCATE TABLE "Organization", "User", "LoginAttemptBucket" CASCADE');
    } catch {
      // Preserve the original setup failure; the database guard still prevents cleanup elsewhere.
    }
    throw error;
  } finally {
    await db.end();
  }
}
