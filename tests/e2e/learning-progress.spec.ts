import { expect, test } from "./support/fixtures.ts";
import { addLesson, addModule, apiRequest, assertNoHorizontalOverflow, createCourse, login, saveLessonText } from "./support/flows.ts";

test("learner completion and quiz attempts update the administrator's progress view", async ({ page, browser, baseURL, e2e }) => {
  const title = `LMS-109 course ${crypto.randomUUID().slice(0, 8)}`;
  await login(page, e2e.users.adminA);
  const { courseId } = await createCourse(page, title);
  const adminPath = `/admin/courses/${courseId}`;
  const courseApi = `/api/organizations/courses/${courseId}`;
  const learnerPath = `/learn/courses/${courseId}`;
  await addModule(page, "Progress module");
  const textId = await addLesson(page, "Progress module", "Read this first");
  await saveLessonText(page, "Read this first", "Complete this lesson after reading it.");
  const quizId = await addLesson(page, "Progress module", "Progress quiz", "QUIZ");
  expect((await apiRequest(page, `${courseApi}/quizzes/${quizId}`, "PUT", {
    questions: [{ prompt: "Choose yes", options: ["Yes", "No"], correctIndex: 0 }],
  })).status).toBe(200);
  expect((await apiRequest(page, `${courseApi}/publish`, "POST", {})).status).toBe(200);
  await page.goto(adminPath);
  await page.getByRole("link", { name: "Leervoortgang" }).click();
  await expect(page.getByText("Er zijn geen actieve medewerkers met toegang tot deze cursus.")).toBeVisible();

  const { employees } = (await apiRequest(page, "/api/organizations/employees", "GET")).body as {
    employees: Array<{ id: string; email: string }>;
  };
  const member = employees.find(({ email }) => email === e2e.users.memberA.email)!;
  const target = { type: "member", targetId: member.id };
  const completionPath = `/api${learnerPath}/lessons/${textId}/completion`;
  const quizCompletionPath = `/api${learnerPath}/lessons/${quizId}/completion`;
  const learnerContext = await browser.newContext({ baseURL });
  try {
    const learner = await learnerContext.newPage();
    await login(learner, e2e.users.memberA);
    expect((await apiRequest(learner, completionPath, "PUT", {})).status).toBe(404);
    expect((await apiRequest(page, completionPath, "PUT", {})).status).toBe(403);

    expect((await apiRequest(page, `${courseApi}/assignments`, "PUT", target)).status).toBe(200);
    await page.reload();
    const memberRow = page.getByRole("row").filter({ hasText: member.email });
    await expect(memberRow).toContainText("Nog niet gestart");
    await page.setViewportSize({ width: 375, height: 812 });
    await assertNoHorizontalOverflow(page);

    await learner.goto("/learn");
    await expect(learner.getByText("0 van 2 lessen afgerond")).toBeVisible();
    await learner.getByRole("link", { name: title }).click();
    expect((await apiRequest(learner, completionPath, "PUT", { membershipId: member.id })).status).toBe(400);
    expect((await apiRequest(learner, quizCompletionPath, "PUT", {})).status).toBe(404);
    await learner.getByRole("button", { name: "Markeer als afgerond" }).click();
    await expect(learner.getByText("1 van 2 lessen afgerond")).toBeVisible();
    await expect(learner.getByRole("status").filter({ hasText: "Les afgerond" })).toBeVisible();
    expect((await apiRequest(learner, completionPath, "PUT", {})).status).toBe(200);
    await page.reload();
    await expect(memberRow).toContainText("1 van 2 lessen afgerond");
    await expect(memberRow).toContainText("Bezig");

    await learner.getByRole("link", { name: "Quiz maken" }).click();
    await learner.getByRole("radio", { name: "No", exact: true }).check();
    await learner.getByRole("button", { name: "Quiz indienen" }).click();
    await expect(learner.getByRole("status").filter({ hasText: "0 van 1 punten" })).toBeVisible();
    await learner.getByRole("link", { name: "Terug naar cursus" }).click();
    await expect(learner.getByText("2 van 2 lessen afgerond")).toBeVisible();
    await learner.reload();
    await expect(learner.getByText("Les afgerond", { exact: true })).toHaveCount(2);
    await learner.getByRole("link", { name: "← Mijn cursussen", exact: true }).click();
    await expect(learner.getByText("2 van 2 lessen afgerond")).toBeVisible();
    await page.reload();
    await expect(memberRow).toContainText("2 van 2 lessen afgerond");
    await expect(memberRow.getByRole("cell", { name: "Afgerond", exact: true })).toBeVisible();

    await learner.goto(`${adminPath}/progress`);
    await expect(learner.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
    expect((await apiRequest(page, `${courseApi}/assignments`, "DELETE", target)).status).toBe(200);
    expect((await learner.goto(learnerPath))?.status()).toBe(404);
    await page.reload();
    await expect(memberRow).toHaveCount(0);
  } finally {
    await learnerContext.close();
    await apiRequest(page, `${courseApi}/assignments`, "DELETE", target);
  }
});
