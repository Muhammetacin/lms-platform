import { readFile } from "node:fs/promises";
import { test as base, expect } from "@playwright/test";

export type E2EUser = { email: string; password: string; role: "OWNER" | "ADMIN" | "MEMBER" };
export type E2EData = {
  organizationA: { id: string; name: string };
  organizationB: { id: string; name: string };
  users: { ownerA: E2EUser; adminA: E2EUser; memberA: E2EUser; ownerB: E2EUser };
};

let cached: E2EData | undefined;
export async function e2eData(): Promise<E2EData> {
  if (cached) return cached;
  const fixturePath = process.env.LMS_E2E_FIXTURE_FILE;
  if (!fixturePath) throw new Error("Playwright fixture file is unavailable.");
  cached = JSON.parse(await readFile(fixturePath, "utf8")) as E2EData;
  return cached;
}

export const test = base.extend<{ e2e: E2EData }>({
  e2e: async ({}, use) => {
    const provideFixture = use;
    await provideFixture(await e2eData());
  },
});

export { expect };
