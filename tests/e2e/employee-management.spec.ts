import { test, expect } from "./support/fixtures.ts";
import {
  apiRequest,
  assertControlReachable,
  assertNoHorizontalOverflow,
  login,
} from "./support/flows.ts";

const employeesPath = "/api/organizations/employees";

async function createEmployeeThroughUI(page: Parameters<typeof login>[0], name: string, email: string) {
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add employee" });
  await dialog.getByLabel("Employee name").fill(name);
  await dialog.getByLabel("Email").fill(email);
  const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && new URL(candidate.url()).pathname === employeesPath);
  await dialog.getByRole("button", { name: "Add employee", exact: true }).click();
  return response;
}

test("employee navigation, create, profile edit, reload persistence, and duplicate conflict", async ({ page, e2e }, testInfo) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin");
  await page.getByRole("navigation", { name: "Administration" }).getByRole("link", { name: "Employees" }).click();
  await expect(page).toHaveURL(/\/admin\/employees$/);
  await expect(page.getByRole("heading", { name: "Employees", exact: true })).toBeVisible();
  await expect(page.getByText("Activation invitations are sent from employee profiles.")).toBeVisible();
  await expect(page.getByRole("button", { name: /invitation/i })).toHaveCount(0);

  const suffix = crypto.randomUUID().slice(0, 8);
  const employeeName = `LMS-090 Employee ${suffix}`;
  const employeeEmail = `lms090-${suffix}@example.test`;
  const created = await createEmployeeThroughUI(page, employeeName, employeeEmail);
  expect(created.status()).toBe(201);
  await expect(page.getByRole("status").filter({ hasText: "Employee added" })).toBeVisible();
  const employeeCard = page.locator(".employee-card").filter({ hasText: employeeEmail });
  await expect(employeeCard.getByText("MEMBER", { exact: true })).toBeVisible();
  await expect(employeeCard.getByText("Active", { exact: true })).toBeVisible();
  await employeeCard.getByRole("link", { name: "View profile" }).click();
  await expect(page).toHaveURL(/\/admin\/employees\/[0-9a-f-]+$/i);
  await expect(page.getByRole("heading", { name: employeeName, exact: true })).toBeVisible();
  await expect(page.getByText("Activation invitations are sent from employee profiles.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send activation invitation" })).toBeVisible();

  await page.getByRole("button", { name: "Edit profile" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit employee profile" });
  await editDialog.getByLabel("Employee name").fill(`${employeeName} Updated`);
  await editDialog.getByLabel("Job title").fill("Learning specialist");
  await editDialog.getByLabel("Department").fill("Learning");
  await editDialog.getByLabel("Phone").fill("+32 2 555 01 23");
  await editDialog.getByLabel("Employee number").fill(`EMP-${suffix}`);
  const profilePatch = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/profile"));
  await editDialog.getByRole("button", { name: "Save profile" }).click();
  expect((await profilePatch).status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Profile saved" })).toBeVisible();
  await expect(page.getByText("Learning specialist", { exact: true })).toBeVisible();
  await expect(page.getByText("EMP-" + suffix, { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: `${employeeName} Updated`, exact: true })).toBeVisible();
  await expect(page.getByText("Learning specialist", { exact: true })).toBeVisible();
  await expect(page.getByText("Learning", { exact: true })).toBeVisible();

  await page.goto("/admin/employees");
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  const duplicateDialog = page.getByRole("dialog", { name: "Add employee" });
  await duplicateDialog.getByLabel("Employee name").fill(`Duplicate ${testInfo.title}`);
  await duplicateDialog.getByLabel("Email").fill(employeeEmail);
  await duplicateDialog.getByRole("button", { name: "Add employee", exact: true }).click();
  await expect(duplicateDialog.getByRole("alert")).toContainText("already exists in your organization");
  await expect(page.getByRole("status").filter({ hasText: "Employee added" })).toHaveCount(0);
});

test("activation invitation UI prevents duplicate submissions and distinguishes accepted from failed requests", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin/employees");
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `lms052-${suffix}@example.test`;
  const created = await createEmployeeThroughUI(page, `LMS-052 ${suffix}`, email);
  expect(created.status()).toBe(201);
  const employeeCard = page.locator(".employee-card").filter({ hasText: email });
  await employeeCard.getByRole("link", { name: "View profile" }).click();
  // The accessible name changes while the request is pending; keep the locator
  // matched across that state so the disabled assertion observes the same button.
  const inviteButton = page.getByRole("button", { name: /Send activation invitation|Sending invitation…/ });
  let calls = 0;
  let releaseFirstResponse: (() => void) | undefined;
  await page.route("**/api/organizations/employees/*/invitation", async (route) => {
    calls += 1;
    if (calls === 1) {
      await new Promise<void>((resolve) => { releaseFirstResponse = resolve; });
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ success: true }) });
      return;
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "invitation_delivery_failed" }) });
  });

  await inviteButton.click();
  await expect(inviteButton).toBeDisabled();
  await inviteButton.click({ force: true });
  expect(calls).toBe(1);
  releaseFirstResponse?.();
  await expect(page.getByRole("status").filter({ hasText: "Invitation email accepted" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "provider accepted the email request" })).toBeVisible();

  await inviteButton.click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be accepted by the provider" })).toBeVisible();
});

