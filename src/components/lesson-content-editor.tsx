"use client";

import { useState, type FormEvent } from "react";
import type { CoursePreviewLesson } from "@/lib/course-preview-core";
import { lessonHasConfiguredContent, updateLessonContentRequest, validateLessonText, validateLessonUrl } from "@/lib/course-builder-ui-core";
import { LessonContentEditorView } from "@/components/lesson-content-editor-view";
import { useCourseBuilderMutation } from "@/components/use-course-builder-mutation";

function lessonText(lesson: CoursePreviewLesson): string {
  return lesson.content && "text" in lesson.content ? lesson.content.text ?? "" : "";
}

function lessonUrl(lesson: CoursePreviewLesson): string {
  return lesson.content && "url" in lesson.content ? lesson.content.url ?? "" : "";
}

function textSummary(text: string): string | null {
  if (!text) return null;
  const characters = [...text];
  return characters.length > 240 ? `${characters.slice(0, 240).join("")}…` : text;
}

export function LessonContentEditor({
  courseId,
  moduleId,
  lesson,
  editable,
}: {
  courseId: string;
  moduleId: string;
  lesson: CoursePreviewLesson;
  editable: boolean;
}) {
  const mutation = useCourseBuilderMutation("content");
  const [text, setText] = useState(lessonText(lesson));
  const [url, setUrl] = useState(lessonUrl(lesson));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const configured = lessonHasConfiguredContent(lesson.type, lesson.content);
  const contentPath = `/api/organizations/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleId)}/lessons/${encodeURIComponent(lesson.id)}/content`;

  async function saveContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    if (lesson.type === "TEXT") {
      const validated = validateLessonText(text);
      if (!validated.valid) {
        setFieldError(validated.error);
        return;
      }
      const result = await mutation.run(contentPath, updateLessonContentRequest({ type: "TEXT", text: validated.value }));
      if (result?.ok) mutation.setSuccessMessage("Content saved.");
      return;
    }
    if (lesson.type === "QUIZ") return;
    const validated = validateLessonUrl(url);
    if (!validated.valid) {
      setFieldError(validated.error);
      return;
    }
    const result = await mutation.run(contentPath, updateLessonContentRequest({ type: lesson.type, url: validated.value.value }));
    if (result?.ok) mutation.setSuccessMessage("Content saved.");
  }

  const safeUrl = lesson.type === "TEXT" || lesson.type === "QUIZ" ? null : validateLessonUrl(lessonUrl(lesson));
  const safeLink = safeUrl?.valid ? safeUrl.value : null;

  return (
    <LessonContentEditorView
      lessonId={lesson.id}
      type={lesson.type}
      editable={editable}
      configured={configured}
      text={text}
      url={editable ? url : safeLink?.href ?? ""}
      summary={lesson.type === "TEXT" ? textSummary(lessonText(lesson)) : null}
      hostname={safeLink?.hostname ?? null}
      resourceUnavailable={lesson.type !== "TEXT" && lesson.type !== "QUIZ" && configured && safeLink === null}
      pending={mutation.pending}
      errorMessage={fieldError ?? mutation.errorMessage}
      successMessage={mutation.successMessage}
      onSubmit={saveContent}
      onTextChange={(value) => {
        setText(value);
        setFieldError(null);
        mutation.setErrorMessage(null);
        mutation.setSuccessMessage(null);
      }}
      onUrlChange={(value) => {
        setUrl(value);
        setFieldError(null);
        mutation.setErrorMessage(null);
        mutation.setSuccessMessage(null);
      }}
    />
  );
}
