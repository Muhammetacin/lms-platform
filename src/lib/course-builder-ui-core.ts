import { lessonTypes, type LessonTypeValue } from "./lesson-core.ts";
import type { CourseBuilderData } from "./course-builder-core.ts";

const invalidTitleCharacters = /[\u0000-\u001f\u007f-\u009f\p{Cs}]/u;
const invalidTextCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\p{Cs}]/u;

export const lessonTypeLabels: Record<LessonTypeValue, string> = {
  TEXT: "Text",
  VIDEO: "Video",
  PDF: "PDF",
  IMAGE: "Image",
  LINK: "Link",
  QUIZ: "Quiz",
};

export function isLessonType(value: unknown): value is LessonTypeValue {
  return typeof value === "string" && (lessonTypes as readonly string[]).includes(value);
}

export type ModuleDetails = { title: string; description: string | null };
export type Validated<T> = { valid: true; value: T } | { valid: false; error: string };

export function validateModuleDetails(title: string, description: string): Validated<ModuleDetails> {
  const normalizedTitle = title.trim();
  const normalizedDescription = description.trim();
  if (invalidTitleCharacters.test(title) || [...normalizedTitle].length < 2) {
    return { valid: false, error: "Enter a module title with at least 2 characters." };
  }
  if ([...normalizedTitle].length > 160) {
    return { valid: false, error: "Module titles can be up to 160 characters." };
  }
  if (invalidTitleCharacters.test(description)) {
    return { valid: false, error: "Remove unsupported characters from the description." };
  }
  if ([...normalizedDescription].length > 4000) {
    return { valid: false, error: "Descriptions can be up to 4,000 characters." };
  }
  return {
    valid: true,
    value: { title: normalizedTitle, description: normalizedDescription || null },
  };
}

export function validateLessonTitle(title: string): Validated<string> {
  const normalized = title.trim();
  if (invalidTitleCharacters.test(title) || [...normalized].length < 2) {
    return { valid: false, error: "Enter a lesson title with at least 2 characters." };
  }
  if ([...normalized].length > 160) {
    return { valid: false, error: "Lesson titles can be up to 160 characters." };
  }
  return { valid: true, value: normalized };
}

export function validateLessonType(value: unknown): Validated<LessonTypeValue> {
  return isLessonType(value)
    ? { valid: true, value }
    : { valid: false, error: "Choose a valid lesson type." };
}

export function validateLessonText(value: string): Validated<string | null> {
  if (invalidTextCharacters.test(value)) {
    return { valid: false, error: "Remove unsupported control characters from the lesson content." };
  }
  const normalized = value.replace(/\r\n?/g, "\n");
  if ([...normalized].length > 100_000) {
    return { valid: false, error: "Lesson content can be up to 100,000 characters." };
  }
  return { valid: true, value: normalized.trim().length === 0 ? null : normalized };
}

export type ValidatedUrl = { value: string | null; href: string | null; hostname: string | null };

export function validateLessonUrl(value: string): Validated<ValidatedUrl> {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return { valid: true, value: { value: null, href: null, hostname: null } };
  }
  if ([...normalized].length > 2048 || invalidTitleCharacters.test(normalized)) {
    return { valid: false, error: "Enter a valid HTTPS URL under 2,048 characters." };
  }
  try {
    const url = new URL(normalized);
    const authority = normalized.slice(normalized.indexOf(":") + 1).replace(/^\/\//, "").split(/[/?#]/, 1)[0] ?? "";
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || authority.includes("@")) {
      return { valid: false, error: "Enter an HTTPS URL without a username or password." };
    }
    return {
      valid: true,
      value: { value: url.href, href: url.href, hostname: url.hostname },
    };
  } catch {
    return { valid: false, error: "Enter a valid HTTPS URL." };
  }
}

export type JsonRequestOptions = {
  method: "POST" | "PATCH" | "DELETE" | "PUT";
  credentials: "same-origin";
  headers: { "Content-Type": "application/json" };
  body: string;
};

function jsonRequest(method: JsonRequestOptions["method"], value: unknown): JsonRequestOptions {
  return {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  };
}

export function createModuleRequest(value: ModuleDetails): JsonRequestOptions {
  return jsonRequest("POST", { title: value.title, description: value.description });
}

export function updateModuleRequest(value: Partial<ModuleDetails>): JsonRequestOptions {
  const body: Partial<ModuleDetails> = {};
  if (Object.hasOwn(value, "title")) body.title = value.title;
  if (Object.hasOwn(value, "description")) body.description = value.description;
  return jsonRequest("PATCH", body);
}

export function moveModuleRequest(position: number): JsonRequestOptions {
  return jsonRequest("POST", { position });
}

export function deleteModuleRequest(): JsonRequestOptions {
  return jsonRequest("DELETE", {});
}

export function createLessonRequest(title: string, type: LessonTypeValue): JsonRequestOptions {
  return jsonRequest("POST", { title, type });
}

export function updateLessonRequest(value: { title?: string; type?: LessonTypeValue }): JsonRequestOptions {
  const body: { title?: string; type?: LessonTypeValue } = {};
  if (Object.hasOwn(value, "title")) body.title = value.title;
  if (Object.hasOwn(value, "type")) body.type = value.type;
  return jsonRequest("PATCH", body);
}

export type LessonTypeChangeSaveResult<T> =
  | { kind: "confirmation-required"; proposedType: LessonTypeValue }
  | { kind: "saved"; result: T };