test("CSV import succeeds atomically and reports row validation failures", async ({ page, e2e }) => {
  await login(page, e2e.users.adminA);
  await page.goto("/admin/employees");
  const suffix = crypto.randomUUID().slice(0, 8);
  await page.getByRole("button", { name: "Import CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Import employees" });
  await dialog.locator('input[name="file"]').setInputFiles({
    name: "employees.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`email,name,jobTitle,department,phone,employeeNumber\nimport-${suffix}@example.test,Imported ${suffix},Instructor,Training,+32 2 555 01 23,IMP-${suffix}\n`),
  });
  const importResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/employees/import"));
  await dialog.getByRole("button", { name: "Import employees", exact: true }).click();
  const imported = await importResponse;
  expect(imported.status()).toBe(200);
  await expect(page.getByRole("status").filter({ hasText: "Employees imported" })).toBeVisible();
  const importedCard = page.locator(".employee-card").filter({ hasText: `import-${suffix}@example.test` });
  await expect(importedCard).toBeVisible();
  await expect(importedCard.getByText("Instructor", { exact: true })).toBeVisible();
  await expect(importedCard.getByText("Training", { exact: true })).toBeVisible();
  await importedCard.getByRole("link", { name: "View profile" }).click();
  await expect(page.getByText(`IMP-${suffix}`, { exact: true })).toBeVisible();

  await page.goto("/admin/employees");
  await page.getByRole("button", { name: "Import CSV" }).click();
  const invalidDialog = page.getByRole("dialog", { name: "Import employees" });
  await invalidDialog.locator('input[name="file"]').setInputFiles({
    name: "invalid-employees.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`email,name\nvalid-${suffix}@example.test,Valid ${suffix}\nnot-an-email,Invalid ${suffix}\n`),
  });
  const invalidResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/employees/import"));
  await invalidDialog.getByRole("button", { name: "Import employees", exact: true }).click();
  expect((await invalidResponse).status()).toBe(400);
  await expect(invalidDialog.getByRole("alert")).toContainText("Row 3, email");
  await expect(invalidDialog.getByRole("alert")).toContainText("Enter a valid email address");
  await expect(page.getByRole("status").filter({ hasText: "Employees imported" })).toHaveCount(0);
  const afterInvalidImport = await apiRequest(page, employeesPath, "GET");
  expect((afterInvalidImport.body as { employees: Array<{ email: string }> }).employees.some((employee) => employee.email === `valid-${suffix}@example.test`)).toBe(false);
});

