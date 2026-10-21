import { unlink } from "node:fs/promises";
import { Pool } from "pg";
import { assertCurrentDatabase, validateE2EDatabaseUrl } from "./support/database-url.ts";

export default async function globalTeardown() {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required for E2E teardown.");
  validateE2EDatabaseUrl(databaseUrl);
  const db = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const current = await db.query<{ current_database: string }>("SELECT current_database()");
    assertCurrentDatabase(current.rows[0]?.current_database ?? "");
    await db.query('TRUNCATE TABLE "Organization", "User" CASCADE');
  } finally {
    await db.end();
    if (process.env.LMS_E2E_FIXTURE_FILE) await unlink(process.env.LMS_E2E_FIXTURE_FILE).catch(() => undefined);
  }
}
