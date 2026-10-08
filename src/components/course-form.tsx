"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { courseApiErrorMessage, createCourseRequest, updateCourseRequest, validateCourseDetails } from "@/lib/course-management-core";
import { isCourseId } from "@/lib/course-core";
import { CourseFormView } from "@/components/course-form-view";

type CourseFormProps = {
  mode: "create" | "edit";
  courseId?: string;
  initialTitle?: string;
  initialDescription?: string | null;
};

function courseIdFromBody(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const course = (body as Record<string, unknown>).course;
  if (typeof course !== "object" || course === null || Array.isArray(course)) return null;
  const id = (course as Record<string, unknown>).id;
  return isCourseId(id) ? id : null;
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function CourseForm({
  mode,
  courseId,
  initialTitle = "",
  initialDescription = "",
}: CourseFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [pending, setPending] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current) return;

    setErrorMessage(null);
    setSuccessMessage(null);
    const validation = validateCourseDetails(title, description);
    if (!validation.valid) {
      setTitleError(validation.errors.title ?? null);
      setDescriptionError(validation.errors.description ?? null);
      return;
    }
    setTitleError(null);
    setDescriptionError(null);
    if (mode === "edit" && !courseId) {
      setErrorMessage("This course is no longer available. Return to Courses.");
      return;
    }

    pendingRef.current = true;
    setPending(true);
    try {
      const path = mode === "create"
        ? "/api/organizations/courses"
        : `/api/organizations/courses/${encodeURIComponent(courseId!)}`;
      const request = mode === "create"
        ? createCourseRequest(validation.value)
        : updateCourseRequest(validation.value);
      const response = await fetch(path, request);
      const body = await responseBody(response);

      if (response.status === 401) {
        router.replace("/login");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setErrorMessage(courseApiErrorMessage(response.status, body, mode === "create" ? "create" : "update"));
        return;
      }

      if (mode === "create") {
        const createdId = courseIdFromBody(body);
        if (!createdId) {
          setErrorMessage("The course was created, but its details could not be opened. Return to Courses.");
          router.refresh();
          return;
        }
        router.push(`/admin/courses/${encodeURIComponent(createdId)}`);
        router.refresh();
        return;
      }

      setSuccessMessage("Changes saved.");
      router.refresh();
    } catch {
      setErrorMessage("Course management is temporarily unavailable.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <CourseFormView
      mode={mode}
      title={title}
      description={description}
      pending={pending}
      titleError={titleError}
      descriptionError={descriptionError}
      errorMessage={errorMessage}
      successMessage={successMessage}
      onSubmit={handleSubmit}
      onTitleChange={setTitle}
      onDescriptionChange={setDescription}
    />
  );
}
