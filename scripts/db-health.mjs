import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { requireDatabaseUrl } from "../src/lib/database-url.ts";

let client;
try {
  client = new PrismaClient({
    adapter: new PrismaPg({ connectionString: requireDatabaseUrl() }),
  });
  await client.$queryRaw`SELECT 1`;
  process.stdout.write("Database connection healthy.\n");
} catch {
  process.stderr.write("Database health check failed. Verify local configuration and database availability.\n");
  process.exitCode = 1;
} finally {
  await client?.$disconnect();
}
