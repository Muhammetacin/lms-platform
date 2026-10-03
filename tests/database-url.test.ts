import assert from "node:assert/strict";
import test from "node:test";
import { requireDatabaseUrl } from "../src/lib/database-url.ts";

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
