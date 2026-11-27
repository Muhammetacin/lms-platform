import { Pool } from "pg";
import { loginRateLimitKeys, LOGIN_ACCOUNT_LIMIT } from "../../src/lib/login-rate-limit.ts";
import { assertCurrentDatabase, validateE2EDatabaseUrl } from "./support/database-url.ts";
import { expect, test } from "./support/fixtures.ts";
import { login, apiRequest } from "./support/flows.ts";

test("the login form reports throttling and authenticated team writes produce audit events", async ({ page, e2e }) => {
  const databaseUrl = process.env.E2E_DATABASE_URL!;
  validateE2EDatabaseUrl(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const email = `blocked-${crypto.randomUUID()}@example.test`;
  const key = loginRateLimitKeys(new Headers(), email, {
    production: false, secret: process.env.LOGIN_RATE_LIMIT_SECRET,
  }).account;
  try {
    const { rows: databases } = await pool.query<{ name: string }>("SELECT current_database() AS name");
    assertCurrentDatabase(databases[0]!.name);
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("fixture-unused-password");
    await pool.query(`
      INSERT INTO "LoginAttemptBucket" ("key", "windowEnd", "attempts")
      SELECT $1, date_bin(interval '5 minutes', statement_timestamp(), timestamptz '2000-01-01 00:00:00Z')
        + offset_minutes * interval '1 minute', $2
      FROM unnest(ARRAY[5, 10]) AS offset_minutes
    `, [key, LOGIN_ACCOUNT_LIMIT]);
    const response = page.waitForResponse((candidate) => candidate.url().endsWith("/api/auth/login"));
    await page.getByRole("button", { name: "Sign in" }).click();
    expect((await response).status()).toBe(429);
    expect((await response).headers()["retry-after"]).toBe("300");
    await expect(page.getByRole("alert").filter({ hasText: "Too many sign-in attempts" })).toBeVisible();

    await login(page, e2e.users.adminA);
    const created = await apiRequest(page, "/api/organizations/teams", "POST", { name: `Audit ${crypto.randomUUID()}` });
    expect(created.status).toBe(201);
    const { id } = (created.body as { team: { id: string } }).team;
    expect((await apiRequest(page, `/api/organizations/teams/${id}`, "DELETE", {})).status).toBe(200);
    const { rows: events } = await pool.query(`
      SELECT event.action, account.email
      FROM "AuditEvent" event
      JOIN "User" account ON account.id = event."actorUserId"
      WHERE event."organizationId" = $1 AND event."targetId" = $2
      ORDER BY event.action
    `, [e2e.organizationA.id, id]);
    expect(events).toEqual([
      { action: "TEAM_CREATED", email: e2e.users.adminA.email },
      { action: "TEAM_DELETED", email: e2e.users.adminA.email },
    ]);
  } finally {
    await pool.end();
  }
});
