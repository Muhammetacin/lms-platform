import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "../support/fixtures.ts";
import { addLesson, addModule, apiRequest, createCourse, login, saveLessonText } from "../support/flows.ts";

test("a newly invited employee activates once and completes a course visible in reporting", async ({ page, browser, baseURL, e2e }) => {
  const invitationId = crypto.randomUUID().replaceAll("-", "");
  const email = `lms116-${invitationId}@example.test`;
  const name = `Invited employee ${invitationId.slice(0, 8)}`;
  const password = `Ci-only-${crypto.randomUUID()}`;

  await login(page, e2e.users.adminA);
  const created = await apiRequest(page, "/api/organizations/employees", "POST", { name, email });
  expect(created.status).toBe(201);
  const employeeId = (created.body as { employee: { id: string } }).employee.id;
  await page.goto(`/admin/employees/${employeeId}`);
  await page.getByRole("button", { name: "Send activation invitation" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation email accepted" })).toBeVisible();

  const directory = process.env.E2E_MAIL_DIRECTORY;
  if (!directory) throw new Error("CI fixture mailbox is unavailable.");
  const message = JSON.parse(await readFile(join(directory, `${invitationId}.json`), "utf8")) as {
    to: string;
    htmlContent: string;
    textContent: string;
  };
  expect(message.to).toBe(email);
  const link = message.textContent.split("\n").find((line) => line.startsWith("https://"));
  if (!link) throw new Error("The captured invitation did not contain an activation link.");
  const activationUrl = new URL(link);
  expect(activationUrl.origin).toBe(baseURL);
  expect(activationUrl.pathname).toBe("/auth/activate");
  expect(activationUrl.search).toBe("");
  expect(new URLSearchParams(activationUrl.hash.slice(1)).get("token")).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(message.htmlContent.includes(`href="${link}"`)).toBe(true);

  const learnerContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: true });
  try {
    const learner = await learnerContext.newPage();
    await learner.goto(link);
    await learner.getByLabel("Password", { exact: true }).fill(password);
    await learner.getByLabel("Confirm password", { exact: true }).fill(password);
    await learner.getByRole("button", { name: "Activate account" }).click();
    await expect(learner.getByRole("status").filter({ hasText: "Your account is active" })).toBeVisible();

    const secondUse = await learnerContext.newPage();
    await secondUse.goto(link);
    await expect(secondUse.getByRole("alert").filter({ hasText: "This activation link has already been used." })).toBeVisible();
    await secondUse.close();

    const title = `Invitation flow ${invitationId.slice(0, 8)}`;
    const { courseId } = await createCourse(page, title);
    const courseApi = `/api/organizations/courses/${courseId}`;
    const moduleTitle = "Getting started";
    const lessonTitle = "Introduction";
    const quizTitle = "Knowledge check";
    await addModule(page, moduleTitle);
    await addLesson(page, moduleTitle, lessonTitle);
    await saveLessonText(page, lessonTitle, "Read this lesson before taking the quiz.");
    const quizId = await addLesson(page, moduleTitle, quizTitle, "QUIZ");
    expect((await apiRequest(page, `${courseApi}/quizzes/${quizId}`, "PUT", {
      questions: [{ prompt: "What should you do after reading?", options: ["Take the quiz", "Close the course"], correctIndex: 0 }],
    })).status).toBe(200);
    expect((await apiRequest(page, `${courseApi}/publish`, "POST", {})).status).toBe(200);
    expect((await apiRequest(page, `${courseApi}/assignments`, "PUT", {
      type: "member", targetId: employeeId,
    })).status).toBe(200);

    await login(learner, { email, password, role: "MEMBER" });
    await learner.getByRole("link", { name: title }).click();
    await learner.getByRole("button", { name: "Markeer als afgerond" }).click();
    await expect(learner.getByText("1 van 2 lessen afgerond")).toBeVisible();
    await learner.getByRole("link", { name: "Quiz maken" }).click();
    await learner.getByRole("radio", { name: "Take the quiz" }).check();
    await learner.getByRole("button", { name: "Quiz indienen" }).click();
    await expect(learner.getByRole("status").filter({ hasText: /1 van 1/ })).toBeVisible();

    await page.goto(`/admin/reports/${courseId}`);
    const row = page.getByRole("row").filter({ hasText: email });
    await expect(row.getByRole("cell", { name: "Afgerond", exact: true })).toBeVisible();
    await expect(row.getByText("2 van 2 lessen afgerond")).toBeVisible();
    await expect(row.getByText("Knowledge check · 1 van 1")).toBeVisible();
  } finally {
    await learnerContext.close();
  }
});
