import { expect, test } from "./support/fixtures.ts";
import { addLesson, addModule, apiRequest, assertNoHorizontalOverflow, createCourse, login } from "./support/flows.ts";

test("an administrator publishes a quiz and an assigned learner can score and retry", async ({ page, browser, baseURL, e2e }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const title = `LMS-104 course ${suffix}`;
  const quizTitle = `Quiz ${suffix}`;
  await login(page, e2e.users.adminA);
  const { courseId } = await createCourse(page, title);
  const courseApi = `/api/organizations/courses/${courseId}`;
  await addModule(page, "Quiz module");
  await addLesson(page, "Quiz module", quizTitle, "QUIZ");
  expect((await apiRequest(page, `${courseApi}/publish`, "POST", {})).status).toBe(409);
  await page.getByRole("link", { name: "Quiz bewerken" }).click();
  await expect(page.getByRole("heading", { name: quizTitle, level: 1 })).toBeVisible();
  const authorPath = new URL(page.url()).pathname;
  const lessonId = authorPath.split("/").at(-1)!;
  const save = page.getByRole("button", { name: "Quiz opslaan" });
  await save.click();
  await expect(page.getByRole("alert").filter({ hasText: "Vul elke vraag" })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await assertNoHorizontalOverflow(page);

  const first = page.getByRole("group", { name: "Vraag 1" });
  await first.getByLabel("Vraagtekst").fill("Wat is twee plus twee?");
  await first.getByLabel("Optie 1").fill("Drie");
  await first.getByLabel("Optie 2").fill("Vier");
  await first.getByRole("radio", { name: "Juist antwoord 2" }).check();
  await page.getByRole("button", { name: "Vraag toevoegen" }).click();
  const second = page.getByRole("group", { name: "Vraag 2" });
  await second.getByLabel("Vraagtekst").fill("Kies het bevestigende antwoord.");
  await second.getByLabel("Optie 1").fill("Ja");
  await second.getByLabel("Optie 2").fill("Nee");
  await second.getByRole("radio", { name: "Juist antwoord 1" }).check();
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Quiz opgeslagen." })).toBeVisible();
  await page.reload();
  await expect(first.getByLabel("Vraagtekst")).toHaveValue("Wat is twee plus twee?");
  expect((await apiRequest(page, `${courseApi}/publish`, "POST", {})).status).toBe(200);
  await page.reload();
  await expect(page.getByText(/Gepubliceerde quiz/)).toBeVisible();
  await expect(save).toHaveCount(0);
  expect((await apiRequest(page, `${courseApi}/quizzes/${lessonId}`, "PUT", {
    questions: [{ prompt: "Replacement", options: ["One", "Two"], correctIndex: 0 }],
  })).status).toBe(409);

  const employees = (await apiRequest(page, "/api/organizations/employees", "GET")).body as {
    employees: Array<{ id: string; email: string }>;
  };
  const member = employees.employees.find(({ email }) => email === e2e.users.memberA.email);
  expect(member).toBeDefined();
  const target = { type: "member", targetId: member!.id };
  const quizPath = `/learn/courses/${courseId}/quizzes/${lessonId}`;
  const attemptPath = `/api${quizPath}/attempts`;
  const learnerContext = await browser.newContext({ baseURL });
  try {
    const learnerPage = await learnerContext.newPage();
    await login(learnerPage, e2e.users.memberA);
    expect((await learnerPage.goto(quizPath))?.status()).toBe(404);
    expect((await apiRequest(page, `${courseApi}/assignments`, "PUT", target)).status).toBe(200);
    await learnerPage.goto("/learn");
    await learnerPage.getByRole("link", { name: title }).click();
    await learnerPage.getByRole("link", { name: "Quiz maken" }).click();
    await expect(learnerPage.getByRole("heading", { name: quizTitle, level: 1 })).toBeVisible();
    expect(await learnerPage.content()).not.toContain("correctIndex");

    const submit = learnerPage.getByRole("button", { name: "Quiz indienen" });
    await submit.click();
    await expect(learnerPage.getByRole("alert").filter({ hasText: "Beantwoord alle vragen" })).toBeVisible();
    await learnerPage.getByRole("radio", { name: "Vier", exact: true }).check();
    await learnerPage.getByRole("radio", { name: "Nee", exact: true }).check();
    await submit.click();
    await expect(learnerPage.getByRole("status").filter({ hasText: "1 van 2 punten" })).toBeVisible();
    await learnerPage.reload();
    await expect(learnerPage.getByRole("status").filter({ hasText: "1 van 2 punten" })).toBeVisible();
    await learnerPage.getByRole("button", { name: "Opnieuw proberen" }).click();
    await learnerPage.getByRole("radio", { name: "Vier", exact: true }).check();
    await learnerPage.getByRole("radio", { name: "Ja", exact: true }).check();
    await submit.click();
    await expect(learnerPage.getByRole("status").filter({ hasText: "2 van 2 punten" })).toBeVisible();

    expect((await apiRequest(page, `${courseApi}/assignments`, "DELETE", target)).status).toBe(200);
    expect((await apiRequest(learnerPage, attemptPath, "POST", {
      submissionId: crypto.randomUUID(), selections: [1, 0],
    })).status).toBe(404);
    expect((await learnerPage.reload())?.status()).toBe(404);
  } finally {
    await learnerContext.close();
    await apiRequest(page, `${courseApi}/assignments`, "DELETE", target);
  }
});
