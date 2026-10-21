const EXPECTED_DATABASE = "lms_platform_e2e";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function parsePostgresUrl(value: string, name: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL.`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${name} must use the PostgreSQL protocol.`);
  }
  return parsed;
}

export function validateE2EDatabaseUrl(value: string): URL {
  const parsed = parsePostgresUrl(value, "E2E_DATABASE_URL");
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("E2E_DATABASE_URL must point to a loopback PostgreSQL host.");
  }
  if (decodeURIComponent(parsed.pathname.slice(1)) !== EXPECTED_DATABASE) {
    throw new Error(`E2E_DATABASE_URL must target the dedicated ${EXPECTED_DATABASE} database.`);
  }
  return parsed;
}

export function validateE2EEnvironment(env: NodeJS.ProcessEnv): void {
  if (!env.E2E_DATABASE_URL) {
    throw new Error("Set E2E_DATABASE_URL in .env.e2e.local before running Playwright.");
  }
  const e2e = validateE2EDatabaseUrl(env.E2E_DATABASE_URL);
  for (const name of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
    const candidate = env[name];
    if (!candidate) continue;
    const other = parsePostgresUrl(candidate, name);
    if (other.origin === e2e.origin && other.pathname === e2e.pathname) {
      throw new Error(`E2E_DATABASE_URL must be different from ${name}.`);
    }
  }

  const baseURL = env.E2E_BASE_URL ?? "http://127.0.0.1:3100";
  let app: URL;
  try {
    app = new URL(baseURL);
  } catch {
    throw new Error("E2E_BASE_URL must be a valid local HTTP URL.");
  }
  if (app.protocol !== "http:" || !LOOPBACK_HOSTS.has(app.hostname)) {
    throw new Error("E2E_BASE_URL must use HTTP on a loopback host.");
  }
  if (app.port !== "3100") {
    throw new Error("E2E_BASE_URL must use port 3100.");
  }
}

export function assertCurrentDatabase(actual: string): void {
  if (actual !== EXPECTED_DATABASE) {
    throw new Error(`Refusing destructive E2E setup: connected database is ${actual}, expected ${EXPECTED_DATABASE}.`);
  }
}