test("confirmed discard clears employee and CSV drafts before reopening", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin/employees");
  await page.route("**/api/organizations/employees", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "employee_management_unavailable" }) });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  let createDialog = page.getByRole("dialog", { name: "Add employee" });
  await createDialog.getByLabel("Employee name").fill("Discard this employee");
  await createDialog.getByLabel("Email").fill("discard@example.test");
  await createDialog.getByRole("button", { name: "Add employee", exact: true }).click();
  await expect(createDialog.getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(createDialog).toHaveCount(0);

  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  createDialog = page.getByRole("dialog", { name: "Add employee" });
  await expect(createDialog.getByLabel("Employee name")).toHaveValue("");
  await expect(createDialog.getByLabel("Email")).toHaveValue("");
  await expect(createDialog.getByRole("alert")).toHaveCount(0);
  await createDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(createDialog).toHaveCount(0);
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  createDialog = page.getByRole("dialog", { name: "Add employee" });
  await expect(createDialog.getByLabel("Employee name")).toHaveValue("");
  await expect(createDialog.getByLabel("Email")).toHaveValue("");
  await createDialog.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  let importDialog = page.getByRole("dialog", { name: "Import employees" });
  const fileInput = importDialog.getByLabel("CSV file");
  await fileInput.setInputFiles({
    name: "discard.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("email,name\ndiscarded@example.test,Discarded\n"),
  });
  await expect(fileInput).not.toHaveValue("");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(importDialog).toHaveCount(0);

  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  importDialog = page.getByRole("dialog", { name: "Import employees" });
  await expect(importDialog.getByLabel("CSV file")).toHaveValue("");
  await expect(importDialog.getByRole("button", { name: "Import employees", exact: true })).toBeDisabled();
});

test("ambiguous employee import failures ask administrators to check the list before retrying", async ({ page, e2e }) => {
  await login(page, e2e.users.adminA);
  await page.goto("/admin/employees");
  let failAsNetwork = false;
  await page.route("**/api/organizations/employees/import", async (route) => {
    if (failAsNetwork) {
      await route.abort();
      return;
    }
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "employee_import_unavailable", message: "private database detail" }) });
  });
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import employees" });
  await dialog.getByLabel("CSV file").setInputFiles({
    name: "ambiguous.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("email,name\ncheck@example.test,Check Result\n"),
  });
  await dialog.getByRole("button", { name: "Import employees", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Check the employee list before retrying");
  await expect(dialog.getByRole("alert")).not.toContainText("No employees were imported");
  await expect(dialog.getByRole("alert")).not.toContainText("private database detail");
  failAsNetwork = true;
  await dialog.getByRole("button", { name: "Import employees", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Check the employee list before retrying");
  await expect(dialog.getByRole("alert")).not.toContainText("No employees were imported");
});

test("existing profile without an employee name can save other profile fields", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  const list = await apiRequest(page, employeesPath, "GET");
  const owner = (list.body as { employees: Array<{ id: string; email: string }> }).employees.find((employee) => employee.email === e2e.users.ownerA.email);
  expect(owner).toBeTruthy();
  const profilePath = `${employeesPath}/${owner!.id}/profile`;
  const initialProfile = await apiRequest(page, profilePath, "GET");
  expect((initialProfile.body as { profile: { employeeName: string | null } }).profile.employeeName).toBeNull();

  await page.goto(`/admin/employees/${owner!.id}`);
  await page.getByRole("button", { name: "Edit profile" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit employee profile" });
  const nameInput = editDialog.getByLabel("Employee name");
  await expect(nameInput).toHaveValue("");
  await expect(nameInput).not.toHaveAttribute("required");
  await editDialog.getByLabel("Job title").fill("Organization owner");
  const profilePatch = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith("/profile"));
  await editDialog.getByRole("button", { name: "Save profile", exact: true }).click();
  const saved = await profilePatch;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).not.toHaveProperty("employeeName");
  const updatedProfile = (await apiRequest(page, profilePath, "GET")).body as { profile: { employeeName: string | null; jobTitle: string | null } };
  expect(updatedProfile.profile.employeeName).toBeNull();
  expect(updatedProfile.profile.jobTitle).toBe("Organization owner");
});

test("deactivation can be canceled, confirmed, and protects the last active owner", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin/employees");
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `deactivate-${suffix}@example.test`;
  const response = await createEmployeeThroughUI(page, `Deactivate ${suffix}`, email);
  expect(response.status()).toBe(201);
  const card = page.locator(".employee-card").filter({ hasText: email });
  await card.getByRole("button", { name: "Deactivate" }).click();
  const confirmation = page.getByRole("dialog", { name: "Deactivate employee?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(card.getByText("Active", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Deactivate" }).click();
  const finalConfirmation = page.getByRole("dialog", { name: "Deactivate employee?" });
  const deactivateResponse = page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().endsWith("/deactivate"));
  await finalConfirmation.getByRole("button", { name: "Deactivate employee", exact: true }).click();
  expect((await deactivateResponse).status()).toBe(200);
  await expect(card.getByText("Inactive", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Deactivate" })).toHaveCount(0);

  const list = await apiRequest(page, employeesPath, "GET");
  const owner = (list.body as { employees: Array<{ id: string; email: string; role: string }> }).employees.find((employee) => employee.email === e2e.users.ownerA.email);
  expect(owner?.role).toBe("OWNER");
  const lastOwner = await apiRequest(page, `${employeesPath}/${owner!.id}/deactivate`, "POST", {});
  expect(lastOwner.status).toBe(409);
  expect(lastOwner.body).toEqual({ error: "last_owner_required" });
});

test("invalid and foreign employee IDs return safe not-found behavior", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerB);
  const tenantBList = await apiRequest(page, employeesPath, "GET");
  const ownerB = (tenantBList.body as { employees: Array<{ id: string; email: string }> }).employees.find((employee) => employee.email === e2e.users.ownerB.email);
  expect(ownerB).toBeTruthy();
  await page.getByRole("button", { name: /sign out|log out/i }).click();
  await login(page, e2e.users.ownerA);
  const invalidApi = await apiRequest(page, `${employeesPath}/not-a-uuid/profile`, "GET");
  const foreignApi = await apiRequest(page, `${employeesPath}/${ownerB!.id}/profile`, "GET");
  expect(invalidApi.status).toBe(404);
  expect(foreignApi.status).toBe(404);
  expect(foreignApi.body).toEqual(invalidApi.body);
  const foreignPage = await page.goto(`/admin/employees/${ownerB!.id}`);
  expect(foreignPage?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Employee unavailable" })).toBeVisible();
});

