export function requireDatabaseUrl(value = process.env.DATABASE_URL): string {
  if (!value) {
    throw new Error("DATABASE_URL is required. Set it in an ignored local environment file.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }

  if ((parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error("DATABASE_URL must identify a PostgreSQL host and database.");
  }

  return value;
}
