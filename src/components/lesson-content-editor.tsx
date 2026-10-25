"use client";

import { useState, type FormEvent } from "react";
import type { CoursePreviewLesson } from "@/lib/course-preview-core";
import { lessonHasConfiguredContent, updateLessonContentRequest, validateLessonText, validateLessonUrl } from "@/lib/course-builder-ui-core";
import { LessonContentEditorDrawerView } from "@/components/lesson-content-editor-drawer-view";
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

type ContentDraft = {
  serverKey: string;
  text: string;
  url: string;
  savedText: string;
  savedUrl: string;
  configured: boolean;
};

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
  const initialText = lessonText(lesson);
  const initialUrl = lessonUrl(lesson);
  const initialConfigured = lessonHasConfiguredContent(lesson.type, lesson.content);
  const serverKey = JSON.stringify([lesson.id, lesson.type, initialText, initialUrl, initialConfigured]);
  const [draft, setDraft] = useState<ContentDraft>(() => ({
    serverKey,
    text: initialText,
    url: initialUrl,
    savedText: initialText,
    savedUrl: initialUrl,
    configured: initialConfigured,
  }));
  if (draft.serverKey !== serverKey) {
    setDraft({
      serverKey,
      text: initialText,
      url: initialUrl,
      savedText: initialText,
      savedUrl: initialUrl,
      configured: initialConfigured,
    });
  }
  const { text, url, savedText, savedUrl, configured: savedConfigured } = draft;
  const [editing, setEditing] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const dirty = text !== savedText || url !== savedUrl;
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
      if (result?.ok) {
        const savedValue = validated.value ?? "";
        setDraft((current) => ({ ...current, text: savedValue, savedText: savedValue, configured: Boolean(validated.value) }));
        setEditing(false);
      }
      return;
    }
    if (lesson.type === "QUIZ") return;
    const validated = validateLessonUrl(url);
    if (!validated.valid) {
      setFieldError(validated.error);
      return;
    }
    const result = await mutation.run(contentPath, updateLessonContentRequest({ type: lesson.type, url: validated.value.value }));
    if (result?.ok) {
      const savedValue = validated.value.value ?? "";
      setDraft((current) => ({ ...current, url: savedValue, savedUrl: savedValue, configured: Boolean(validated.value.value) }));
      setEditing(false);
    }
  }

  const safeUrl = lesson.type === "TEXT" || lesson.type === "QUIZ" ? null : validateLessonUrl(savedUrl);
  const safeLink = safeUrl?.valid ? safeUrl.value : null;

  return (
    <LessonContentEditorDrawerView
      lessonId={lesson.id}
      type={lesson.type}
      editable={editable}
      editing={editing}
      dirty={dirty}
      configured={savedConfigured}
      text={text}
      url={url}
      savedUrl={safeLink?.href ?? ""}
      summary={lesson.type === "TEXT" ? textSummary(savedText) : null}
      hostname={safeLink?.hostname ?? null}
      resourceUnavailable={lesson.type !== "TEXT" && lesson.type !== "QUIZ" && savedConfigured && safeLink === null}
      pending={mutation.pending}
      errorMessage={fieldError ?? mutation.errorMessage}
      onEdit={() => {
        setDraft((current) => ({ ...current, text: current.savedText, url: current.savedUrl }));
        setFieldError(null);
        mutation.setErrorMessage(null);
        setEditing(true);
      }}
      onClose={() => {
        setEditing(false);
        setDraft((current) => ({ ...current, text: current.savedText, url: current.savedUrl }));
        setFieldError(null);
        mutation.setErrorMessage(null);
      }}
      onSubmit={saveContent}
      onTextChange={(value) => {
        setDraft((current) => ({ ...current, text: value }));
        setFieldError(null);
        mutation.setErrorMessage(null);
      }}
      onUrlChange={(value) => {
        setDraft((current) => ({ ...current, url: value }));
        setFieldError(null);
        mutation.setErrorMessage(null);
      }}
    />
  );
}
