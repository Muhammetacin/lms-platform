import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { E2EUser } from "./fixtures.ts";
import { lessonTypeLabels } from "../../../src/lib/course-builder-ui-core.ts";
import type { LessonTypeValue } from "../../../src/lib/lesson-core.ts";

export async function login(page: Page, user: E2EUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/admin");
}

export async function createCourse(page: Page, title: string, description = "E2E course description") {
  await page.goto("/admin/courses/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Description").fill(description);
  await page.getByRole("button", { name: "Create course" }).click();
  await page.waitForURL(/\/admin\/courses\/[0-9a-f-]+$/i);
  const courseId = new URL(page.url()).pathname.split("/").at(-1);
  if (!courseId) throw new Error("Course creation did not navigate to the course builder.");
  return { courseId, title, description };
}

export function moduleCard(page: Page, title: string) {
  return page.locator(".course-module-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

export function lessonCard(page: Page, title: string) {
  return page.locator(".lesson-editor-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

export function lessonContentInput(page: Page) {
  return page.getByRole("textbox", { name: "Lesson content", exact: true });
}

export function lessonResourceInput(page: Page) {
  return page.getByRole("textbox", { name: "Resource URL", exact: true });
}

export async function moduleAction(page: Page, moduleTitle: string, action: string) {
  const courseModule = moduleCard(page, moduleTitle);
  await courseModule.getByRole("button", { name: `More actions for ${moduleTitle}` }).click();
  const accessibleAction = action === "Move up" || action === "Move down"
    ? `Move ${moduleTitle} ${action.slice("Move ".length)}`
    : action;
  await courseModule.getByRole("button", { name: accessibleAction, exact: true }).click();
}

export async function lessonAction(page: Page, lessonTitle: string, action: string) {
  const lesson = lessonCard(page, lessonTitle);
  await lesson.getByRole("button", { name: `More actions for ${lessonTitle}` }).click();
  const accessibleAction = action === "Move up" || action === "Move down"
    ? `Move ${lessonTitle} ${action.slice("Move ".length)}`
    : action;
  await lesson.getByRole("button", { name: accessibleAction, exact: true }).click();
}

export async function selectLessonType(scope: Locator, type: LessonTypeValue) {
  await scope.getByRole("combobox", { name: "Type", exact: true }).click();
  await scope.page().getByRole("option", { name: lessonTypeLabels[type], exact: true }).click();
}

export async function addModule(page: Page, title: string) {
  await page.getByRole("button", { name: "+ Add module" }).click();
  await page.getByLabel("Module title").fill(title);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/organizations\/courses\/[^/]+\/modules$/.test(response.url()));
  await page.getByRole("button", { name: "Add module", exact: true }).click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  const body = await (await responsePromise).json() as { module?: { id?: string } };
  if (!body.module?.id) throw new Error("Module creation did not return its ID.");
  return body.module.id;
}

export async function addLesson(page: Page, moduleTitle: string, title: string, type: LessonTypeValue = "TEXT") {
  const courseModule = moduleCard(page, moduleTitle);
  await courseModule.getByRole("button", { name: "+ Add lesson" }).click();
  await page.getByLabel("Lesson title").fill(title);
  await selectLessonType(courseModule, type);
  const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/organizations\/courses\/[^/]+\/modules\/[^/]+\/lessons$/.test(response.url()));
  await page.getByRole("button", { name: "Add lesson", exact: true }).click();
  await lessonCard(page, title).waitFor();
  const body = await (await responsePromise).json() as { lesson?: { id?: string } };
  if (!body.lesson?.id) throw new Error("Lesson creation did not return its ID.");
  return body.lesson.id;
}

export async function saveLessonText(page: Page, title: string, text: string) {
  const lesson = lessonCard(page, title);
  await lesson.getByRole("button", { name: "Edit content" }).click();
  await lessonContentInput(page).fill(text);
  const responsePromise = page.waitForResponse((response) => response.url().includes("/content") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Save content" }).click();
  if (!(await responsePromise).ok()) throw new Error("Saving lesson text did not succeed.");
  await expect(page.getByRole("status").filter({ hasText: "Lesinhoud opgeslagen" })).toBeVisible();
  await expect(lesson.getByRole("button", { name: "Edit content" })).toBeVisible();
  await expect(lesson.locator(".lesson-content-summary")).toContainText(text.slice(0, 220));
}

export async function createCourseThroughUI(page: Page, user: E2EUser, testInfo: TestInfo) {
  await login(page, user);
  return createCourse(page, `LMS-087 ${testInfo.title} ${crypto.randomUUID().slice(0, 8)}`);
}

export async function apiRequest(page: Page, path: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return page.evaluate(async ({ path, method, body, headers }) => {
    const response = await fetch(path, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: "same-origin",
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { path, method, body, headers });
}

export async function assertNoHorizontalOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  if (sizes.document > sizes.viewport || sizes.body > sizes.viewport) {
    throw new Error(`Horizontal overflow: viewport=${sizes.viewport}, document=${sizes.document}, body=${sizes.body}`);
  }
}

export async function assertControlReachable(page: Page, control: Locator) {
  const geometry = await control.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
}
