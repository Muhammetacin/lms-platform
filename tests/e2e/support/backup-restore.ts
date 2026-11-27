import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { assertCurrentDatabase, validateE2EDatabaseUrl } from "./database-url.ts";

const tables = [
  "Organization", "Course", "CourseModule", "Lesson", "OrganizationMembership",
  "CourseMemberAssignment", "LessonCompletion", "AuditEvent", "_prisma_migrations",
] as const;

async function snapshot(pool: Pool) {
  return Promise.all(tables.map(async (table) => {
    const { rows } = await pool.query<{ count: number; digest: string }>(`
      SELECT count(*)::int AS count,
        md5(string_agg(to_jsonb(record)::text, '' ORDER BY to_jsonb(record)::text)) AS digest
      FROM "${table}" AS record
    `);
    const fingerprint = rows[0]!;
    assert.ok(fingerprint.count > 0, `Expected seeded rows in ${table}`);
    return { table, ...fingerprint };
  }));
}

export async function verifyBackupAndRestore() {
  const container = process.env.E2E_POSTGRES_CONTAINER_ID;
  if (process.env.CI !== "true" || !container || !/^[a-f0-9]{64}$/.test(container)) {
    throw new Error("Restore rehearsal requires the isolated CI PostgreSQL service.");
  }
  const sourceUrl = validateE2EDatabaseUrl(process.env.E2E_DATABASE_URL!);
  const sourceName = sourceUrl.pathname.slice(1);
  const restoreName = `lms_e2e_restore_${randomUUID().replaceAll("-", "")}`;
  const restoreUrl = new URL(sourceUrl);
  restoreUrl.pathname = "/" + restoreName;
  const source = new Pool({ connectionString: sourceUrl.href, max: 1 });
  const target = new Pool({ connectionString: restoreUrl.href, max: 1 });
  const role = decodeURIComponent(sourceUrl.username);

  const run = (args: string[], input?: Buffer) => execFileSync(
    "docker", ["exec", "-i", container, ...args, "--username", role], {
      input, maxBuffer: 16 * 1024 * 1024, timeout: 25_000,
    },
  );

  let created = false;
  try {
    const database = await source.query<{ name: string }>("SELECT current_database() AS name");
    assertCurrentDatabase(database.rows[0]!.name);
    const before = await snapshot(source);
    const archive = run(["pg_dump", "--format=custom", "--dbname", sourceName]);
    await source.query(`CREATE DATABASE "${restoreName}" TEMPLATE template0`);
    created = true;
    run(["pg_restore", "--exit-on-error", "--no-owner", "--no-privileges", "--dbname", restoreName], archive);
    const restored = await target.query<{ name: string }>("SELECT current_database() AS name");
    assert.equal(restored.rows[0]!.name, restoreName);
    assert.deepEqual(await snapshot(target), before);
    console.log(`Restored and verified ${before.length} populated tables in a separate PostgreSQL database.`);
  } finally {
    try {
      await target.end();
      if (created) await source.query(`DROP DATABASE "${restoreName}"`);
    } finally {
      await source.end();
    }
  }
}
