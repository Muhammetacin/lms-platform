export const MAX_QUIZ_QUESTIONS = 20;
export const MAX_QUIZ_OPTIONS = 6;
export const MAX_QUIZ_PROMPT_LENGTH = 300;
export const MAX_QUIZ_OPTION_LENGTH = 180;

export type QuizQuestion = { prompt: string; options: string[] };
export type AuthorQuizQuestion = QuizQuestion & { correctIndex: number };
export type QuizResult = { score: number; totalQuestions: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function quizText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && [...text].length <= max && !/[\u0000-\u001f\u007f-\u009f\p{Cs}]/u.test(text)
    ? text
    : null;
}

export function parseQuizDefinition(input: unknown): AuthorQuizQuestion[] | null {
  if (!isRecord(input) || Object.keys(input).length !== 1 || !Array.isArray(input.questions)) return null;
  if (input.questions.length === 0 || input.questions.length > MAX_QUIZ_QUESTIONS) return null;

  const questions: AuthorQuizQuestion[] = [];
  for (const question of input.questions) {
    if (!isRecord(question) || Object.keys(question).length !== 3 || !Array.isArray(question.options)) return null;
    const prompt = quizText(question.prompt, MAX_QUIZ_PROMPT_LENGTH);
    if (!prompt || question.options.length < 2 || question.options.length > MAX_QUIZ_OPTIONS) return null;
    const options: string[] = [];
    for (const inputOption of question.options) {
      const option = quizText(inputOption, MAX_QUIZ_OPTION_LENGTH);
      if (!option || options.includes(option)) return null;
      options.push(option);
    }
    const { correctIndex } = question;
    if (typeof correctIndex !== "number" || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return null;
    }
    questions.push({ prompt, options, correctIndex });
  }
  return questions;
}
