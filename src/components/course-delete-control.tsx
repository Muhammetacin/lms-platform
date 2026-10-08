"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { courseApiErrorMessage, deleteCourseRequest } from "@/lib/course-management-core";
import { CourseDeleteControlView } from "@/components/course-delete-control-view";

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function CourseDeleteControl({ courseId, allowDelete }: { courseId: string; allowDelete: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pendingRef = useRef(false);

  async function deleteCourse() {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/organizations/courses/${encodeURIComponent(courseId)}`,
        deleteCourseRequest(),
      );
      const body = await responseBody(response);
      if (response.status === 401) {
        router.replace("/login");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setErrorMessage(courseApiErrorMessage(response.status, body, "delete"));
        if (response.status === 404) setConfirming(false);
        if (response.status === 409) router.refresh();
        return;
      }
      router.replace("/admin/courses");
      router.refresh();
    } catch {
      setErrorMessage("The course could not be deleted. Please try again.");
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <CourseDeleteControlView
      allowDelete={allowDelete}
      confirming={confirming}
      pending={pending}
      errorMessage={errorMessage}
      onRequestDelete={() => {
        setErrorMessage(null);
        setConfirming(true);
      }}
      onCancel={() => setConfirming(false)}
      onConfirm={deleteCourse}
    />
  );
}
