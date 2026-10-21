import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { validateE2EEnvironment } from "./tests/e2e/support/database-url.ts";

dotenv.config({ path: ".env.e2e.local" });
validateE2EEnvironment(process.env);

const baseURL = process.env.E2E_BASE_URL!;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["html", { outputFolder: "playwright-report", open: "never" }], ["line"]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  outputDir: "test-results",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
  },
  webServer: {
    command: "pnpm dev --hostname 127.0.0.1 --port 3100",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: process.env.E2E_DATABASE_URL!,
      NEXT_PUBLIC_APP_URL: baseURL,
      NODE_ENV: "development",
    },
  },
});
