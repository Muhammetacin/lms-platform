import { test, expect } from "./support/fixtures.ts";
import {
  addLesson,
  addModule,
  apiRequest,
  assertControlReachable,
  assertNoHorizontalOverflow,
  createCourse,
  createCourseThroughUI,
  lessonAction,
  lessonCard,
  lessonContentInput,
  lessonResourceInput,
  login,
  moduleAction,
  moduleCard,
  saveLessonText,
  selectLessonType,
} from "./support/flows.ts";

test("001 authentication, protected pages, and credential handling", async ({ page, e2e }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign in to your workspace" })).toBeVisible();
  await page.getByLabel("Email").fill(e2e.users.ownerA.email);
  await page.getByLabel("Password").fill("incorrect-e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Email or password is incorrect.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page).not.toHaveURL(new RegExp(e2e.users.ownerA.password));

  await page.goto("/admin/courses");
  await expect(page).toHaveURL(/\/login$/);
  await login(page, e2e.users.ownerA);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("banner").getByText(e2e.organizationA.name)).toBeVisible();
  const clientState = await page.evaluate(() => [...Object.values(localStorage), ...Object.values(sessionStorage)].join("\n"));
  expect(clientState).not.toContain(e2e.users.ownerA.password);
  expect(page.url()).not.toContain(e2e.users.ownerA.password);
  const cookies = await page.context().cookies();
  expect(cookies.some((cookie) => /session/i.test(cookie.name))).toBe(true);
});

