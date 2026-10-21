import { execSync } from "node:child_process";
import { Pool } from "pg";
import { config as loadEnv } from "dotenv";
import {
  assertCurrentDatabase,
  validateE2EDatabaseUrl,
  withTemporaryDatabaseUrl,
} from "../tests/e2e/support/database-url.ts";

async function main() {
  loadEnv({ path: ".env.e2e.local" });

  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set E2E_DATABASE_URL in .env.e2e.local before running E2E migrations.");
  }

  validateE2EDatabaseUrl(databaseUrl);

  const db = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let currentDatabase: string | undefined;
  try {
    const result = await db.query<{ current_database: string }>("SELECT current_database()");
    currentDatabase = result.rows[0]?.current_database;
  } catch {
    throw new Error("E2E_DATABASE_URL must connect to a running local PostgreSQL database before migration.");
  } finally {
    await db.end();
  }
  assertCurrentDatabase(currentDatabase ?? "");

  try {
    withTemporaryDatabaseUrl(process.env, databaseUrl, () => {
      execSync("pnpm db:migrate:deploy", { stdio: "inherit" });
    });
  } catch {
    throw new Error("E2E Prisma migrations failed. The previous DATABASE_URL has been restored.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "E2E migration failed.");
  process.exitCode = 1;
});
