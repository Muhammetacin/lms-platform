"use client";

import { useState, type FormEvent } from "react";
import type { CourseBuilderData } from "@/lib/course-builder-core";
import { createModuleRequest, validateModuleDetails } from "@/lib/course-builder-ui-core";
import { AddModuleFormView } from "@/components/course-module-view";
import { CourseBuilderView } from "@/components/course-builder-view";
import { CourseModuleEditor } from "@/components/course-module-editor";
import { CoursePublishControl } from "@/components/course-publish-control";
import { useCourseBuilderMutation } from "@/components/use-course-builder-mutation";

export function CourseBuilder({ builder }: { builder: CourseBuilderData }) {
  const editable = builder.status === "DRAFT";
  const mutation = useCourseBuilderMutation("module");
  const [addModuleOpen, setAddModuleOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  async function addModule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError(null);
    const validated = validateModuleDetails(title, description);
    if (!validated.valid) {
      setFieldError(validated.error);
      return;
    }
    const result = await mutation.run(
      `/api/organizations/courses/${encodeURIComponent(builder.courseId)}/modules`,
      createModuleRequest(validated.value),
    );
    if (result?.ok) {
      setTitle("");
      setDescription("");
      setAddModuleOpen(false);
    }
  }

  function cancelAddModule() {
    setAddModuleOpen(false);
    setTitle("");
    setDescription("");
    setFieldError(null);
    mutation.setErrorMessage(null);
  }

  return (
    <CourseBuilderView builder={builder}>
      {builder.modules.length === 0
        ? <div className="builder-empty-state">
            <h3>No modules yet.</h3>
            <p>Add your first module to start building this course.</p>
          </div>
        : <div className="course-module-list">
            {builder.modules.map((module, index) => (
              <CourseModuleEditor
                key={module.id}
                courseId={builder.courseId}
                module={module}
                index={index}
                moduleCount={builder.modules.length}
                editable={editable}
              />
            ))}
          </div>}
      {editable ? (
        <div className="course-builder-actions">
          <AddModuleFormView
            open={addModuleOpen}
            pending={mutation.pending}
            title={title}
            description={description}
            errorMessage={fieldError ?? mutation.errorMessage}
            onOpen={() => {
              setFieldError(null);
              mutation.setErrorMessage(null);
              setAddModuleOpen(true);
            }}
            onCancel={cancelAddModule}
            onSubmit={addModule}
            onTitleChange={(value) => {
              setTitle(value);
              setFieldError(null);
            }}
            onDescriptionChange={(value) => {
              setDescription(value);
              setFieldError(null);
            }}
          />
        </div>
      ) : null}
      <CoursePublishControl builder={builder} />
    </CourseBuilderView>
  );
}