export async function saveLessonWithTypeChangeConfirmation<T>({
  currentType,
  nextType,
  hasConfiguredContent,
  confirmedType,
  save,
}: {
  currentType: LessonTypeValue;
  nextType: LessonTypeValue;
  hasConfiguredContent: boolean;
  confirmedType: LessonTypeValue | null;
  save: () => Promise<T>;
}): Promise<LessonTypeChangeSaveResult<T>> {
  if (hasConfiguredContent && nextType !== currentType && confirmedType !== nextType) {
    return { kind: "confirmation-required", proposedType: nextType };
  }
  return { kind: "saved", result: await save() };
}

export function cancelLessonTypeChange(currentType: LessonTypeValue) {
  return { type: currentType, proposedType: null } as const;
}

export function moveLessonRequest(position: number): JsonRequestOptions {
  return jsonRequest("POST", { position });
}

export function deleteLessonRequest(): JsonRequestOptions {
  return jsonRequest("DELETE", {});
}

export function updateLessonContentRequest(
  value: { type: "TEXT"; text: string | null } | { type: "VIDEO" | "PDF" | "IMAGE" | "LINK"; url: string | null },
): JsonRequestOptions {
  return jsonRequest("PUT", value.type === "TEXT" ? { text: value.text } : { url: value.url });
}

export function publishCourseRequest(): JsonRequestOptions {
  return jsonRequest("POST", {});
}

export type BuilderErrorAction = "module" | "lesson" | "content" | "publish";

const knownErrorCodes = new Set([
  "invalid_request",
  "course_not_found",
  "module_not_found",
  "lesson_not_found",
  "published_course_structure_locked",
  "course_module_management_unavailable",
  "quiz_content_not_available",
  "lesson_builder_unavailable",
  "course_not_publishable",
  "course_publishing_unavailable",
  "unauthenticated",
  "forbidden",
  "authorization_unavailable",
]);

export function knownBuilderError(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const code = (body as Record<string, unknown>).error;
  return typeof code === "string" && knownErrorCodes.has(code) ? code : null;
}

export function builderApiErrorMessage(status: number, body: unknown, action: BuilderErrorAction): string {
  const code = knownBuilderError(body);
  if (status === 400 && code === "invalid_request") return "Check the course content and try again.";
  if (status === 401 || code === "unauthenticated") return "Your session has ended. Sign in to continue.";
  if (status === 403 && code === "forbidden") return "You no longer have permission to manage this course.";
  if (status === 404 && code && ["course_not_found", "module_not_found", "lesson_not_found"].includes(code)) {
    return "This course content is no longer available. The page has been refreshed.";
  }
  if (status === 409 && code === "published_course_structure_locked") {
    return "This course has been published. Its structure can no longer be changed.";
  }
  if (status === 409 && code === "quiz_content_not_available") {
    return "Quiz configuration is not available yet.";
  }
  if (status === 409 && code === "course_not_publishable") {
    return "Resolve the publishing issues below before publishing this course.";
  }
  if (status === 503 && code && [
    "course_module_management_unavailable",
    "lesson_builder_unavailable",
    "course_publishing_unavailable",
    "authorization_unavailable",
  ].includes(code)) {
    return action === "publish" ? "Publishing is temporarily unavailable." : "Course content is temporarily unavailable.";
  }
  if (action === "publish") return "The course could not be published. Please try again.";
  if (action === "module") return "The module could not be saved. Please try again.";
  if (action === "lesson") return "The lesson could not be saved. Please try again.";
  return "Lesson content could not be saved. Please try again.";
}

export type PublishIssueMessages = { messages: string[]; truncated: boolean };

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function mapPublishIssues(body: unknown, builder: CourseBuilderData): PublishIssueMessages {
  const response = recordValue(body);
  if (!response || response.error !== "course_not_publishable" || !Array.isArray(response.issues)) {
    return { messages: ["The course still contains content that prevents publishing."], truncated: false };
  }

  const moduleTitles = new Map(builder.modules.map((module) => [module.id, module.title]));
  const lessonTitles = new Map(builder.modules.flatMap((module) => module.lessons.map((lesson) => [lesson.id, lesson.title] as const)));
  const generic = "The course still contains content that prevents publishing.";
  const messages = response.issues.map((unknownIssue) => {
    const issue = recordValue(unknownIssue);
    if (!issue || typeof issue.code !== "string") return generic;
    if (issue.code === "course_requires_module") return "Add at least one module.";
    if (issue.code === "module_order_invalid") return "Module ordering is invalid. Reorder the course modules.";
    if (issue.code === "module_requires_lesson" && typeof issue.moduleId === "string") {
      const title = moduleTitles.get(issue.moduleId);
      return title ? `Add at least one lesson to “${title}”.` : generic;
    }
    if (issue.code === "lesson_order_invalid" && typeof issue.moduleId === "string") {
      const title = moduleTitles.get(issue.moduleId);
      return title ? `Lesson ordering is invalid in “${title}”.` : generic;
    }
    if (issue.code === "lesson_content_missing" && typeof issue.lessonId === "string") {
      const title = lessonTitles.get(issue.lessonId);
      return title ? `Add content to “${title}”.` : generic;
    }
    if (issue.code === "quiz_not_configured" && typeof issue.lessonId === "string") {
      const title = lessonTitles.get(issue.lessonId);
      return title
        ? `Configure or remove quiz lesson “${title}”. Quiz configuration is not available yet.`
        : generic;
    }
    return generic;
  });

  return {
    messages: messages.length > 0 ? messages : [generic],
    truncated: response.truncated === true,
  };
}

export function lessonHasConfiguredContent(
  type: LessonTypeValue,
  content: { text: string | null } | { url: string | null } | null,
): boolean {
  if (type === "QUIZ" || content === null) return false;
  return type === "TEXT" ? Boolean("text" in content && content.text?.trim()) : Boolean("url" in content && content.url?.trim());
}
