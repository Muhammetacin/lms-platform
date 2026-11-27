import { expect, test } from "./support/fixtures.ts";
import { apiRequest, login } from "./support/flows.ts";

test("guests visiting the root or learner portal are redirected to sign-in", async ({ page }) => {
  for (const path of ["/", "/learn"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mijn cursussen" })).toHaveCount(0);
  }
});

test("active members reach their learner home without access to administration", async ({ page, e2e }) => {
  await login(page, e2e.users.memberA);
  await expect(page.getByRole("heading", { name: "Mijn cursussen", level: 1 })).toBeVisible();

  for (const path of ["/", "/login"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/learn$/);
  }

  await page.goto(`/learn?organizationId=${e2e.organizationB.id}`);
  await expect(page.getByRole("heading", { name: "Je hebt nog geen cursussen" })).toBeVisible();
  await expect(page.getByText(e2e.organizationB.name, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Administration" })).toHaveCount(0);
  expect((await apiRequest(page, "/api/organizations/courses", "GET")).status).toBe(403);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
});

test("owner and admin keep their dashboard as the entry point", async ({ page, e2e }) => {
  for (const user of [e2e.users.ownerA, e2e.users.adminA]) {
    await login(page, user);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await page.goto("/learn");
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("navigation", { name: "Administration" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  }
});

test("signed-in users with an inactive membership can exit the denied state", async ({ page, e2e }) => {
  await login(page, e2e.users.inactiveMember, "/");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();

  await page.goto(`/learn?organizationId=${e2e.organizationA.id}`);
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Mijn cursussen" })).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/learn");
  await expect(page).toHaveURL(/\/login$/);
});

test("the learner home fits a narrow screen and supports keyboard sign-out", async ({ page, e2e }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await login(page, e2e.users.memberA);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Je hebt nog geen cursussen" })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);

  const homeLink = page.getByRole("link", { name: "LMS Platform — Mijn cursussen" });
  const logout = page.getByRole("button", { name: "Uitloggen" });
  await expect(homeLink).toHaveAttribute("aria-current", "page");
  await homeLink.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Catalogus", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(logout).toBeFocused();
  await expect(logout).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/learn");
  await expect(page).toHaveURL(/\/login$/);
});