test("002 create, update, persist, list, and count a course", async ({ page, e2e }, testInfo) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin");
  const courseCount = page.getByRole("region", { name: "Organization course summary" })
    .getByRole("article").filter({ has: page.getByRole("heading", { name: "Courses", exact: true }) })
    .getByRole("paragraph");
  await expect(courseCount).toHaveText(/^\d+$/);
  const countBeforeCreate = Number(await courseCount.textContent());

  const course = await createCourse(page, `LMS-087 ${testInfo.title} ${crypto.randomUUID().slice(0, 8)}`);
  await expect(page.getByRole("heading", { name: course.title, exact: true })).toBeVisible();
  await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Title").fill(`${course.title} updated`);
  await page.getByRole("textbox", { name: "Description" }).fill("Description survives a refresh.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved.");
  await page.reload();
  await expect(page.getByRole("heading", { name: `${course.title} updated`, exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Description" }).getByText("Description survives a refresh.")).toBeVisible();
  await page.goto("/admin/courses");
  await expect(page.getByRole("heading", { name: `${course.title} updated`, exact: true })).toBeVisible();
  await page.goto("/admin");
  await expect(courseCount).toHaveText(String(countBeforeCreate + 1));
});

test("003 module create, edit, reorder, boundary controls, and delete confirmation", async ({ page, e2e }, testInfo) => {
  await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  await addModule(page, "Module Alpha");
  await addModule(page, "Module Beta");
  const alpha = moduleCard(page, "Module Alpha");
  await alpha.getByRole("button", { name: "More actions for Module Alpha" }).click();
  await expect(alpha.getByRole("button", { name: "Move Module Alpha up" })).toBeDisabled();
  await alpha.getByRole("button", { name: "More actions for Module Alpha" }).click();
  const moduleMove = page.waitForResponse((response) => response.url().includes("/modules/") && response.url().endsWith("/move") && response.request().method() === "POST");
  await moduleAction(page, "Module Beta", "Move up");
  expect((await moduleMove).ok()).toBe(true);
  await expect(page.locator(".course-module-card h3")).toHaveText(["Module Beta", "Module Alpha"]);
  const beta = moduleCard(page, "Module Beta");
  await beta.getByRole("button", { name: "More actions for Module Beta" }).click();
  await expect(beta.getByRole("button", { name: "Move Module Beta up" })).toBeDisabled();
  await beta.getByRole("button", { name: "More actions for Module Beta" }).click();
  await alpha.getByRole("button", { name: "More actions for Module Alpha" }).click();
  await expect(alpha.getByRole("button", { name: "Move Module Alpha down" })).toBeDisabled();
  await alpha.getByRole("button", { name: "More actions for Module Alpha" }).click();
  await moduleAction(page, "Module Beta", "Edit module");
  await page.getByLabel("Module title").fill("Module Beta edited");
  await page.getByLabel("Description (optional)").fill("Edited module description.");
  await page.getByRole("button", { name: "Save module" }).click();
  await expect(page.getByRole("heading", { name: "Module Beta edited" })).toBeVisible();
  await expect(page.getByText("Edited module description.")).toBeVisible();
  await moduleAction(page, "Module Alpha", "Delete module");
  const deleteModuleDialog = page.getByRole("dialog", { name: "Delete module?" });
  await expect(deleteModuleDialog).toBeVisible();
  await deleteModuleDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(moduleCard(page, "Module Alpha")).toBeVisible();
  await moduleAction(page, "Module Alpha", "Delete module");
  await page.getByRole("dialog", { name: "Delete module?" }).getByRole("button", { name: "Delete module" }).click();
  await expect(moduleCard(page, "Module Alpha")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Module Beta edited" })).toBeVisible();
});

test("004 lesson types, content persistence, ordering, and delete confirmation", async ({ page, e2e }, testInfo) => {
  await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  await addModule(page, "Lesson module");
  await addLesson(page, "Lesson module", "Text lesson", "TEXT");
  await addLesson(page, "Lesson module", "Video lesson", "VIDEO");
  await saveLessonText(page, "Text lesson", "First line\nSecond line");
  await lessonCard(page, "Text lesson").getByRole("button", { name: "Edit lesson" }).click();
  await page.getByLabel("Lesson title").fill("Text lesson renamed");
  await page.getByRole("button", { name: "Save lesson" }).click();
  await expect(lessonCard(page, "Text lesson renamed")).toBeVisible();
  const video = lessonCard(page, "Video lesson");
  await video.getByRole("button", { name: "Edit content" }).click();
  await lessonResourceInput(page).fill("https://media.example.test/intro.mp4");
  const videoSave = page.waitForResponse((response) => response.url().includes("/content") && response.request().method() === "PUT");
  await video.getByRole("button", { name: "Save content" }).click();
  expect((await videoSave).ok()).toBe(true);
  await page.reload();
  const videoAfterReload = lessonCard(page, "Video lesson");
  await videoAfterReload.getByRole("button", { name: "Edit content" }).click();
  await expect(lessonResourceInput(page)).toHaveValue("https://media.example.test/intro.mp4");
  await page.getByRole("button", { name: "Cancel" }).click();
  const lessonMoveUp = page.waitForResponse((response) => response.url().endsWith("/move") && response.request().method() === "POST");
  await lessonAction(page, "Video lesson", "Move up");
  expect((await lessonMoveUp).ok()).toBe(true);
  await expect(page.locator(".lesson-editor-card h4")).toHaveText(["Video lesson", "Text lesson renamed"]);
  const lessonMoveDown = page.waitForResponse((response) => response.url().endsWith("/move") && response.request().method() === "POST");
  await lessonAction(page, "Video lesson", "Move down");
  expect((await lessonMoveDown).ok()).toBe(true);
  await expect(page.locator(".lesson-editor-card h4")).toHaveText(["Text lesson renamed", "Video lesson"]);
  await addLesson(page, "Lesson module", "Temporary lesson", "TEXT");
  const temporary = lessonCard(page, "Temporary lesson");
  await lessonAction(page, "Temporary lesson", "Delete lesson");
  await page.getByRole("dialog", { name: "Delete lesson?" }).getByRole("button", { name: "Cancel" }).click();
  await expect(temporary).toBeVisible();
  await lessonAction(page, "Temporary lesson", "Delete lesson");
  await page.getByRole("dialog", { name: "Delete lesson?" }).getByRole("button", { name: "Delete lesson" }).click();
  await expect(temporary).toHaveCount(0);
  await page.reload();
  const textAfterReload = lessonCard(page, "Text lesson renamed");
  await textAfterReload.getByRole("button", { name: "Edit content" }).click();
  await expect(lessonContentInput(page)).toHaveValue("First line\nSecond line");
  await page.getByRole("button", { name: "Cancel" }).click();
  await videoAfterReload.getByRole("button", { name: "Edit content" }).click();
  await expect(lessonResourceInput(page)).toHaveValue("https://media.example.test/intro.mp4");
});

test("005 lesson type confirmation cancels safely and accepts exactly one metadata mutation", async ({ page, e2e }, testInfo) => {
  const { courseId } = await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  const moduleId = await addModule(page, "Type module");
  const lessonId = await addLesson(page, "Type module", "Type lesson", "TEXT");
  await saveLessonText(page, "Type lesson", "Keep this text until acceptance.");
  const typeLesson = lessonCard(page, "Type lesson");
  const mutationPath = `/api/organizations/courses/${courseId}/modules/${moduleId}/lessons/${lessonId}`;
  const patches: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes(mutationPath)) patches.push(request.postData() ?? "");
  });
  await typeLesson.getByRole("button", { name: "Edit lesson" }).click();
  await selectLessonType(typeLesson, "VIDEO");
  await page.getByRole("button", { name: "Save lesson" }).click();
  await expect(page.getByRole("heading", { name: "Change lesson type?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(typeLesson.getByRole("combobox", { name: "Type", exact: true })).toHaveText("Text");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await typeLesson.getByRole("button", { name: "Edit content" }).click();
  await expect(lessonContentInput(page)).toHaveValue("Keep this text until acceptance.");
  await page.getByRole("button", { name: "Cancel" }).click();
  expect(patches).toHaveLength(0);

  await typeLesson.getByRole("button", { name: "Edit lesson" }).click();
  await selectLessonType(typeLesson, "VIDEO");
  await page.getByRole("button", { name: "Save lesson" }).click();
  const response = page.waitForResponse((candidate) => candidate.url().includes(mutationPath) && candidate.request().method() === "PATCH");
  await page.getByRole("button", { name: "Change type" }).click();
  expect((await response).ok()).toBe(true);
  await lessonCard(page, "Type lesson").getByRole("button", { name: "Edit content" }).click();
  await expect(page.getByRole("dialog", { name: "Edit Video resource" })).toBeVisible();
  await expect(lessonResourceInput(page)).toBeVisible();
  expect(patches).toHaveLength(1);
  await page.reload();
  await lessonCard(page, "Type lesson").getByRole("button", { name: "Edit content" }).click();
  await expect(lessonResourceInput(page)).toHaveValue("");
  await expect(lessonContentInput(page)).toHaveCount(0);
});

test("Lesson Type selector exposes all values and supports keyboard, pointer, and responsive use", async ({ page, e2e }, testInfo) => {
  await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  await addModule(page, "Selector module");
  const courseModule = moduleCard(page, "Selector module");
  await courseModule.getByRole("button", { name: "+ Add lesson" }).click();

  const title = courseModule.getByLabel("Lesson title");
  const trigger = courseModule.getByRole("combobox", { name: "Type", exact: true });
  await page.mouse.move(0, 0);
  await expect(trigger).toHaveText("Text");
  await title.focus();
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  expect(await trigger.evaluate((element) => element.matches(":focus-visible"))).toBe(true);

  await trigger.press("Enter");
  const listbox = page.getByRole("listbox", { name: "Type", exact: true });
  const options = page.getByRole("option");
  await expect(listbox).toBeVisible();
  await expect(options).toHaveCount(6);
  for (const label of ["Text", "Video", "PDF", "Image", "Link", "Quiz"]) {
    await expect(page.getByRole("option", { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("option", { name: "Text", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveText("Text");
  await expect(trigger).toBeFocused();

  await trigger.press("ArrowDown");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveText("Text");
  await expect(trigger).toBeFocused();

  await trigger.press("Space");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toHaveText("Text");

  await page.keyboard.press("Tab");
  await expect(listbox).toHaveCount(0);
  await expect(courseModule.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await trigger.focus();

  await trigger.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  const videoOption = page.getByRole("option", { name: "Video", exact: true });
  await expect(trigger).toBeFocused();
  expect(await trigger.getAttribute("aria-activedescendant")).toBe(await videoOption.getAttribute("id"));
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveText("Text");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await trigger.click();
    const bounds = await page.getByRole("listbox", { name: "Type", exact: true }).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(812);
    await page.keyboard.press("Escape");
  }

  await trigger.click();
  await title.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await page.getByRole("option", { name: "Video", exact: true }).click();
  await expect(trigger).toHaveText("Video");
  await expect(trigger).toBeFocused();
  await title.fill("Mouse-selected lesson");
  const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && /\/lessons$/.test(response.url()));
  await courseModule.getByRole("button", { name: "Add lesson", exact: true }).click();
  const created = await (await createResponse).json() as { lesson?: { type?: string } };
  expect(created.lesson?.type).toBe("VIDEO");

  const lesson = lessonCard(page, "Mouse-selected lesson");
  await lesson.getByRole("button", { name: "Edit lesson" }).click();
  await selectLessonType(lesson, "PDF");
  await expect(lesson.getByRole("combobox", { name: "Type", exact: true })).toHaveText("PDF");
  const updateResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/lessons\//.test(response.url()));
  await lesson.getByRole("button", { name: "Save lesson" }).click();
  const updated = await (await updateResponse).json() as { lesson?: { type?: string } };
  expect(updated.lesson?.type).toBe("PDF");
  await expect(lesson.getByText("Lesson 1 · PDF", { exact: true })).toBeVisible();
});

test.describe("Lesson Type touch interaction", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } });

  test("touch tap selects the requested lesson type", async ({ page, e2e }, testInfo) => {
    await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
    await addModule(page, "Touch selector module");
    const courseModule = moduleCard(page, "Touch selector module");
    await courseModule.getByRole("button", { name: "+ Add lesson" }).tap();
    await courseModule.getByLabel("Lesson title").fill("Touch-selected lesson");

    const trigger = courseModule.getByRole("combobox", { name: "Type", exact: true });
    await trigger.tap();
    await page.getByRole("option", { name: "Image", exact: true }).tap();
    await expect(trigger).toHaveText("Image");
    await expect(trigger).toBeFocused();

    const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && /\/lessons$/.test(response.url()));
    await courseModule.getByRole("button", { name: "Add lesson", exact: true }).tap();
    const created = await (await createResponse).json() as { lesson?: { type?: string } };
    expect(created.lesson?.type).toBe("IMAGE");
  });
});

test("006 preview preserves order and plain text while keeping resources as safe external links", async ({ page, e2e }, testInfo) => {
  const { courseId } = await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  await addModule(page, "Preview module one");
  await addModule(page, "Preview module two");
  await addLesson(page, "Preview module one", "Plain text lesson", "TEXT");
  const unsafeText = `Line one\n<script>window.__lms087Xss = true</script>\n${"<img src=x onerror=alert(1)>"}`;
  await saveLessonText(page, "Plain text lesson", unsafeText);
  await addLesson(page, "Preview module two", "External video", "VIDEO");
  const resource = lessonCard(page, "External video");
  await resource.getByRole("button", { name: "Edit content" }).click();
  await lessonResourceInput(page).fill("https://media.example.test/course.mp4");
  const resourceSave = page.waitForResponse((response) => response.url().includes("/content") && response.request().method() === "PUT");
  await page.getByRole("button", { name: "Save content" }).click();
  expect((await resourceSave).ok()).toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Lesinhoud opgeslagen" })).toBeVisible();
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://")) externalRequests.push(request.url());
  });
  await page.getByRole("link", { name: "Preview course" }).last().click();
  await expect(page.getByText("Draft preview")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Preview module one" })).toBeVisible();
  await expect(page.locator(".preview-module h3").nth(0)).toContainText("Preview module one");
  await expect(page.locator(".preview-module h3").nth(1)).toContainText("Preview module two");
  await expect(page.getByText(unsafeText, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __lms087Xss?: boolean }).__lms087Xss)).toBeUndefined();
  await expect(page.locator(".preview-text script, .preview-text img")).toHaveCount(0);
  const external = page.getByRole("link", { name: "Open video resource" });
  await expect(external).toHaveAttribute("href", "https://media.example.test/course.mp4");
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  await expect(external).toHaveAttribute("referrerpolicy", "no-referrer");
  expect(externalRequests).toEqual([]);

  const backLink = page.getByRole("link", { name: "← Back to Course Builder" });
  await expect(backLink).toHaveAttribute("href", `/admin/courses/${courseId}`);
  const directPreview = await page.context().newPage();
  await directPreview.goto(`/courses/${courseId}/preview`);
  await expect(directPreview.getByText("Draft preview")).toBeVisible();
  await directPreview.getByRole("link", { name: "← Back to Course Builder" }).click();
  await expect(directPreview).toHaveURL(new RegExp(`/admin/courses/${courseId}$`));
  await directPreview.close();
});

