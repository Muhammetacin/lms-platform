import assert from "node:assert/strict";
import test from "node:test";
import { requireDatabaseUrl } from "../src/lib/database-url.ts";
import { withTemporaryDatabaseUrl } from "./e2e/support/database-url.ts";

test("accepts a PostgreSQL URL without returning or logging it", () => {
  const value = "postgresql://example:placeholder@localhost:5432/lms_platform";
  assert.equal(requireDatabaseUrl(value), value);
});

test("requires database configuration", () => {
  assert.throws(() => requireDatabaseUrl(undefined), /DATABASE_URL is required/);
});

test("rejects malformed or non-PostgreSQL URLs", () => {
  assert.throws(() => requireDatabaseUrl("not a URL"), /valid PostgreSQL connection URL/);
  assert.throws(() => requireDatabaseUrl("https://localhost/database"), /must identify a PostgreSQL host and database/);
  assert.throws(() => requireDatabaseUrl("postgresql://localhost"), /must identify a PostgreSQL host and database/);
});

test("restores the original DATABASE_URL after a temporary migration target succeeds", () => {
  const env: NodeJS.ProcessEnv = { DATABASE_URL: "postgresql://localhost/lms_platform", NODE_ENV: "test" };
  const result = withTemporaryDatabaseUrl(env, "postgresql://localhost/lms_platform_e2e", () => {
    assert.equal(env.DATABASE_URL, "postgresql://localhost/lms_platform_e2e");
    return "migrated";
  });

  assert.equal(result, "migrated");
  assert.equal(env.DATABASE_URL, "postgresql://localhost/lms_platform");
});

test("restores DATABASE_URL after a failed migration and removes it if it was initially unset", () => {
  const originalEnv: NodeJS.ProcessEnv = { DATABASE_URL: "postgresql://localhost/lms_platform", NODE_ENV: "test" };
  assert.throws(() => withTemporaryDatabaseUrl(originalEnv, "postgresql://localhost/lms_platform_e2e", () => {
    throw new Error("migration failed");
  }), /migration failed/);
  assert.equal(originalEnv.DATABASE_URL, "postgresql://localhost/lms_platform");

  const emptyEnv: NodeJS.ProcessEnv = { NODE_ENV: "test" };
  assert.throws(() => withTemporaryDatabaseUrl(emptyEnv, "postgresql://localhost/lms_platform_e2e", () => {
    throw new Error("migration failed");
  }), /migration failed/);
  assert.equal(Object.hasOwn(emptyEnv, "DATABASE_URL"), false);
});
