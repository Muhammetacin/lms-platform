import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { createQuizAuthorHandlers, type QuizAddress } from "@/lib/quiz-author-core";
import { quizAuthorDependencies } from "@/lib/quiz-author-server";

const handlers = createQuizAuthorHandlers({
  ...quizAuthorDependencies,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: (request) => readJsonBody(request, 128 * 1024),
});

export async function PUT(request: Request, { params }: { params: Promise<QuizAddress> }) {
  return handlers.PUT(request, await params);
}
