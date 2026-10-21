"use client";

import { useState, type FormEvent } from "react";
import type { CoursePreviewLesson } from "@/lib/course-preview-core";
import {
  cancelLessonTypeChange,
  deleteLessonRequest,
  lessonHasConfiguredContent,
  moveLessonRequest,
  saveLessonWithTypeChangeConfirmation,
  updateLessonRequest,
  validateLessonTitle,
  validateLessonType,
} from "@/lib/course-builder-ui-core";
import type { LessonTypeValue } from "@/lib/lesson-core";
import { LessonEditorView } from "@/components/lesson-editor-view";
import { LessonContentEditor } from "@/components/lesson-content-editor";
import { useCourseBuilderMutation } from "@/components/use-course-builder-mutation";

export function LessonEditor({
  courseId,
  moduleId,
  lesson,
  index,
  lessonCount,
  editable,
}: {
  courseId: string;
  moduleId: string;
  lesson: CoursePreviewLesson;
  index: number;
  lessonCount: number;
  editable: boolean;
}) {
  const mutation = useCourseBuilderMutation("lesson");
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [title, setTitle] = useState(lesson.title);
  const [type, setType] = useState<LessonTypeValue>(lesson.type);
  const [proposedType, setProposedType] = useState<LessonTypeValue | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const lessonPath = `/api/organizations/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(moduleId)}/lessons/${encodeURIComponent(lesson.id)}`;

  async function saveLesson(event?: FormEvent<HTMLFormElement>, confirmedType?: LessonTypeValue) {
    event?.preventDefault();
    setFieldError(null);
    const validatedTitle = validateLessonTitle(title);
    const validatedType = validateLessonType(confirmedType ?? type);
    if (!validatedTitle.valid) {
      setFieldError(validatedTitle.error);
      return;
    }
    if (!validatedType.valid) {
      setFieldError(validatedType.error);
      return;
    }
    const typeChange = await saveLessonWithTypeChangeConfirmation({
      currentType: lesson.type,
      nextType: validatedType.value,
      hasConfiguredContent: lessonHasConfiguredContent(lesson.type, lesson.content),
      confirmedType: confirmedType ?? null,
      save: () => mutation.run(lessonPath, updateLessonRequest({ title: validatedTitle.value, type: validatedType.value })),
    });
    if (typeChange.kind === "confirmation-required") {
      setProposedType(typeChange.proposedType);
      return;
    }
    const result = typeChange.result;
    if (result?.ok) {
      setEditing(false);
      setProposedType(null);
    }
  }

  async function deleteLesson() {
    const result = await mutation.run(lessonPath, deleteLessonRequest());
    if (result?.ok) setConfirmingDelete(false);
  }

  async function moveLesson(position: number) {
    await mutation.run(`${lessonPath}/move`, moveLessonRequest(position));
  }

  function beginEdit() {
    setTitle(lesson.title);
    setType(lesson.type);
    setFieldError(null);
    setProposedType(null);
    mutation.setErrorMessage(null);
    setEditing(true);
  }

  return (
    <LessonEditorView
      lesson={lesson}
      index={index}
      lessonCount={lessonCount}
      editable={editable}
      editing={editing}
      confirmingDelete={confirmingDelete}
      proposedType={proposedType}
      pending={mutation.pending}
      title={title}
      type={type}
      errorMessage={mutation.errorMessage}
      fieldError={fieldError}
      onEdit={beginEdit}
      onDelete={() => {
        mutation.setErrorMessage(null);
        setConfirmingDelete(true);
      }}
      onMoveUp={() => void moveLesson(lesson.position - 1)}
      onMoveDown={() => void moveLesson(lesson.position + 1)}
      onCancelEdit={() => {
        setEditing(false);
        setTitle(lesson.title);
        setType(lesson.type);
        setProposedType(null);
        setFieldError(null);
      }}
      onCancelDelete={() => setConfirmingDelete(false)}
      onConfirmDelete={() => void deleteLesson()}
      onConfirmTypeChange={() => {
        if (proposedType) void saveLesson(undefined, proposedType);
      }}
      onCancelTypeChange={() => {
        const cancelledType = cancelLessonTypeChange(lesson.type);
        setType(cancelledType.type);
        setProposedType(cancelledType.proposedType);
      }}
      onSubmit={saveLesson}
      onTitleChange={(value) => {
        setTitle(value);
        setFieldError(null);
      }}
      onTypeChange={(value) => {
        setType(value);
        setFieldError(null);
        setProposedType(null);
      }}
    >
      <LessonContentEditor
        key={`${lesson.id}:${lesson.type}:${lesson.content && "text" in lesson.content ? lesson.content.text ?? "" : lesson.content && "url" in lesson.content ? lesson.content.url ?? "" : ""}`}
        courseId={courseId}
        moduleId={moduleId}
        lesson={lesson}
        editable={editable}
      />
    </LessonEditorView>
  );
}
