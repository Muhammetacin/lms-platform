import { Pool } from "pg";
import { assertCurrentDatabase, validateE2EDatabaseUrl } from "./support/database-url.ts";
import { expect, test } from "./support/fixtures.ts";
import { addLesson, addModule, apiRequest, createCourse, login, saveLessonText } from "./support/flows.ts";

test("a learner starts an available course and their progress reaches the admin report", async ({ page, browser, baseURL, e2e }) => {
  const title = `Catalog course ${crypto.randomUUID().slice(0, 8)}`;
  await login(page, e2e.users.adminA);
  const { courseId } = await createCourse(page, title);
  const adminPath = `/admin/courses/${courseId}`;
  const courseApi = `/api/organizations/courses/${courseId}`;
  const lessonPath = `/learn/courses/${courseId}`;
  const enrollmentPath = `/api${lessonPath}/enrollment`;
  await addModule(page, "Catalog module");
  await addLesson(page, "Catalog module", "Independent study");
  await saveLessonText(page, "Independent study", "Read this text.");
  const quizId = await addLesson(page, "Catalog module", "Knowledge check", "QUIZ");
  expect((await apiRequest(page, `${courseApi}/quizzes/${quizId}`, "PUT", {
    questions: [{ prompt: "Choose yes", options: ["Yes", "No"], correctIndex: 0 }],
  })).status).toBe(200);
  expect((await apiRequest(page, `${courseApi}/catalog`, "PUT", { catalogListed: true })).status).toBe(404);
  expect((await apiRequest(page, `${courseApi}/publish`, "POST", {})).status).toBe(200);
  await page.goto(adminPath);

  const context = await browser.newContext({ baseURL });
  try {
    const learner = await context.newPage();
    await login(learner, e2e.users.memberA);
    await learner.getByRole("navigation", { name: "Leeromgeving" }).getByRole("link", { name: "Catalogus" }).click();
    await expect(learner.getByRole("heading", { name: "Catalogus" })).toBeVisible();
    const card = learner.getByRole("listitem").filter({ has: learner.getByRole("heading", { name: title }) });
    await expect(card).toHaveCount(0);
    expect((await apiRequest(learner, enrollmentPath, "PUT", {})).status).toBe(404);
    expect((await apiRequest(learner, `${courseApi}/catalog`, "PUT", { catalogListed: true })).status).toBe(403);

    await page.getByRole("button", { name: "Toon in catalogus" }).click();
    await expect(page.getByText("Zichtbaar in de catalogus", { exact: true })).toBeVisible();
    await learner.reload();
    await expect(card).toBeVisible();
    expect((await learner.goto(lessonPath))?.status()).toBe(404);
    await learner.goto("/learn/catalog");
    await card.getByRole("button", { name: "Start cursus" }).click();
    await expect(learner).toHaveURL(new RegExp(`${lessonPath}$`));
    await expect(learner.getByText("0 van 2 lessen afgerond")).toBeVisible();
    await learner.getByRole("button", { name: "Markeer als afgerond" }).click();
    await expect(learner.getByText("1 van 2 lessen afgerond")).toBeVisible();
    await learner.getByRole("link", { name: "Quiz maken" }).click();
    await learner.getByRole("radio", { name: "Yes", exact: true }).check();
    await learner.getByRole("button", { name: "Quiz indienen" }).click();
    await expect(learner.getByText("1 van 1 punten")).toBeVisible();

    await page.getByRole("button", { name: "Verberg in catalogus" }).click();
    await expect(page.getByText("Verborgen in de catalogus", { exact: true })).toBeVisible();
    await learner.goto("/learn/catalog");
    await expect(card).toHaveCount(0);
    await learner.goto("/learn");
    await expect(learner.getByRole("link", { name: title })).toBeVisible();
    await expect(learner.getByText("2 van 2 lessen afgerond")).toBeVisible();

    await page.goto(`/admin/reports/${courseId}`);
    const row = page.getByRole("row").filter({ hasText: e2e.users.memberA.email });
    await expect(row.getByRole("cell")).toHaveText(["Afgerond", "2 van 2 lessen afgerond", "Knowledge check · 1 van 1"]);
  } finally {
    await context.close();
    const connectionString = validateE2EDatabaseUrl(process.env.E2E_DATABASE_URL ?? "").href;
    const db = new Pool({ connectionString, max: 1 });
    try {
      const { rows } = await db.query<{ name: string }>("SELECT current_database() AS name");
      assertCurrentDatabase(rows[0]?.name ?? "");
      await db.query('DELETE FROM "Course" WHERE id = $1 AND "organizationId" = $2', [courseId, e2e.organizationA.id]);
    } finally {
      await db.end();
    }
  }
});
