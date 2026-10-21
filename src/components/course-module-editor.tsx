"use client";

import { useState, type FormEvent } from "react";
import type { CoursePreviewModule } from "@/lib/course-preview-core";
import {
  createLessonRequest,
  deleteModuleRequest,
  moveModuleRequest,
  updateModuleRequest,
  validateLessonTitle,
  validateLessonType,
  validateModuleDetails,
} from "@/lib/course-builder-ui-core";
import { CourseModuleView } from "@/components/course-module-view";
import { AddLessonFormView } from "@/components/lesson-editor-view";
import { LessonEditor } from "@/components/lesson-editor";
import { useCourseBuilderMutation } from "@/components/use-course-builder-mutation";
import type { LessonTypeValue } from "@/lib/lesson-core";

export function CourseModuleEditor({
  courseId,
  module,
  index,
  moduleCount,
  editable,
}: {
  courseId: string;
  module: CoursePreviewModule;
  index: number;
  moduleCount: number;
  editable: boolean;
}) {
  const moduleMutation = useCourseBuilderMutation("module");
  const lessonMutation = useCourseBuilderMutation("lesson");
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [title, setTitle] = useState(module.title);
  const [description, setDescription] = useState(module.description ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [lessonFormOpen, setLessonFormOpen] = useState(false);
  const [lessonTitle, setLessonTitle] = useState("");
  const [lessonType, setLessonType] = useState<LessonTypeValue>("TEXT");
  const [lessonFieldError, setLessonFieldError] = useState<string | null>(null);

  async function saveModule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    const validated = validateModuleDetails(title, description);
    if (!validated.valid) {
      setFieldError(validated.error);
      return;
    }
    const result = await moduleMutation.run(
      `/api/organizations/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(module.id)}`,
      updateModuleRequest(validated.value),
    );
    if (result?.ok) setEditing(false);
  }

  async function deleteModule() {
    const result = await moduleMutation.run(
      `/api/organizations/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(module.id)}`,
      deleteModuleRequest(),
    );
    if (result?.ok) setConfirmingDelete(false);
  }

  async function moveModule(position: number) {
    await moduleMutation.run(
      `/api/organizations/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(module.id)}/move`,
      moveModuleRequest(position),
    );
  }

  async function addLesson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLessonFieldError(null);
    const validatedTitle = validateLessonTitle(lessonTitle);
    const validatedType = validateLessonType(lessonType);
    if (!validatedTitle.valid) {
      setLessonFieldError(validatedTitle.error);
      return;
    }
    if (!validatedType.valid) {
      setLessonFieldError(validatedType.error);
      return;
    }
    const result = await lessonMutation.run(
      `/api/organizations/courses/${encodeURIComponent(courseId)}/modules/${encodeURIComponent(module.id)}/lessons`,
      createLessonRequest(validatedTitle.value, validatedType.value),
    );
    if (result?.ok) {
      setLessonTitle("");
      setLessonType("TEXT");
      setLessonFormOpen(false);
    }
  }

  return (
    <CourseModuleView
      module={module}
      index={index}
      moduleCount={moduleCount}
      editable={editable}
      editing={editing}
      confirmingDelete={confirmingDelete}
      pending={moduleMutation.pending}
      title={title}
      description={description}
      errorMessage={moduleMutation.errorMessage}
      fieldError={fieldError}
      onEdit={() => {
        setTitle(module.title);
        setDescription(module.description ?? "");
        setFieldError(null);
        setEditing(true);
      }}
      onDelete={() => {
        moduleMutation.setErrorMessage(null);
        setConfirmingDelete(true);
      }}
      onMoveUp={() => void moveModule(module.position - 1)}
      onMoveDown={() => void moveModule(module.position + 1)}
      onCancelEdit={() => {
        setEditing(false);
        setTitle(module.title);
        setDescription(module.description ?? "");
        setFieldError(null);
      }}
      onCancelDelete={() => setConfirmingDelete(false)}
      onConfirmDelete={() => void deleteModule()}
      onSubmit={saveModule}
      onTitleChange={setTitle}
      onDescriptionChange={setDescription}
    >
      {module.lessons.map((lesson, lessonIndex) => (
        <LessonEditor
          key={lesson.id}
          courseId={courseId}
          moduleId={module.id}
          lesson={lesson}
          index={lessonIndex}
          lessonCount={module.lessons.length}
          editable={editable}
        />
      ))}
      {editable ? (
        <AddLessonFormView
          open={lessonFormOpen}
          pending={lessonMutation.pending}
          title={lessonTitle}
          type={lessonType}
          errorMessage={lessonMutation.errorMessage ?? lessonFieldError}
          onOpen={() => {
            lessonMutation.setErrorMessage(null);
            setLessonFieldError(null);
            setLessonFormOpen(true);
          }}
          onCancel={() => {
            setLessonFormOpen(false);
            setLessonTitle("");
            setLessonType("TEXT");
            setLessonFieldError(null);
          }}
          onSubmit={addLesson}
          onTitleChange={(value) => {
            setLessonTitle(value);
            setLessonFieldError(null);
          }}
          onTypeChange={(value) => {
            setLessonType(value);
            setLessonFieldError(null);
          }}
        />
      ) : null}
    </CourseModuleView>
  );
}
