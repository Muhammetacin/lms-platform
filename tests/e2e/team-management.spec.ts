import { expect, test } from "./support/fixtures.ts";
import {
  apiRequest,
  assertControlReachable,
  assertNoHorizontalOverflow,
  login,
} from "./support/flows.ts";

const teamsPath = "/api/organizations/teams";
const employeesPath = "/api/organizations/employees";

type ApiBody = Record<string, unknown>;

test("team overview creates, validates, edits, searches, and discards unsaved team forms", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Teams" }).click();
  await expect(page).toHaveURL(/\/admin\/teams$/);
  await expect(page.getByRole("heading", { name: "No teams yet" })).toBeVisible();

  const suffix = crypto.randomUUID().slice(0, 8);
  const teamName = `LMS-091 Team ${suffix}`;
  const createTeam = page.getByRole("button", { name: "Create team", exact: true });
  await createTeam.click();
  const discardedDialog = page.getByRole("dialog", { name: "Create team" });
  await discardedDialog.getByLabel("Team name").fill("Discard this draft");
  await page.keyboard.press("Escape");
  const discardDialog = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await discardDialog.getByRole("button", { name: "Continue editing" }).click();
  await expect(discardedDialog.getByLabel("Team name")).toHaveValue("Discard this draft");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(discardedDialog).toHaveCount(0);
  await expect(createTeam).toBeFocused();

  await createTeam.click();
  let dialog = page.getByRole("dialog", { name: "Create team" });
  await expect(dialog.getByLabel("Team name")).toHaveValue("");
  await dialog.getByRole("button", { name: "Create team", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Enter a team name between 2 and 120 characters");

  await dialog.getByLabel("Team name").fill(teamName);
  await dialog.getByLabel("Description (optional)").fill("LMS-091 acceptance team");
  const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === teamsPath);
  await dialog.getByRole("button", { name: "Create team", exact: true }).click();
  const created = await createResponse;
  expect(created.status()).toBe(201);
  const createdBody = await created.json() as { team: { id: string } };
  await expect(page.getByRole("status").filter({ hasText: "Team created" })).toBeVisible();
  await expect(page.getByText("The API returns up to 100 teams. Search checks only the teams loaded here.")).toBeVisible();
  const teamCard = page.locator(".team-card").filter({ hasText: teamName });
  await expect(teamCard).toContainText("LMS-091 acceptance team");

  await page.getByRole("button", { name: "Create team", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Create team" });
  await dialog.getByLabel("Team name").fill(teamName);
  const duplicateResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === teamsPath);
  await dialog.getByRole("button", { name: "Create team", exact: true }).click();
  expect((await duplicateResponse).status()).toBe(409);
  await expect(dialog.getByRole("alert")).toContainText("A team with this exact name already exists");
  await expect(page.getByRole("status").filter({ hasText: "Team created" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  let cancelConfirmation = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await cancelConfirmation.getByRole("button", { name: "Continue editing" }).click();
  await expect(dialog.getByLabel("Team name")).toHaveValue(teamName);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  cancelConfirmation = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await cancelConfirmation.getByRole("button", { name: "Discard changes" }).click();
  await expect(dialog).toHaveCount(0);

  await teamCard.getByRole("button", { name: "Edit", exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit team" });
  await expect(editDialog.getByLabel("Team name")).toHaveValue(teamName);
  await editDialog.getByLabel("Description (optional)").fill("Updated LMS-091 description");
  const patchResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().includes(teamsPath + "/" + createdBody.team.id));
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  expect((await patchResponse).status()).toBe(200);
  await expect(teamCard).toContainText("Updated LMS-091 description");
  await expect(page.getByRole("status").filter({ hasText: "Team updated" })).toBeVisible();

  await teamCard.getByRole("button", { name: "Edit", exact: true }).click();
  const dirtyEdit = page.getByRole("dialog", { name: "Edit team" });
  await dirtyEdit.getByLabel("Description (optional)").fill("Discard this team description");
  await page.keyboard.press("Escape");
  const continueEdit = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await continueEdit.getByRole("button", { name: "Continue editing" }).click();
  await expect(dirtyEdit.getByLabel("Description (optional)")).toHaveValue("Discard this team description");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(dirtyEdit).toHaveCount(0);
  await expect(teamCard).toContainText("Updated LMS-091 description");

  await page.getByLabel("Search loaded teams").fill("updated lms-091");
  await expect(teamCard).toBeVisible();
  await page.getByLabel("Search loaded teams").fill("not present");
  await expect(page.getByRole("status")).toContainText("No teams match this search in the loaded list");
  await page.getByLabel("Search loaded teams").fill("");

  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoHorizontalOverflow(page);
    await assertControlReachable(page, createTeam);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
});

test("active employees can belong to multiple teams and team removal and deletion preserve employee accounts", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin/teams");
  const suffix = crypto.randomUUID().slice(0, 8);
  const employeeName = `LMS-091 Employee ${suffix}`;
  const employeeEmail = `lms091-${suffix}@example.test`;
  const employeeResult = await apiRequest(page, employeesPath, "POST", { email: employeeEmail, name: employeeName });
  expect(employeeResult.status).toBe(201);
  const employee = (employeeResult.body as { employee: { id: string } }).employee;

  const primaryTeam = `LMS-091 Primary ${suffix}`;
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Create team" });
  await dialog.getByLabel("Team name").fill(primaryTeam);
  await dialog.getByRole("button", { name: "Create team", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Team created" })).toBeVisible();
  const primaryCard = page.locator(".team-card").filter({ hasText: primaryTeam });
  await primaryCard.getByRole("link", { name: "Manage team" }).click();
  await expect(page.getByRole("heading", { name: primaryTeam, exact: true })).toBeVisible();
  await expect(page.getByText("The API displays up to 100 active members.")).toBeVisible();

  const primaryAdd = page.getByRole("button", { name: "Add employee", exact: true });
  await primaryAdd.click();
  dialog = page.getByRole("dialog", { name: "Add employee to team" });
  await dialog.getByLabel("Active employee").selectOption(employee.id);
  const addResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/members"));
  await dialog.getByRole("button", { name: "Add to team" }).click();
  expect((await addResponse).status()).toBe(201);
  await expect(page.locator(".team-member-card").filter({ hasText: employeeEmail })).toBeVisible();
  const primaryTeamId = new URL(page.url()).pathname.split("/").at(-1)!;
  await assertNoHorizontalOverflow(page);
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await assertNoHorizontalOverflow(page);
    await assertControlReachable(page, primaryAdd);
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.getByRole("link", { name: "Back to teams" }).click();
  const secondTeamName = `LMS-091 Secondary ${suffix}`;
  await page.getByRole("button", { name: "Create team", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Create team" });
  await dialog.getByLabel("Team name").fill(secondTeamName);
  await dialog.getByRole("button", { name: "Create team", exact: true }).click();
  const secondCard = page.locator(".team-card").filter({ hasText: secondTeamName });
  await secondCard.getByRole("link", { name: "Manage team" }).click();
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Add employee to team" });
  await dialog.getByLabel("Active employee").selectOption(employee.id);
  await dialog.getByRole("button", { name: "Add to team" }).click();
  await expect(page.locator(".team-member-card").filter({ hasText: employeeEmail })).toBeVisible();
  const secondTeamId = new URL(page.url()).pathname.split("/").at(-1)!;
  const membersBeforeDelete = await apiRequest(page, teamsPath + "/" + secondTeamId + "/members", "GET");
  expect(membersBeforeDelete.status).toBe(200);
  expect((membersBeforeDelete.body as { members: Array<{ id: string }> }).members.some(({ id }) => id === employee.id)).toBe(true);
  const primaryMembersBeforeRemove = await apiRequest(page, teamsPath + "/" + primaryTeamId + "/members", "GET");
  expect((primaryMembersBeforeRemove.body as { members: Array<{ id: string }> }).members.some(({ id }) => id === employee.id)).toBe(true);

  await page.getByRole("link", { name: "Back to teams" }).click();
  await primaryCard.getByRole("link", { name: "Manage team" }).click();
  await page.locator(".team-member-card").filter({ hasText: employeeEmail }).getByRole("button", { name: "Remove" }).click();
  let confirmation = page.getByRole("dialog", { name: "Remove employee from team?" });
  await expect(confirmation).toContainText("does not deactivate or delete the employee");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".team-member-card").filter({ hasText: employeeEmail })).toBeVisible();
  await page.locator(".team-member-card").filter({ hasText: employeeEmail }).getByRole("button", { name: "Remove" }).click();
  confirmation = page.getByRole("dialog", { name: "Remove employee from team?" });
  const removeResponse = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().endsWith("/members/" + employee.id));
  await confirmation.getByRole("button", { name: "Remove from team" }).click();
  expect((await removeResponse).status()).toBe(200);
  await expect(page.locator(".team-member-card").filter({ hasText: employeeEmail })).toHaveCount(0);
  const primaryMembersAfterRemove = await apiRequest(page, teamsPath + "/" + primaryTeamId + "/members", "GET");
  expect((primaryMembersAfterRemove.body as { members: Array<{ id: string }> }).members.some(({ id }) => id === employee.id)).toBe(false);
  const secondaryMembersAfterRemove = await apiRequest(page, teamsPath + "/" + secondTeamId + "/members", "GET");
  expect((secondaryMembersAfterRemove.body as { members: Array<{ id: string }> }).members.some(({ id }) => id === employee.id)).toBe(true);

  await page.getByRole("link", { name: "Back to teams" }).click();
  await secondCard.getByRole("button", { name: "Delete", exact: true }).click();
  confirmation = page.getByRole("dialog", { name: "Delete team?" });
  await expect(confirmation).toContainText("permanently removes its team memberships");
  await expect(confirmation).toContainText("Employee accounts are not deleted");
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(secondCard).toBeVisible();
  await secondCard.getByRole("button", { name: "Delete", exact: true }).click();
  confirmation = page.getByRole("dialog", { name: "Delete team?" });
  const deleteResponse = page.waitForResponse((response) => response.request().method() === "DELETE" && response.url().endsWith("/" + secondTeamId));
  await confirmation.getByRole("button", { name: "Delete team" }).click();
  expect((await deleteResponse).status()).toBe(200);
  await expect(secondCard).toHaveCount(0);

  const remainingEmployees = await apiRequest(page, employeesPath, "GET");
  const found = (remainingEmployees.body as { employees: Array<{ id: string; email: string; active: boolean }> }).employees.find(({ id }) => id === employee.id);
  expect(found).toMatchObject({ id: employee.id, email: employeeEmail, active: true });
  expect((await apiRequest(page, teamsPath + "/" + secondTeamId + "/members", "GET")).status).toBe(404);
});

test("inactive employees cannot be added and list and member API failures have retry states", async ({ page, e2e }) => {
  await login(page, e2e.users.adminA);
  const suffix = crypto.randomUUID().slice(0, 8);
  const teamResult = await apiRequest(page, teamsPath, "POST", { name: `LMS-091 Admin ${suffix}`, description: null });
  expect(teamResult.status).toBe(201);
  const team = (teamResult.body as { team: { id: string; name: string } }).team;
  const employeeResult = await apiRequest(page, employeesPath, "POST", { email: `lms091-inactive-${suffix}@example.test`, name: `Inactive ${suffix}` });
  expect(employeeResult.status).toBe(201);
  const employee = (employeeResult.body as { employee: { id: string } }).employee;
  const deactivated = await apiRequest(page, employeesPath + "/" + employee.id + "/deactivate", "POST", {});
  expect(deactivated.status).toBe(200);
  expect((await apiRequest(page, teamsPath + "/" + team.id + "/members", "POST", { employeeId: employee.id })).status).toBe(404);

  let releaseTeamList: () => void = () => {};
  const teamListGate = new Promise<void>((resolve) => { releaseTeamList = resolve; });
  await page.route("**/api/organizations/teams", async (route) => {
    if (route.request().method() === "GET") {
      await teamListGate;
      await route.continue();
      return;
    }
    await route.continue();
  });
  const initialNavigation = page.goto("/admin/teams");
  await expect(page.getByRole("status")).toContainText("Loading teams");
  releaseTeamList();
  await initialNavigation;
  await expect(page.getByRole("heading", { name: team.name })).toBeVisible();
  await page.unroute("**/api/organizations/teams");

  await page.route("**/api/organizations/teams", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "team_management_unavailable", details: "private backend data" }) });
      return;
    }
    await route.continue();
  });
  await page.goto("/admin/teams");
  await expect(page.getByRole("heading", { name: "Teams are unavailable" })).toBeVisible();
  await expect(page.locator(".team-error-panel")).not.toContainText("private backend data");
  await page.unroute("**/api/organizations/teams");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: team.name })).toBeVisible();

  await page.route("**/api/organizations/teams/*/members", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "team_membership_unavailable" }) });
      return;
    }
    await route.continue();
  });
  await page.goto("/admin/teams/" + team.id);
  await expect(page.getByText("Team membership is temporarily unavailable", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.unroute("**/api/organizations/teams/*/members");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("This team has no active members yet.")).toBeVisible();
  await page.route("**/api/organizations/employees", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "employee_management_unavailable" }) });
      return;
    }
    await route.continue();
  });
  await page.goto("/admin/teams/" + team.id);
  await expect(page.getByText("The employee list is temporarily unavailable", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add employee", exact: true })).toBeDisabled();
  await page.unroute("**/api/organizations/employees");
  await page.getByRole("button", { name: "Retry employee list" }).click();
  await expect(page.getByRole("button", { name: "Add employee", exact: true })).toBeEnabled();
  await expect(page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Teams" })).toHaveAttribute("aria-current", "page");
});

test("MEMBER retains team reads without other employees' protected fields and cannot manage teams", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  const teamResult = await apiRequest(page, teamsPath, "POST", { name: `LMS-091 Privacy ${crypto.randomUUID().slice(0, 8)}`, description: null });
  expect(teamResult.status).toBe(201);
  const team = (teamResult.body as { team: { id: string } }).team;
  const employeeResult = await apiRequest(page, employeesPath, "POST", { email: `lms091-private-${crypto.randomUUID().slice(0, 8)}@example.test`, name: "Private Teammate" });
  expect(employeeResult.status).toBe(201);
  const otherEmployee = (employeeResult.body as { employee: { id: string } }).employee;
  const employeeList = await apiRequest(page, employeesPath, "GET");
  const memberEmployee = (employeeList.body as { employees: Array<{ id: string; email: string }> }).employees.find(({ email }) => email === e2e.users.memberA.email);
  expect(memberEmployee).toBeTruthy();
  await apiRequest(page, employeesPath + "/" + memberEmployee!.id + "/profile", "PATCH", { jobTitle: "Member self title", department: "Member self department" });
  await apiRequest(page, employeesPath + "/" + otherEmployee.id + "/profile", "PATCH", { jobTitle: "Private title", department: "Private department" });
  expect((await apiRequest(page, teamsPath + "/" + team.id + "/members", "POST", { employeeId: memberEmployee!.id })).status).toBe(201);
  expect((await apiRequest(page, teamsPath + "/" + team.id + "/members", "POST", { employeeId: otherEmployee.id })).status).toBe(201);

  await page.context().clearCookies();
  await login(page, e2e.users.memberA);
  const teamList = await apiRequest(page, teamsPath, "GET");
  expect(teamList.status).toBe(200);
  const memberList = await apiRequest(page, teamsPath + "/" + team.id + "/members", "GET");
  expect(memberList.status).toBe(200);
  const members = (memberList.body as { members: ApiBody[] }).members;
  const self = members.find(({ id }) => id === memberEmployee!.id)!;
  expect(self).toMatchObject({ jobTitle: "Member self title", department: "Member self department" });
  const other = members.find(({ id }) => id === otherEmployee.id)!;
  expect(other).not.toHaveProperty("jobTitle");
  expect(other).not.toHaveProperty("department");
  expect(other).not.toHaveProperty("userId");
  expect((await apiRequest(page, teamsPath + "/" + team.id + "/members", "POST", { employeeId: otherEmployee.id })).status).toBe(403);
  expect((await apiRequest(page, teamsPath + "/" + team.id + "/members/" + otherEmployee.id, "DELETE")).status).toBe(403);

  await page.goto("/admin/teams");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Administration" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create team" })).toHaveCount(0);
});

