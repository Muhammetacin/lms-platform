import { verifyBackupAndRestore } from "../support/backup-restore.ts";
import { expect, test } from "../support/fixtures.ts";
import { addLesson, addModule, apiRequest, createCourse, login, saveLessonText } from "../support/flows.ts";

test("production sessions and course activity survive a PostgreSQL restore", async ({ page, context, e2e }) => {
  test.setTimeout(90_000);

  const title = `Release smoke ${crypto.randomUUID()}`;
  await login(page, e2e.users.adminA);
  expect(await context.cookies()).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "__Host-lms_session", secure: true, httpOnly: true, path: "/", sameSite: "Lax" }),
  ]));

  const { courseId } = await createCourse(page, title);
  const courseApi = `/api/organizations/courses/${courseId}`;
  const moduleTitle = "Release smoke module";
  const lessonTitle = "Release smoke lesson";
  await addModule(page, moduleTitle);
  await addLesson(page, moduleTitle, lessonTitle);
  await saveLessonText(page, lessonTitle, "Content for the database restore rehearsal.");
  expect((await apiRequest(page, `${courseApi}/publish`, "POST", {})).status).toBe(200);

  const { employees } = (await apiRequest(page, "/api/organizations/employees", "GET")).body as {
    employees: Array<{ id: string; email: string }>;
  };
  const employee = employees.find(({ email }) => email === e2e.users.memberA.email);
  expect(employee).toBeDefined();
  expect((await apiRequest(page, `${courseApi}/assignments`, "PUT", {
    type: "member", targetId: employee!.id,
  })).status).toBe(200);

  expect((await apiRequest(page, "/api/auth/logout", "POST", {})).status).toBe(200);
  expect((await context.cookies()).some((cookie) => cookie.name === "__Host-lms_session")).toBe(false);
  await login(page, e2e.users.ownerB);
  expect((await page.goto(`/admin/reports/${courseId}`))?.status()).toBe(404);

  expect((await apiRequest(page, "/api/auth/logout", "POST", {})).status).toBe(200);
  await login(page, e2e.users.memberA);
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Markeer als afgerond" }).click();
  await expect(page.getByText("1 van 1 les afgerond")).toBeVisible();
  expect((await apiRequest(page, "/api/organizations/courses", "GET")).status).toBe(403);

  await test.step("Restore the populated backup to an empty database and compare rows", verifyBackupAndRestore);
});