test("007 publishing reports progressively incomplete module, lesson, text, and quiz states", async ({ page, e2e }, testInfo) => {
  await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  await page.getByRole("button", { name: "Publish course" }).click();
  await page.getByRole("button", { name: "Publish course", exact: true }).last().click();
  await expect(page.getByRole("list", { name: "Publishing issues" })).toContainText("Add at least one module.");
  await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();
  await addModule(page, "Incomplete module");
  await page.getByRole("button", { name: "Publish course" }).click();
  await page.getByRole("button", { name: "Publish course", exact: true }).last().click();
  await expect(page.getByRole("list", { name: "Publishing issues" })).toContainText("Add at least one lesson to “Incomplete module”.");
  await addLesson(page, "Incomplete module", "Empty text", "TEXT");
  await page.getByRole("button", { name: "Publish course" }).click();
  await page.getByRole("button", { name: "Publish course", exact: true }).last().click();
  await expect(page.getByRole("list", { name: "Publishing issues" })).toContainText("Add content to “Empty text”.");
  await saveLessonText(page, "Empty text", "Content now configured.");
  await addLesson(page, "Incomplete module", "Quiz awaiting builder", "QUIZ");
  await page.getByRole("button", { name: "Publish course" }).click();
  await page.getByRole("button", { name: "Publish course", exact: true }).last().click();
  await expect(page.getByRole("list", { name: "Publishing issues" })).toContainText(/Configure or remove quiz lesson/);
  await expect(page.getByText("DRAFT", { exact: true }).first()).toBeVisible();
});

