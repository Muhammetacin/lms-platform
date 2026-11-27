import assert from "node:assert/strict";
import test from "node:test";
import { AuthorizationError } from "../src/lib/authorization-core.ts";
import { createQuizAuthorHandlers, loadAuthorQuiz, type QuizAuthorStore } from "../src/lib/quiz-author-core.ts";
import { parseQuizDefinition } from "../src/lib/quiz-core.ts";
import { createLearnerQuizHandler, parseQuizSubmission, scoreQuiz } from "../src/lib/learner-quiz-core.ts";

const organizationId = "dc14fd7e-dd80-4c69-8b61-b1816c6627c6";
const userId = "2b2dfe4b-2712-4f08-bb54-51c1f0df1d47";
const address = { courseId: userId, lessonId: "c4a89820-f389-4f67-8c64-20ba38639f74" };
const questions = [{ prompt: "Question", options: ["One", "Two"], correctIndex: 1 }];

test("quiz definitions normalize text and validate option and answer bounds", () => {
  assert.deepEqual(parseQuizDefinition({ questions: [{ ...questions[0], prompt: " Question ", options: ["One ", "Two"] }] }), questions);
  for (const input of [
    { questions: [] },
    { questions: Array(21).fill(questions[0]) },
    { questions: [{ ...questions[0], prompt: " " }] },
    { questions: [{ ...questions[0], prompt: "x".repeat(301) }] },
    { questions: [{ ...questions[0], options: ["One", "One "] }] },
    { questions: [{ ...questions[0], options: ["One"] }] },
    { questions: [{ ...questions[0], correctIndex: 2 }] },
    { questions: [{ ...questions[0], correctIndex: 1.5 }] },
    { questions, organizationId },
  ]) assert.equal(parseQuizDefinition(input), null);
});

test("author operations use trusted tenant and course permission before reading or writing", async () => {
  const calls: unknown[][] = [];
  let allowed = true;
  let result: "saved" | "missing" | "locked" = "saved";
  const store: QuizAuthorStore = {
    async get(...args) { calls.push(["get", ...args]); return { title: "Quiz", editable: true, questions }; },
    async replace(...args) { calls.push(["replace", ...args]); return result; },
  };
  const dependencies = {
    async requireTenantContext() { return { organizationId, userId, role: "ADMIN" as const }; },
    async requirePermission(...args: [string, string]) {
      calls.push(["permission", ...args]);
      if (!allowed) throw new AuthorizationError("forbidden");
    },
    async getStore() { return store; },
    isTrustedRequest: (request: Request) => request.headers.has("origin"),
    readBody: (request: Request) => request.json(),
  };
  const handlers = createQuizAuthorHandlers(dependencies);
  const request = (body: unknown, trusted = true) => new Request("https://example.test/quizzes", {
    method: "PUT",
    headers: trusted ? { origin: "https://example.test" } : undefined,
    body: JSON.stringify(body),
  });

  assert.deepEqual((await loadAuthorQuiz(dependencies, address))?.questions, questions);
  assert.deepEqual(calls, [["permission", organizationId, "MANAGE_COURSES"], ["get", organizationId, address]]);
  assert.equal((await handlers.PUT(request({ questions }, false), address)).status, 403);
  assert.equal((await handlers.PUT(request({ questions: [] }), address)).status, 400);
  const saved = await handlers.PUT(request({ questions }), address);
  assert.equal(saved.headers.get("cache-control"), "no-store");
  assert.deepEqual(await saved.json(), { success: true });
  assert.deepEqual(calls.at(-1), ["replace", organizationId, address, questions]);
  result = "locked";
  assert.equal((await handlers.PUT(request({ questions }), address)).status, 409);
  result = "missing";
  assert.equal((await handlers.PUT(request({ questions }), address)).status, 404);
  allowed = false;
  assert.equal((await handlers.PUT(request({ questions }), address)).status, 403);
  assert.deepEqual(calls.at(-1), ["permission", organizationId, "MANAGE_COURSES"]);
});

test("learner submissions accept only the request key and bounded selections", () => {
  const valid = { submissionId: userId, selections: [1] };
  assert.deepEqual(parseQuizSubmission(valid), valid);
  for (const invalid of [
    { ...valid, selections: [] },
    { ...valid, selections: ["1"] },
    { ...valid, selections: [6] },
    { ...valid, selections: [0.5] },
    { ...valid, submissionId: "invalid" },
    { ...valid, userId },
    { ...valid, score: 1 },
  ]) assert.equal(parseQuizSubmission(invalid), null);
  assert.deepEqual(scoreQuiz(questions, [1]), { score: 1, totalQuestions: 1 });
  assert.deepEqual(scoreQuiz(questions, [0]), { score: 0, totalQuestions: 1 });
  assert.equal(scoreQuiz(questions, []), null);
  assert.equal(scoreQuiz(questions, [2]), null);
});

test("learner submission routes scope writes to the active member", async () => {
  let role: "ADMIN" | "MEMBER" = "ADMIN";
  let saved = false;
  const submission = { submissionId: userId, selections: [1] };
  const post = createLearnerQuizHandler({
    async requireTenantContext() { return { organizationId, userId, role }; },
    async getStore() {
      return {
        async get() { return null; },
        async submit(identity, quizAddress, input) {
          assert.equal(identity.organizationId, organizationId);
          assert.equal(identity.userId, userId);
          assert.deepEqual(quizAddress, address);
          assert.deepEqual(input, submission);
          saved = true;
          return { kind: "scored", result: { score: 1, totalQuestions: 1 } };
        },
      };
    },
    isTrustedRequest: () => true,
    readBody: (request) => request.json(),
  });
  const request = () => new Request("https://example.test/attempts", { method: "POST", body: JSON.stringify(submission) });
  assert.equal((await post(request(), address)).status, 403);
  assert.equal(saved, false);
  role = "MEMBER";
  const response = await post(request(), address);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { result: { score: 1, totalQuestions: 1 } });
  assert.equal(saved, true);
});
