import { isTrustedAuthRequest, readJsonBody } from "@/lib/auth-core";
import { createLearnerQuizHandler } from "@/lib/learner-quiz-core";
import { getLearnerQuizStore } from "@/lib/learner-quiz-server";
import type { QuizAddress } from "@/lib/quiz-author-core";
import { requireTenantContext } from "@/lib/tenant-context";

const submit = createLearnerQuizHandler({
  requireTenantContext,
  getStore: getLearnerQuizStore,
  isTrustedRequest: isTrustedAuthRequest,
  readBody: (request) => readJsonBody(request, 4096),
});

export async function POST(request: Request, { params }: { params: Promise<QuizAddress> }) {
  return submit(request, await params);
}
