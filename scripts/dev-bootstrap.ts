import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { hashPassword } from "../src/lib/auth-core.ts";
import {
  bootstrapDevelopmentOwner,
  DevelopmentBootstrapError,
  isProductionLikeEnvironment,
} from "../src/lib/dev-bootstrap-core.ts";
import { createPrismaDevelopmentBootstrapStore } from "../src/lib/dev-bootstrap-prisma-store.ts";

loadEnv({ path: [".env.local", ".env"] });

async function main() {
  if (isProductionLikeEnvironment(process.env)) {
    throw new DevelopmentBootstrapError("Development bootstrap is disabled in production environments.");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new DevelopmentBootstrapError("DATABASE_URL is required. Configure it in .env.local before bootstrapping.");
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const result = await bootstrapDevelopmentOwner(
      process.env,
      createPrismaDevelopmentBootstrapStore(db),
      hashPassword,
    );
    console.log(`${result.created ? "Development owner ready" : "Development owner already ready"}: ${result.email}`);
    console.log(`Organization: ${result.organizationName}`);
    if (!result.created) console.log("Existing password credential was preserved.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof DevelopmentBootstrapError
    ? error.message
    : "Development bootstrap failed. Check the local database and migration state.";
  console.error(message);
  process.exitCode = 1;
});
