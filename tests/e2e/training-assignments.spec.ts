import { expect, test } from "./support/fixtures.ts";
import { addLesson, addModule, apiRequest, assertNoHorizontalOverflow, createCourse, login, saveLessonText } from "./support/flows.ts";

const coursesPath = "/api/organizations/courses";
const teamsPath = "/api/organizations/teams";

test("assignment management grants direct and team access and revokes the last path", async ({ page, browser, baseURL, e2e }) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const courseTitle = `LMS-099 course ${suffix}`;
  const teamName = `LMS-099 team ${suffix}`;
  const lessonContent = `Learner-only course content ${suffix}`;
  await login(page, e2e.users.adminA);
  const { courseId } = await createCourse(page, courseTitle);
  const assignmentsPath = `${coursesPath}/${courseId}/assignments`;
  const learnerPath = `/learn/courses/${courseId}`;
  const manage = page.getByRole("link", { name: "Toewijzingen" });
  await expect(manage).toHaveCount(0);
  expect((await apiRequest(page, assignmentsPath, "GET")).status).toBe(409);

  await addModule(page, "Introduction");
  await addLesson(page, "Introduction", "First exercise");
  await saveLessonText(page, "First exercise", lessonContent);
  expect((await apiRequest(page, `${coursesPath}/${courseId}/publish`, "POST", {})).status).toBe(200);
  await page.reload();
  await manage.click();
  await expect(page.getByRole("heading", { name: "Toewijzingen", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await assertNoHorizontalOverflow(page);

  const employees = await apiRequest(page, "/api/organizations/employees", "GET");
  const member = (employees.body as { employees: Array<{ id: string; email: string }> }).employees
    .find(({ email }) => email === e2e.users.memberA.email);
  expect(member).toBeDefined();
  const created = await apiRequest(page, teamsPath, "POST", { name: teamName });
  expect(created.status).toBe(201);
  const team = (created.body as { team: { id: string } }).team;
  const membersPath = `${teamsPath}/${team.id}/members`;
  expect((await apiRequest(page, membersPath, "POST", { employeeId: member!.id })).status).toBe(201);
  const learnerContext = await browser.newContext({ baseURL });
  try {
    const learner = await learnerContext.newPage();
    await login(learner, e2e.users.memberA);
    const courseLink = learner.getByRole("link", { name: courseTitle, exact: true });
    await expect(courseLink).toHaveCount(0);
    expect((await learner.goto(learnerPath))?.status()).toBe(404);
    await learner.goto("/learn");

    await page.getByLabel("Zoeken").fill(e2e.users.memberA.email);
    await page.getByRole("button", { name: "Zoeken", exact: true }).click();
    await page.getByLabel("Kies een medewerker").selectOption(member!.id);
    await page.getByRole("button", { name: "Toewijzen", exact: true }).click();
    await expect(page.getByText("Cursus toegewezen.", { exact: true })).toBeVisible();
    await expect(page.getByText(e2e.users.memberA.email, { exact: true })).toBeVisible();

    await page.getByLabel("Toewijzen aan").selectOption("team");
    await page.getByLabel("Zoeken").fill(teamName);
    await page.getByRole("button", { name: "Zoeken", exact: true }).click();
    await page.getByLabel("Kies een team").selectOption(team.id);
    await page.getByRole("button", { name: "Toewijzen", exact: true }).click();
    await expect(page.getByText(teamName, { exact: true })).toBeVisible();
    const repeat = await apiRequest(page, assignmentsPath, "PUT", { type: "team", targetId: team.id });
    expect(repeat.status).toBe(200);
    const current = await apiRequest(page, assignmentsPath, "GET");
    expect((current.body as { assignments: unknown[] }).assignments).toHaveLength(2);

    await learner.reload();
    await expect(courseLink).toHaveCount(1);
    await courseLink.click();
    await expect(learner.getByRole("heading", { name: courseTitle, level: 1 })).toBeVisible();
    await expect(learner.getByText(lessonContent, { exact: true })).toBeVisible();
    expect((await apiRequest(learner, assignmentsPath, "GET")).status).toBe(403);

    const memberAssignment = page.getByRole("listitem").filter({ hasText: e2e.users.memberA.email });
    await memberAssignment.getByRole("button", { name: /Toewijzing intrekken voor/ }).click();
    const confirmation = page.getByRole("dialog", { name: "Toewijzing intrekken" });
    await confirmation.getByRole("button", { name: "Annuleren" }).click();
    await expect(memberAssignment).toHaveCount(1);
    await memberAssignment.getByRole("button", { name: /Toewijzing intrekken voor/ }).click();
    await confirmation.getByRole("button", { name: "Intrekken bevestigen" }).click();
    await expect(memberAssignment).toHaveCount(0);
    await learner.reload();
    await expect(learner.getByText(lessonContent, { exact: true })).toBeVisible();

    expect((await apiRequest(page, `${membersPath}/${member!.id}`, "DELETE", {})).status).toBe(200);
    expect((await learner.reload())?.status()).toBe(404);
    await learner.goto("/learn");
    await expect(courseLink).toHaveCount(0);
  } finally {
    await learnerContext.close();
    await apiRequest(page, assignmentsPath, "DELETE", { type: "member", targetId: member!.id });
    await apiRequest(page, `${teamsPath}/${team.id}`, "DELETE", {});
  }
});

test("tenant boundaries also apply to direct assignment URLs and the learner course route", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerB);
  const draft = await createCourse(page, `Foreign LMS-099 ${crypto.randomUUID().slice(0, 8)}`);
  expect((await apiRequest(page, "/api/auth/logout", "POST", {})).status).toBe(200);
  await login(page, e2e.users.adminA);
  const endpoint = `${coursesPath}/${draft.courseId}/assignments`;
  expect((await apiRequest(page, endpoint, "GET")).status).toBe(404);
  expect((await page.goto(`/admin/courses/${draft.courseId}/assignments`))?.status()).toBe(404);
  expect((await apiRequest(page, "/api/auth/logout", "POST", {})).status).toBe(200);
  await login(page, e2e.users.memberA);
  expect((await page.goto(`/learn/courses/${draft.courseId}?organizationId=${e2e.organizationB.id}`))?.status()).toBe(404);
  await expect(page.getByText(draft.title, { exact: true })).toHaveCount(0);
});