test("foreign and invalid Team identifiers use safe not-found behavior", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  const teamResult = await apiRequest(page, teamsPath, "POST", { name: `LMS-091 Foreign ${crypto.randomUUID().slice(0, 8)}`, description: null });
  const team = (teamResult.body as { team: { id: string } }).team;
  const employees = await apiRequest(page, employeesPath, "GET");
  const employee = (employees.body as { employees: Array<{ id: string; email: string }> }).employees.find(({ email }) => email === e2e.users.ownerA.email)!;

  await page.context().clearCookies();
  await login(page, e2e.users.ownerB);
  const foreignDetail = await apiRequest(page, teamsPath + "/" + team.id, "GET");
  const missingDetail = await apiRequest(page, teamsPath + "/" + crypto.randomUUID(), "GET");
  expect(foreignDetail.status).toBe(404);
  expect(foreignDetail.body).toEqual(missingDetail.body);
  expect((await apiRequest(page, teamsPath + "/not-a-uuid", "GET")).status).toBe(404);
  expect((await apiRequest(page, teamsPath + "/" + team.id + "/members", "GET")).status).toBe(404);
  expect((await apiRequest(page, teamsPath + "/" + team.id + "/members", "POST", { employeeId: employee.id })).status).toBe(404);
  await page.goto("/admin/teams/not-a-uuid");
  await expect(page.getByRole("heading", { name: "Team unavailable" })).toBeVisible();
  await expect(page.getByText("This team is no longer available in your organization.")).toBeVisible();
});
