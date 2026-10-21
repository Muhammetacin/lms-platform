import { test, expect } from "./support/fixtures.ts";
import {
  addLesson,
  addModule,
  apiRequest,
  assertControlReachable,
  assertNoHorizontalOverflow,
  createCourse,
  createCourseThroughUI,
  lessonCard,
  login,
  moduleCard,
  saveLessonText,
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
  await expect(moduleCard(page, "Module Alpha").getByRole("button", { name: "Move Module Alpha up" })).toBeDisabled();
  const moduleMove = page.waitForResponse((response) => response.url().includes("/modules/") && response.url().endsWith("/move") && response.request().method() === "POST");
  await moduleCard(page, "Module Beta").getByRole("button", { name: "Move Module Beta up" }).click();
  expect((await moduleMove).ok()).toBe(true);
  await expect(page.locator(".course-module-card h3")).toHaveText(["Module Beta", "Module Alpha"]);
  await expect(moduleCard(page, "Module Beta").getByRole("button", { name: "Move Module Beta up" })).toBeDisabled();
  await expect(moduleCard(page, "Module Alpha").getByRole("button", { name: "Move Module Alpha down" })).toBeDisabled();
  await moduleCard(page, "Module Beta").getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Module title").fill("Module Beta edited");
  await page.getByLabel("Description (optional)").fill("Edited module description.");
  await page.getByRole("button", { name: "Save module" }).click();
  await expect(page.getByRole("heading", { name: "Module Beta edited" })).toBeVisible();
  await expect(page.getByText("Edited module description.")).toBeVisible();
  await moduleCard(page, "Module Alpha").getByRole("button", { name: "Delete module" }).click();
  await expect(moduleCard(page, "Module Alpha").getByRole("heading", { name: "Delete module?" })).toBeVisible();
  await moduleCard(page, "Module Alpha").getByRole("button", { name: "Cancel" }).click();
  await expect(moduleCard(page, "Module Alpha")).toBeVisible();
  await moduleCard(page, "Module Alpha").getByRole("button", { name: "Delete module" }).click();
  await moduleCard(page, "Module Alpha").getByRole("button", { name: "Delete module", exact: true }).last().click();
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
  await video.getByLabel("Resource URL").fill("https://media.example.test/intro.mp4");
  const videoSave = page.waitForResponse((response) => response.url().includes("/content") && response.request().method() === "PUT");
  await video.getByRole("button", { name: "Save content" }).click();
  expect((await videoSave).ok()).toBe(true);
  await page.reload();
  await expect(lessonCard(page, "Video lesson").getByLabel("Resource URL")).toHaveValue("https://media.example.test/intro.mp4");
  const videoAfterReload = lessonCard(page, "Video lesson");
  const lessonMoveUp = page.waitForResponse((response) => response.url().endsWith("/move") && response.request().method() === "POST");
  await videoAfterReload.getByRole("button", { name: "Move Video lesson up" }).click();
  expect((await lessonMoveUp).ok()).toBe(true);
  await expect(page.locator(".lesson-editor-card h4")).toHaveText(["Video lesson", "Text lesson renamed"]);
  const lessonMoveDown = page.waitForResponse((response) => response.url().endsWith("/move") && response.request().method() === "POST");
  await lessonCard(page, "Video lesson").getByRole("button", { name: "Move Video lesson down" }).click();
  expect((await lessonMoveDown).ok()).toBe(true);
  await expect(page.locator(".lesson-editor-card h4")).toHaveText(["Text lesson renamed", "Video lesson"]);
  await addLesson(page, "Lesson module", "Temporary lesson", "TEXT");
  const temporary = lessonCard(page, "Temporary lesson");
  await temporary.getByRole("button", { name: "Delete lesson" }).click();
  await temporary.getByRole("button", { name: "Cancel" }).click();
  await expect(temporary).toBeVisible();
  await temporary.getByRole("button", { name: "Delete lesson" }).click();
  await temporary.getByRole("button", { name: "Delete lesson", exact: true }).last().click();
  await expect(temporary).toHaveCount(0);
  await page.reload();
  await expect(lessonCard(page, "Text lesson renamed").getByLabel("Lesson content")).toHaveValue("First line\nSecond line");
  await expect(lessonCard(page, "Video lesson").getByLabel("Resource URL")).toHaveValue("https://media.example.test/intro.mp4");
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
  await page.getByLabel("Type", { exact: true }).selectOption("VIDEO");
  await page.getByRole("button", { name: "Save lesson" }).click();
  await expect(page.getByRole("heading", { name: "Change lesson type?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(typeLesson.getByLabel("Lesson content")).toHaveValue("Keep this text until acceptance.");
  await expect(typeLesson.getByLabel("Type", { exact: true })).toHaveValue("TEXT");
  expect(patches).toHaveLength(0);

  await page.getByLabel("Type", { exact: true }).selectOption("VIDEO");
  await page.getByRole("button", { name: "Save lesson" }).click();
  const response = page.waitForResponse((candidate) => candidate.url().includes(mutationPath) && candidate.request().method() === "PATCH");
  await page.getByRole("button", { name: "Change type" }).click();
  expect((await response).ok()).toBe(true);
  await expect(page.getByLabel("Resource URL")).toBeVisible();
  expect(patches).toHaveLength(1);
  await page.reload();
  await expect(lessonCard(page, "Type lesson").getByLabel("Resource URL")).toHaveValue("");
  await expect(lessonCard(page, "Type lesson").getByLabel("Lesson content")).toHaveCount(0);
});

test("006 preview preserves order and plain text while keeping resources as safe external links", async ({ page, e2e }, testInfo) => {
  await createCourseThroughUI(page, e2e.users.ownerA, testInfo);
  await addModule(page, "Preview module one");
  await addModule(page, "Preview module two");
  await addLesson(page, "Preview module one", "Plain text lesson", "TEXT");
  const unsafeText = `Line one\n<script>window.__lms087Xss = true</script>\n${"<img src=x onerror=alert(1)>"}`;
  await saveLessonText(page, "Plain text lesson", unsafeText);
  await addLesson(page, "Preview module two", "External video", "VIDEO");
  const resource = lessonCard(page, "External video");
  await resource.getByLabel("Resource URL").fill("https://media.example.test/course.mp4");
  await resource.getByRole("button", { name: "Save content" }).click();
  await resource.getByRole("status").filter({ hasText: "Content saved." }).waitFor();
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
  await expect(moduleCard(page, "Ready module").getByRole("button", { name: "Move Ready module up" })).toHaveCount(0);
  await expect(moduleCard(page, "Ready module").getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  await expect(lessonCard(page, "Ready text").getByRole("button", { name: "Edit lesson" })).toHaveCount(0);
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
  await expect(page.getByLabel("Lesson content")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish course" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Preview course" }).last()).toBeVisible();
  await assertControlReachable(page, page.getByRole("button", { name: "+ Add module" }));
  await assertControlReachable(page, lessonCard(page, "Mobile lesson").getByLabel("Lesson content"));
  await assertControlReachable(page, page.getByRole("button", { name: "Publish course" }));
  await assertControlReachable(page, page.getByRole("link", { name: "Preview course" }).last());
  expect(course.courseId).toMatch(/^[0-9a-f-]+$/i);
});
