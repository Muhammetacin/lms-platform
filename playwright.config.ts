import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { validateE2EEnvironment } from "./tests/e2e/support/database-url.ts";

dotenv.config({ path: ".env.e2e.local" });
validateE2EEnvironment(process.env);

const baseURL = process.env.E2E_BASE_URL!;
const production = process.env.E2E_PRODUCTION === "1";
const reportDirectory = production ? "playwright-production-report" : "playwright-report";
const brevoFixture = pathToFileURL(resolve("tests/e2e/support/brevo-fixture.mjs")).href;
const serverEnv = {
  DATABASE_URL: process.env.E2E_DATABASE_URL!,
  NEXT_PUBLIC_APP_URL: baseURL,
};

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: production ? [] : "**/production/**",
  testMatch: production ? "**/production/*.spec.ts" : undefined,
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["html", { outputFolder: reportDirectory, open: "never" }], ["line"]]
    : [["list"], ["html", { outputFolder: reportDirectory, open: "never" }]],
  outputDir: production ? "production-test-results" : "test-results",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    ignoreHTTPSErrors: production,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
  },
  webServer: production ? [
    {
      command: "pnpm start --hostname 127.0.0.1 --port 3101",
      port: 3101,
      env: {
        ...serverEnv,
        NODE_ENV: "production",
        BREVO_API_KEY: "ci-brevo-fixture",
        EMAIL_FROM_ADDRESS: "invitations@example.test",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${brevoFixture}`.trim(),
        LOGIN_RATE_LIMIT_SECRET: "production-e2e-fixture-secret-not-for-real-deployments",
        LOGIN_TRUSTED_CLIENT_IP_HEADER: "x-lms-test-client-ip",
      },
    },
    {
      command: "node tests/e2e/support/production-proxy.mjs",
      url: baseURL,
      ignoreHTTPSErrors: true,
    },
  ] : {
    command: "pnpm dev --hostname 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ...serverEnv, NODE_ENV: "development" },
  },
});
