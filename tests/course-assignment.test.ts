import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationError } from "../src/lib/authorization-core.ts";
import {
  createCourseAssignmentHandlers,
  type CourseAssignmentStore,
} from "../src/lib/course-assignment-core.ts";

const organizationId = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const courseId = "4eb2c0f2-46ba-46d6-bd8e-4a5646ff0584";
const target = { type: "member", targetId: "d0ec3185-0aeb-4ef6-a309-39fadab2d374" } as const;
const entry = { ...target, name: "Test member", active: true };
const url = "https://lms.example.test/api/assignments";

function fixture(options: { deny?: boolean; status?: "PUBLISHED" | "DRAFT" | null; grant?: boolean } = {}) {
  const calls: unknown[][] = [];
  const store: CourseAssignmentStore = {
    async courseStatus(...args) { calls.push(["status", ...args]); return options.status === undefined ? "PUBLISHED" : options.status; },
    async list(...args) { calls.push(["list", ...args]); return [entry]; },
    async search(...args) { calls.push(["search", ...args]); return [entry]; },
    async grant(...args) { calls.push(["grant", ...args]); return options.grant ?? true; },
    async revoke(...args) { calls.push(["revoke", ...args]); },
  };
  const handlers = createCourseAssignmentHandlers({
    async requireTenantContext() { return { organizationId, role: "ADMIN", userId: target.targetId }; },
    async requirePermission(...args) {
      calls.push(["permission", ...args]);
      if (options.deny) throw new AuthorizationError("forbidden");
    },
    async getStore() { return store; },
    isTrustedRequest: (request) => request.headers.get("origin") === "https://lms.example.test",
    readBody: (request) => request.json(),
  });
  return { calls, handlers };
}

function mutation(method: "PUT" | "DELETE", body: unknown = target, origin = "https://lms.example.test") {
  return new Request(url, { method, headers: { origin }, body: JSON.stringify(body) });
}

test("assignment reads use the active tenant and ASSIGN_TRAINING permission", async () => {
  const { handlers, calls } = fixture();
  const result = await handlers.GET(new Request(url + "?organizationId=other"), courseId);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(await result.json(), { assignments: [entry] });
  assert.deepEqual(calls, [
    ["permission", organizationId, "ASSIGN_TRAINING"],
    ["status", organizationId, courseId],
    ["list", organizationId, courseId],
  ]);

  const search = await handlers.GET(new Request(url + "?type=member&q=%20test%20"), courseId);
  assert.deepEqual(await search.json(), { candidates: [entry] });
  assert.deepEqual(calls.at(-1), ["search", organizationId, "member", "test"]);
  assert.equal((await handlers.GET(new Request(url + "?type=other"), courseId)).status, 400);
});

test("forbidden, foreign, draft, and untrusted requests never reach assignment mutations", async () => {
  for (const [options, expected] of [
    [{ deny: true }, 403],
    [{ status: null }, 404],
    [{ status: "DRAFT" }, 409],
  ] as const) {
    const { handlers, calls } = fixture(options);
    assert.equal((await handlers.PUT(mutation("PUT"), courseId)).status, expected);
    assert.equal(calls.some(([operation]) => operation === "grant"), false);
  }
  const { handlers, calls } = fixture();
  assert.equal((await handlers.DELETE(mutation("DELETE", target, "https://other.example.test"), courseId)).status, 403);
  assert.deepEqual(calls, []);
});

test("assignment writes validate the target and return safe responses", async () => {
  const { handlers, calls } = fixture();
  assert.equal((await handlers.PUT(mutation("PUT", { ...target, organizationId: "other" }), courseId)).status, 400);
  assert.equal(calls.some(([operation]) => operation === "grant"), false);
  assert.deepEqual(await (await handlers.PUT(mutation("PUT"), courseId)).json(), { success: true });
  assert.deepEqual(calls.at(-1), ["grant", organizationId, courseId, target]);
  assert.deepEqual(await (await handlers.DELETE(mutation("DELETE"), courseId)).json(), { success: true });
  assert.deepEqual(calls.at(-1), ["revoke", organizationId, courseId, target]);

  const denied = await fixture({ grant: false }).handlers.PUT(mutation("PUT"), courseId);
  assert.equal(denied.status, 404);
  assert.deepEqual(await denied.json(), { error: "assignment_target_not_found" });
});