test("MEMBER access remains restricted while OWNER and ADMIN can manage employees", async ({ page, e2e }) => {
  await login(page, e2e.users.memberA);
  await page.goto("/admin/employees");
  await expect(page.getByRole("heading", { name: "Access unavailable" })).toBeVisible();
  expect((await apiRequest(page, employeesPath, "POST", { email: "member-added@example.test", name: "Member Added" })).status).toBe(403);

  expect((await apiRequest(page, "/api/auth/logout", "POST", {})).status).toBe(200);
  await login(page, e2e.users.adminA);
  await page.goto("/admin/employees");
  await expect(page.getByRole("heading", { name: "Employees", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add employee" })).toBeVisible();
});

test("responsive layouts, keyboard dialogs, list failures, and unavailable email delivery", async ({ page, e2e }) => {
  await login(page, e2e.users.ownerA);
  await page.goto("/admin/employees");
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 812 });
    await assertNoHorizontalOverflow(page);
    await assertControlReachable(page, page.getByRole("button", { name: "Add employee", exact: true }));
  }

  const addButton = page.getByRole("button", { name: "Add employee", exact: true });
  await addButton.click();
  const dialog = page.getByRole("dialog", { name: "Add employee" });
  await expect(dialog.getByLabel("Employee name")).toBeFocused();
  await dialog.getByLabel("Employee name").fill("Unsaved employee");
  await page.keyboard.press("Escape");
  const discard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
  await discard.getByRole("button", { name: "Continue editing" }).click();
  await expect(dialog.getByLabel("Employee name")).toHaveValue("Unsaved employee");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "Discard unsaved changes?" }).getByRole("button", { name: "Discard changes" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(addButton).toBeFocused();

  await page.route("**/api/organizations/employees", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "employee_management_unavailable" }) });
      return;
    }
    if (route.request().method() === "POST") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "employee_management_unavailable", message: "private database detail" }) });
      return;
    }
    await route.continue();
  });
  await page.reload();
  await expect(page.locator(".employee-error-panel")).toContainText("Employee data is temporarily unavailable");
  await expect(page.getByText("Activation invitations are sent from employee profiles.")).toBeVisible();
  await page.getByRole("button", { name: "Add employee", exact: true }).click();
  const failedCreate = page.getByRole("dialog", { name: "Add employee" });
  await failedCreate.getByLabel("Employee name").fill("Failure case");
  await failedCreate.getByLabel("Email").fill(`failure-${crypto.randomUUID().slice(0, 8)}@example.test`);
  await failedCreate.getByRole("button", { name: "Add employee", exact: true }).click();
  await expect(failedCreate.getByRole("alert")).toContainText("temporarily unavailable");
  await expect(failedCreate.getByRole("alert")).not.toContainText("private database detail");
  await expect(page.getByRole("status").filter({ hasText: "Employee added" })).toHaveCount(0);
});
