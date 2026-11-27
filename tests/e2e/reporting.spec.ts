import { expect, test } from "./support/fixtures.ts";
import { addLesson, addModule, apiRequest, assertNoHorizontalOverflow, createCourse, login } from "./support/flows.ts";

test("administrators filter course reports and see the latest quiz score for current assignees", async ({ page, browser, baseURL, e2e }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const title = `LMS-113 course ${suffix}`;
  const teamName = `LMS-113 team ${suffix}`;
  await login(page, e2e.users.adminA);
  const { courseId } = await createCourse(page, title);
  const courseApi = `/api/organizations/courses/${courseId}`;
  const reportPath = `/admin/reports/${courseId}`;
  await addModule(page, "Report module");
  const quizId = await addLesson(page, "Report module", "Report quiz", "QUIZ");
  expect((await apiRequest(page, `${courseApi}/quizzes/${quizId}`, "PUT", {
    questions: [{ prompt: "Choose yes", options: ["Yes", "No"], correctIndex: 0 }],
  })).status).toBe(200);
  expect((await apiRequest(page, `${courseApi}/publish`, "POST", {})).status).toBe(200);

  const { employees } = (await apiRequest(page, "/api/organizations/employees", "GET")).body as {
    employees: Array<{ id: string; email: string }>;
  };
  const member = employees.find(({ email }) => email === e2e.users.memberA.email)!;
  const created = await apiRequest(page, "/api/organizations/teams", "POST", { name: teamName });
  expect(created.status).toBe(201);
  const { team } = created.body as { team: { id: string } };
  const teamApi = `/api/organizations/teams/${team.id}`;
  const direct = { type: "member", targetId: member.id };
  const group = { type: "team", targetId: team.id };
  const viewerContext = await browser.newContext({ baseURL });
  try {
    expect((await apiRequest(page, `${teamApi}/members`, "POST", { employeeId: member.id })).status).toBe(201);
    expect((await apiRequest(page, `${courseApi}/assignments`, "PUT", direct)).status).toBe(200);
    expect((await apiRequest(page, `${courseApi}/assignments`, "PUT", group)).status).toBe(200);

    await page.getByRole("link", { name: "Rapportage", exact: true }).click();
    const courseRow = page.getByRole("row").filter({ hasText: title });
    await page.getByLabel("Cursusnaam").fill(title.toUpperCase());
    const apply = page.getByRole("button", { name: "Filters toepassen" });
    await apply.click();
    await expect(page).toHaveURL((url) => url.searchParams.get("course") === title.toUpperCase());
    await expect(courseRow.getByRole("cell")).toHaveText(["1", "1", "0", "0", "0"]);
    await page.getByLabel("Teamnaam").fill(teamName);
    await page.getByLabel("Voortgangsstatus").selectOption("completed");
    await apply.click();
    await expect(page.getByText("Geen gepubliceerde cursussen voor deze filters.")).toBeVisible();

    const viewer = await viewerContext.newPage();
    await login(viewer, e2e.users.memberA);
    await viewer.goto(reportPath);
    await expect(viewer.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
    const attemptPath = `/api/learn/courses/${courseId}/quizzes/${quizId}/attempts`;
    for (const choice of [0, 1]) {
      expect((await apiRequest(viewer, attemptPath, "POST", {
        submissionId: crypto.randomUUID(), selections: [choice],
      })).status).toBe(200);
    }

    await page.reload();
    await expect(courseRow.getByRole("cell")).toHaveText(["1", "0", "0", "1", "1"]);
    await courseRow.getByRole("link", { name: title }).click();
    await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
    await expect(page.getByLabel("Teamnaam")).toHaveValue(teamName);
    const learner = page.getByRole("row").filter({ hasText: member.email });
    await expect(learner.getByRole("cell")).toHaveText(["Afgerond", "1 van 1 les afgerond", "Report quiz · 0 van 1"]);
    await page.setViewportSize({ width: 375, height: 812 });
    await assertNoHorizontalOverflow(page);

    expect((await apiRequest(page, `${courseApi}/assignments`, "DELETE", group)).status).toBe(200);
    await page.reload();
    await expect(learner).toBeVisible();
    expect((await apiRequest(page, `${courseApi}/assignments`, "DELETE", direct)).status).toBe(200);
    await page.reload();
    await expect(page.getByText("Geen medewerkers met toegang voor deze filters.")).toBeVisible();

    expect((await apiRequest(viewer, "/api/auth/logout", "POST", {})).status).toBe(200);
    await login(viewer, e2e.users.ownerB);
    expect((await viewer.goto(reportPath))?.status()).toBe(404);
    await viewer.goto("/admin/reports");
    await expect(viewer.getByText(title, { exact: true })).toHaveCount(0);
  } finally {
    await viewerContext.close();
    await apiRequest(page, `${courseApi}/assignments`, "DELETE", direct);
    await apiRequest(page, teamApi, "DELETE", {});
  }
});
