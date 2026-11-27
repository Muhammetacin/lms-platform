import { AuthorizationError, type OrganizationPermission } from "./authorization-core.ts";
import { isCourseId } from "./course-core.ts";
import { parseQuizDefinition, type AuthorQuizQuestion } from "./quiz-core.ts";
import { TenantContextError, type TenantContext } from "./tenant-context-core.ts";

export type QuizAddress = { courseId: string; lessonId: string };
export type AuthorQuiz = { title: string; editable: boolean; questions: AuthorQuizQuestion[] };

export interface QuizAuthorStore {
  get(organizationId: string, address: QuizAddress): Promise<AuthorQuiz | null>;
  replace(organizationId: string, address: QuizAddress, questions: AuthorQuizQuestion[]): Promise<"saved" | "missing" | "locked">;
}

type AuthorDependencies = {
  requireTenantContext(): Promise<TenantContext>;
  requirePermission(organizationId: string, permission: OrganizationPermission): Promise<unknown>;
  getStore(): Promise<QuizAuthorStore>;
};

function validAddress({ courseId, lessonId }: QuizAddress) {
  return isCourseId(courseId) && isCourseId(lessonId);
}

async function quizOrganization(dependencies: AuthorDependencies) {
  const tenant = await dependencies.requireTenantContext();
  await dependencies.requirePermission(tenant.organizationId, "MANAGE_COURSES");
  return tenant.organizationId;
}

export async function loadAuthorQuiz(dependencies: AuthorDependencies, address: QuizAddress) {
  const organizationId = await quizOrganization(dependencies);
  if (!validAddress(address)) return null;
  return (await dependencies.getStore()).get(organizationId, address);
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createQuizAuthorHandlers(dependencies: AuthorDependencies & {
  isTrustedRequest(request: Request): boolean;
  readBody(request: Request): Promise<unknown>;
}) {
  return {
    async PUT(request: Request, address: QuizAddress) {
      if (!dependencies.isTrustedRequest(request)) return json({ error: "invalid_request" }, 403);
      try {
        const organizationId = await quizOrganization(dependencies);
        if (!validAddress(address)) return json({ error: "quiz_not_found" }, 404);
        const questions = parseQuizDefinition(await dependencies.readBody(request));
        if (!questions) return json({ error: "invalid_quiz" }, 400);
        const result = await (await dependencies.getStore()).replace(organizationId, address, questions);
        if (result === "missing") return json({ error: "quiz_not_found" }, 404);
        if (result === "locked") return json({ error: "published_course_structure_locked" }, 409);
        return json({ success: true });
      } catch (error) {
        if (error instanceof AuthorizationError || error instanceof TenantContextError) {
          return json({ error: error.code }, error.status);
        }
        console.error("Quiz configuration could not be saved.");
        return json({ error: "quiz_unavailable" }, 503);
      }
    },
  };
}
