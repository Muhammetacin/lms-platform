import { createElement as h, type ReactNode } from "react";
import type { CoursePreview, CoursePreviewLesson } from "../lib/course-preview-core.ts";
import { parseLessonUrl } from "../lib/lesson-core.ts";

function lessonContent(lesson: CoursePreviewLesson, dutch: boolean, quizCourseId?: string): ReactNode {
  if (lesson.type === "TEXT") {
    const text = lesson.content !== null && "text" in lesson.content
      ? lesson.content.text
      : null;
    return text === null || text.trim().length === 0
      ? h("p", { className: "preview-placeholder" }, dutch ? "Geen lesinhoud beschikbaar" : "Content not configured")
      : h("p", { className: "preview-text" }, text);
  }

  if (lesson.type === "QUIZ") {
    if (lesson.quizConfigured && quizCourseId) {
      return h("a", {
        className: "preview-resource-link",
        href: `/learn/courses/${encodeURIComponent(quizCourseId)}/quizzes/${encodeURIComponent(lesson.id)}`,
      }, "Quiz maken");
    }
    if (lesson.quizConfigured) return h("p", { className: "preview-placeholder" }, "Quiz configured.");
    return h("p", { className: "preview-placeholder" }, dutch ? "Deze toets is nog niet beschikbaar." : "Quiz configuration is not available yet.");
  }

  const url = lesson.content !== null && "url" in lesson.content
    ? lesson.content.url
    : null;
  if (url === null || url.trim().length === 0) {
    return h("p", { className: "preview-placeholder" }, dutch ? "Geen bron beschikbaar" : "Resource not configured");
  }
  const parsed = parseLessonUrl(url);
  if (!parsed.valid || parsed.value === null) {
    return h("p", { className: "preview-placeholder" }, dutch ? "Bron niet beschikbaar" : "Resource unavailable");
  }

  const hostname = new URL(parsed.value).hostname;
  return h("div", { className: "preview-resource" },
    h("p", { className: "preview-resource-host" }, hostname),
    h("a", {
      href: parsed.value,
      target: "_blank",
      rel: "noopener noreferrer",
      referrerPolicy: "no-referrer",
      className: "preview-resource-link",
    }, dutch ? "Open bron ↗" : `Open ${lesson.type.toLowerCase()} resource ↗`),
  );
}

export function CoursePreviewUnavailable() {
  return h("main", { className: "preview-shell" },
    h("section", { className: "preview-unavailable", "aria-labelledby": "preview-unavailable-title" },
      h("p", { className: "preview-eyebrow" }, "Course preview"),
      h("h1", { id: "preview-unavailable-title" }, "Preview unavailable"),
      h("p", null, "This preview is not available for your account."),
    ),
  );
}

export function CoursePreviewView({ course }: { course: CoursePreview }) {
  const isDraft = course.status === "DRAFT";
  const publishedDate = course.publishedAt === null ? null : new Date(course.publishedAt);

  return h("main", { className: "preview-shell" },
    h("a", {
      className: "preview-back-link",
      href: `/admin/courses/${encodeURIComponent(course.id)}`,
    }, "← Back to Course Builder"),
    h("header", { className: "preview-header" },
      h("div", { className: "preview-course-copy" },
        h("p", { className: "preview-eyebrow" }, "Course preview"),
        h("h1", null, course.title),
        course.description === null ? null : h("p", { className: "preview-description" }, course.description),
      ),
      h("div", { className: "preview-state" },
        h("span", { className: `preview-status ${isDraft ? "is-draft" : "is-published"}` },
          isDraft ? "Draft preview" : "Published"),
        isDraft
          ? h("p", { className: "preview-draft-notice" }, "This course is not published yet.")
          : publishedDate === null
            ? null
            : h("p", { className: "preview-published-at" },
                "Published ",
                h("time", { dateTime: publishedDate.toISOString() },
                  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(publishedDate),
                ),
              ),
      ),
    ),
    h(CourseContentView, { modules: course.modules }),
  );
}

const learnerLessonTypes: Record<CoursePreviewLesson["type"], string> = {
  TEXT: "Tekst",
  VIDEO: "Video",
  PDF: "PDF",
  IMAGE: "Afbeelding",
  LINK: "Link",
  QUIZ: "Toets",
};

export function CourseContentView({
  modules,
  language = "en",
  quizCourseId,
  renderLessonProgress,
}: {
  modules: CoursePreview["modules"];
  language?: "en" | "nl";
  quizCourseId?: string;
  renderLessonProgress?: (lesson: CoursePreviewLesson) => ReactNode;
}) {
  const dutch = language === "nl";
  return h("section", { className: "preview-content", "aria-labelledby": "preview-content-title" },
    h("h2", { id: "preview-content-title" }, dutch ? "Cursusinhoud" : "Course contents"),
    modules.length === 0
      ? h("p", { className: "preview-placeholder preview-empty-course" }, dutch ? "Deze cursus heeft nog geen modules." : "No modules have been added yet.")
      : h("ol", { className: "preview-module-list" }, modules.map((courseModule, moduleIndex) =>
          h("li", { key: courseModule.id },
            h("section", { className: "preview-module", "aria-labelledby": `preview-module-${courseModule.id}` },
              h("h3", { id: `preview-module-${courseModule.id}` },
                h("span", { className: "preview-index" }, `Module ${moduleIndex + 1}`),
                courseModule.title,
              ),
              courseModule.description === null ? null : h("p", { className: "preview-module-description" }, courseModule.description),
              courseModule.lessons.length === 0
                ? h("p", { className: "preview-placeholder" }, dutch ? "Deze module heeft nog geen lessen." : "No lessons have been added to this module yet.")
                : h("ol", { className: "preview-lesson-list" }, courseModule.lessons.map((lesson, lessonIndex) =>
                    h("li", { key: lesson.id },
                      h("article", { className: "preview-lesson" },
                        h("div", { className: "preview-lesson-heading" },
                          h("h4", null, lesson.title),
                          h("span", { className: "preview-type" }, dutch ? learnerLessonTypes[lesson.type] : lesson.type),
                        ),
                        h("p", { className: "preview-lesson-index" }, `${dutch ? "Les" : "Lesson"} ${lessonIndex + 1}`),
                        lessonContent(lesson, dutch, quizCourseId),
                        renderLessonProgress?.(lesson),
                      ),
                    ),
                  )),
            ),
          ),
        )),
  );
}
