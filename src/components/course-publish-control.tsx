"use client";

import { useState } from "react";
import type { CourseBuilderData } from "@/lib/course-builder-core";
import { knownBuilderError, mapPublishIssues, publishCourseRequest } from "@/lib/course-builder-ui-core";
import { CoursePublishControlView } from "@/components/course-publish-control-view";
import { useCourseBuilderMutation } from "@/components/use-course-builder-mutation";

export function CoursePublishControl({ builder }: { builder: CourseBuilderData }) {
  const mutation = useCourseBuilderMutation("publish");
  const [confirming, setConfirming] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);

  async function publish() {
    setIssues([]);
    setTruncated(false);
    const result = await mutation.run(
      `/api/organizations/courses/${encodeURIComponent(builder.courseId)}/publish`,
      publishCourseRequest(),
    );
    if (result?.ok) {
      setConfirming(false);
      return;
    }
    if (result?.status === 409 && knownBuilderError(result.body) === "course_not_publishable") {
      const mapped = mapPublishIssues(result.body, builder);
      setIssues(mapped.messages);
      setTruncated(mapped.truncated);
    }
  }

  return (
    <CoursePublishControlView
      published={builder.status === "PUBLISHED"}
      confirming={confirming}
      pending={mutation.pending}
      errorMessage={mutation.errorMessage}
      issues={issues}
      truncated={truncated}
      onRequestPublish={() => {
        mutation.setErrorMessage(null);
        setIssues([]);
        setTruncated(false);
        setConfirming(true);
      }}
      onCancel={() => setConfirming(false)}
      onConfirm={() => void publish()}
    />
  );
}