test("008 publish confirmation locks structure while metadata and preview remain available", async ({ page, e2e }, testInfo) => {
  const { courseId } = await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  await addModule(page, "Ready module");
  await addLesson(page, "Ready module", "Ready text", "TEXT");
  await saveLessonText(page, "Ready text", "Complete course content.");
  await page.getByRole("button", { name: "Publish course" }).click();
  await expect(page.getByRole("heading", { name: "Publish course?" })).toBeVisible();
  await page.getByRole("button", { name: "Publish course", exact: true }).last().click();
  await expect(page.getByRole("status")).toContainText("Published course");
  await expect(page.getByText("PUBLISHED", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Published date").locator(".." )).not.toContainText("—");
  await expect(page.getByRole("button", { name: "+ Add module" })).toHaveCount(0);
  await expect(moduleCard(page, "Ready module").getByRole("button", { name: "More actions for Ready module" })).toHaveCount(0);
  await expect(moduleCard(page, "Ready module").getByRole("button", { name: "Edit module", exact: true })).toHaveCount(0);
  await expect(lessonCard(page, "Ready text").getByRole("button", { name: "Edit lesson" })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Type", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete course" })).toHaveCount(0);
  await page.getByLabel("Title").fill("Published metadata update");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  const moduleResult = await apiRequest(page, `/api/organizations/courses/${courseId}/modules`, "POST", { title: "Blocked after publishing", description: null });
  expect(moduleResult.status).toBe(409);
  const deleteResult = await apiRequest(page, `/api/organizations/courses/${courseId}`, "DELETE", {});
  expect(deleteResult.status).toBe(409);
  await page.getByRole("link", { name: "Preview course" }).last().click();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Published metadata update" })).toBeVisible();
  const backLink = page.getByRole("link", { name: "← Back to Course Builder" });
  await expect(backLink).toHaveAttribute("href", `/admin/courses/${courseId}`);
  const directPreview = await page.context().newPage();
  await directPreview.goto(`/courses/${courseId}/preview`);
  await expect(directPreview.getByText("Published", { exact: true })).toBeVisible();
  await directPreview.getByRole("link", { name: "← Back to Course Builder" }).click();
  await expect(directPreview).toHaveURL(new RegExp(`/admin/courses/${courseId}$`));
  await directPreview.close();
});

