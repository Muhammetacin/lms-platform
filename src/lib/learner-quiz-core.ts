import { isCourseId } from "./course-core.ts";
import type { QuizAddress } from "./quiz-author-core.ts";
import { MAX_QUIZ_OPTIONS, MAX_QUIZ_QUESTIONS, type AuthorQuizQuestion, type QuizQuestion, type QuizResult } from "./quiz-core.ts";
import { TenantContextError, type TenantContext } from "./tenant-context-core.ts";

export type QuizSubmission = { submissionId: string; selections: number[] };
export type LearnerQuiz = { title: string; questions: QuizQuestion[]; latestResult: QuizResult | null };
export type QuizSubmissionResult =
  | { kind: "scored"; result: QuizResult }
  | { kind: "missing" | "invalid" | "conflict" };
type LearnerIdentity = Pick<TenantContext, "organizationId" | "userId">;

export interface LearnerQuizStore {
  get(identity: LearnerIdentity, address: QuizAddress): Promise<LearnerQuiz | null>;
  submit(identity: LearnerIdentity, address: QuizAddress, submission: QuizSubmission): Promise<QuizSubmissionResult>;
}

export function validQuizAddress({ courseId, lessonId }: QuizAddress) {
  return isCourseId(courseId) && isCourseId(lessonId);
}

export function parseQuizSubmission(value: unknown): QuizSubmission | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (Object.keys(value).length !== 2 || !("submissionId" in value) || !("selections" in value)) return null;
  const { submissionId, selections } = value;
  if (!isCourseId(submissionId) || !Array.isArray(selections) || selections.length < 1 || selections.length > MAX_QUIZ_QUESTIONS) return null;
  if (!selections.every((index) => Number.isInteger(index) && index >= 0 && index < MAX_QUIZ_OPTIONS)) return null;
  return { submissionId, selections };
}

export function scoreQuiz(questions: AuthorQuizQuestion[], selections: number[]): QuizResult | null {
  if (questions.length === 0 || selections.length !== questions.length) return null;
  let score = 0;
  for (const [index, question] of questions.entries()) {
    const selection = selections[index];
    if (selection === undefined || !Number.isInteger(selection) || selection < 0 || selection >= question.options.length) {
      return null;
    }
    if (selection === question.correctIndex) score++;
  }
  return { score, totalQuestions: questions.length };
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createLearnerQuizHandler(dependencies: {
  requireTenantContext(): Promise<TenantContext>;
  getStore(): Promise<LearnerQuizStore>;
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
}) {
  return async function POST(request: Request, address: QuizAddress) {
    if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
    try {
      const tenant = await dependencies.requireTenantContext();
      if (tenant.role !== "MEMBER") return json({ error: "forbidden" }, 403);
      if (!validQuizAddress(address)) return json({ error: "quiz_not_found" }, 404);
      const submission = parseQuizSubmission(await dependencies.readBody(request));
      if (!submission) return json({ error: "invalid_quiz_submission" }, 400);
      const result = await (await dependencies.getStore()).submit(tenant, address, submission);
      if (result.kind === "scored") return json({ result: result.result });
      if (result.kind === "missing") return json({ error: "quiz_not_found" }, 404);
      if (result.kind === "conflict") return json({ error: "quiz_submission_conflict" }, 409);
      return json({ error: "invalid_quiz_submission" }, 400);
    } catch (error) {
      if (error instanceof TenantContextError) return json({ error: error.code }, error.status);
      console.error("Learner quiz submission could not be completed.");
      return json({ error: "quiz_unavailable" }, 503);
    }
  };
}
