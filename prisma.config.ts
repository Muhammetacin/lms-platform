import "dotenv/config";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL;
const schemaOnlyCommands = ["generate", "validate", "diff"];
if (!databaseUrl && !schemaOnlyCommands.some((command) => process.argv.includes(command))) {
  throw new Error("DATABASE_URL is required for Prisma database commands. Configure it in an ignored local environment file.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma requires a valid URL even for schema-only commands, though they do
    // not connect. This credential-free local URL is never used for migrations.
    url: databaseUrl ?? "postgresql://localhost:5432/lms_platform?schema=public",
  },
});