test("009 draft course deletion is cancelable and updates list and dashboard", async ({ page, e2e }, testInfo) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin");
  const before = Number((await page.getByRole("region", { name: "Organization course summary" }).locator("article").nth(1).locator("p").textContent()) ?? 0);
  const course = await createCourse(page, `LMS-087 deletable ${testInfo.title} ${crypto.randomUUID().slice(0, 8)}`);
  await page.getByRole("button", { name: "Delete course" }).click();
  await expect(page.getByRole("heading", { name: "Delete course?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: course.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete course" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await page.waitForURL("**/admin/courses");
  await expect(page.getByRole("heading", { name: course.title, exact: true })).toHaveCount(0);
  await page.goto("/admin");
  const after = Number((await page.getByRole("region", { name: "Organization course summary" }).locator("article").nth(1).locator("p").textContent()) ?? 0);
  expect(after).toBe(before);
});

test("010 logout invalidates access to admin and previously visited course pages", async ({ page, e2e }, testInfo) => {
  const course = await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  await page.getByRole("button", { name: /sign out|log out/i }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/admin/courses/${course.courseId}`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(e2e.organizationA.name)).toHaveCount(0);
});

test("011 role permissions and tenant isolation resist foreign IDs and organization overrides", async ({ page, e2e }, testInfo) => {
  await login(page, e2e.users.ownerA);
  const courseA = await createCourse(page, `Tenant A ${testInfo.title} ${crypto.randomUUID().slice(0, 8)}`);
  await page.getByRole("button", { name: /sign out|log out/i }).click();
  await login(page, e2e.users.ownerB);
  const courseB = await createCourse(page, `Tenant B ${testInfo.title} ${crypto.randomUUID().slice(0, 8)}`);
  await page.goto("/admin/courses");
  await expect(page.getByText(courseB.title)).toBeVisible();
  await expect(page.getByText(courseA.title)).toHaveCount(0);

  await page.getByRole("button", { name: /sign out|log out/i }).click();
  await login(page, e2e.users.ownerA);
  await page.goto("/admin/courses");
  await expect(page.getByText(courseA.title)).toBeVisible();
  await expect(page.getByText(courseB.title)).toHaveCount(0);
  const foreignPage = await page.goto(`/admin/courses/${courseB.courseId}`);
  expect(foreignPage?.status()).toBe(404);
  const foreignApi = await apiRequest(page, `/api/organizations/courses/${courseB.courseId}`, "GET");
  expect(foreignApi.status).toBe(404);
  const overridden = await apiRequest(page, `/api/organizations/courses?organizationId=${e2e.organizationB.id}`, "GET", undefined, { "x-organization-id": e2e.organizationB.id });
  expect(JSON.stringify(overridden.body)).toContain(courseA.title);
  expect(JSON.stringify(overridden.body)).not.toContain(courseB.title);

  await page.goto("/admin");
  await page.getByRole("button", { name: /sign out|log out/i }).click();
  await login(page, e2e.users.memberA);
  await page.goto("/admin/courses");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  await page.goto(`/admin/courses/${courseA.courseId}`);
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();

  expect((await apiRequest(page, "/api/auth/logout", "POST", {})).status).toBe(200);
  await login(page, e2e.users.adminA);
  await page.goto("/admin/courses");
  await expect(page.getByText(courseA.title)).toBeVisible();
  await createCourse(page, `Admin A ${testInfo.title} ${crypto.randomUUID().slice(0, 8)}`);
  await expect(page.getByRole("heading", { name: "Course content" })).toBeVisible();
});

test("012 mobile layout, keyboard navigation, labels, and error visibility", async ({ page, e2e }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  await assertNoHorizontalOverflow(page);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password").fill("wrong-password-e2e");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  await login(page, e2e.users.ownerA);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/admin/courses/new");
  await assertNoHorizontalOverflow(page);
  await assertControlReachable(page, page.getByRole("button", { name: "Create course" }));
  const course = await createCourse(page, `Mobile ${testInfo.title} ${crypto.randomUUID().slice(0, 8)}`);
  await addModule(page, "Mobile module");
  await addLesson(page, "Mobile module", "Mobile lesson", "TEXT");
  await assertNoHorizontalOverflow(page);
  await expect(page.getByRole("heading", { name: "Course content" })).toBeVisible();
  await expect(lessonCard(page, "Mobile lesson").getByText("Content not configured")).toBeVisible();
  await lessonCard(page, "Mobile lesson").getByRole("button", { name: "Edit content" }).click();
  const drawer = page.getByRole("dialog", { name: "Edit lesson content" });
  await expect(drawer).toBeVisible();
  const drawerBounds = await drawer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  });
  expect(drawerBounds.left).toBe(0);
  expect(drawerBounds.top).toBe(0);
  expect(drawerBounds.width).toBe(375);
  expect(drawerBounds.height).toBe(812);
  await expect(lessonContentInput(page)).toBeFocused();
  await drawer.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Publish course" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Preview course" }).last()).toBeVisible();
  await assertControlReachable(page, page.getByRole("button", { name: "+ Add module" }));
  await assertControlReachable(page, lessonCard(page, "Mobile lesson").getByRole("button", { name: "Edit content" }));
  await assertControlReachable(page, page.getByRole("button", { name: "Publish course" }));
  await assertControlReachable(page, page.getByRole("link", { name: "Preview course" }).last());
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await assertNoHorizontalOverflow(page);
    if (width === 375) continue;
    const mobileLesson = lessonCard(page, "Mobile lesson");
    await mobileLesson.getByRole("button", { name: "Edit content" }).click();
    const desktopDrawer = page.getByRole("dialog", { name: "Edit lesson content" });
    const bounds = await desktopDrawer.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    });
    expect(bounds.right).toBe(width);
    expect(bounds.left).toBeGreaterThan(0);
    expect(bounds.width).toBeGreaterThan(600);
    expect(bounds.height).toBe(812);
    await desktopDrawer.getByRole("button", { name: "Cancel" }).click();
  }
  expect(course.courseId).toMatch(/^[0-9a-f-]+$/i);
});

test("013 accessible dialogs protect unsaved changes and content save reports one toast", async ({ page, e2e }, testInfo) => {
  await createCourseThroughUI(page, e2e.users.ownerA, testInfo);

  const addModuleTrigger = page.getByRole("button", { name: "+ Add module" });
  await addModuleTrigger.click();
  const addModuleDialog = page.getByRole("dialog", { name: "Add module" });
  const moduleTitle = addModuleDialog.getByLabel("Module title");
  await expect(moduleTitle).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(addModuleDialog.getByRole("button", { name: "Close Add module" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(addModuleDialog.getByRole("button", { name: "Add module", exact: true })).toBeFocused();
  await moduleTitle.fill("Unsaved module");
  await page.mouse.click(2, 2);
  const discardModuleDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await discardModuleDialog.getByRole("button", { name: "Continue editing" }).click();
  await expect(moduleTitle).toHaveValue("Unsaved module");
  await moduleTitle.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(addModuleDialog).toHaveCount(0);
  await expect(addModuleTrigger).toBeFocused();

  await addModule(page, "Dialog module");
  const dialogModule = moduleCard(page, "Dialog module");
  await expect(dialogModule.getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-expanded", "true");
  await dialogModule.getByRole("button", { name: "Collapse" }).click();
  await expect(dialogModule.locator(".course-module-lessons")).toBeHidden();
  await expect(dialogModule.getByRole("button", { name: "+ Add lesson" })).toBeVisible();
  await dialogModule.getByRole("button", { name: "Expand" }).click();
  const addLessonTrigger = dialogModule.getByRole("button", { name: "+ Add lesson" });
  await addLessonTrigger.click();
  const addLessonDialog = page.getByRole("dialog", { name: "Add lesson" });
  await addLessonDialog.getByLabel("Lesson title").fill("Unsaved lesson");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(addLessonDialog).toHaveCount(0);
  await expect(addLessonTrigger).toBeFocused();

  await addLesson(page, "Dialog module", "Dialog lesson", "TEXT");
  const lesson = lessonCard(page, "Dialog lesson");
  await lesson.getByRole("button", { name: "Edit lesson" }).click();
  const editLessonDialog = page.getByRole("dialog", { name: "Edit lesson" });
  const editedTitle = editLessonDialog.getByLabel("Lesson title");
  await editedTitle.fill("Unsaved metadata");
  await editLessonDialog.getByRole("button", { name: "Close Edit lesson" }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Continue editing" }).click();
  await expect(editedTitle).toHaveValue("Unsaved metadata");
  await editLessonDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(lesson.getByRole("heading", { name: "Dialog lesson" })).toBeVisible();

  await lesson.getByRole("button", { name: "Edit lesson" }).click();
  await page.getByLabel("Lesson title").fill("Saved metadata");
  const metadataSave = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/lessons\//.test(response.url()));
  await page.getByRole("button", { name: "Save lesson" }).click();
  expect((await metadataSave).ok()).toBe(true);
  await expect(lessonCard(page, "Saved metadata")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Lesson changes saved" })).toHaveCount(1);

  const savedLesson = lessonCard(page, "Saved metadata");
  await savedLesson.getByRole("button", { name: "Edit content" }).click();
  const contentDialog = page.getByRole("dialog", { name: "Edit lesson content" });
  const content = lessonContentInput(page);
  await expect(content).toBeFocused();
  await content.fill("This content must survive a failed save.");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Continue editing" }).click();
  await expect(content).toHaveValue("This content must survive a failed save.");
  await contentDialog.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Continue editing" }).click();
  await expect(content).toHaveValue("This content must survive a failed save.");

  await page.context().setOffline(true);
  await contentDialog.getByRole("button", { name: "Save content" }).click();
  await expect(contentDialog.getByRole("alert")).toBeVisible();
  await expect(content).toHaveValue("This content must survive a failed save.");
  await expect(page.getByRole("status").filter({ hasText: "Lesinhoud opgeslagen" })).toHaveCount(0);
  await page.context().setOffline(false);

  const contentSave = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/content"));
  await contentDialog.getByRole("button", { name: "Save content" }).click();
  expect((await contentSave).ok()).toBe(true);
  await expect(contentDialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Lesinhoud opgeslagen" })).toHaveCount(1);
  await expect(savedLesson.getByRole("button", { name: "Edit content" })).toBeFocused();
  await expect(savedLesson.locator(".lesson-content-summary")).toContainText("This content must survive a failed save.");
});
