"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { announceCourseBuilderToast } from "@/components/course-builder-toast-region";
import {
  builderApiErrorMessage,
  knownBuilderError,
  type BuilderErrorAction,
  type JsonRequestOptions,
} from "@/lib/course-builder-ui-core";

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function useCourseBuilderMutation(action: BuilderErrorAction) {
  const router = useRouter();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function run(path: string, request: JsonRequestOptions): Promise<{
    ok: boolean;
    status: number;
    body: unknown;
  } | null> {
    if (pendingRef.current) return null;
    pendingRef.current = true;
    setPending(true);
    setErrorMessage(null);
    try {
      const response = await fetch(path, request);
      const body = await responseBody(response);
      if (response.status === 401) {
        router.replace("/login");
        router.refresh();
        return { ok: false, status: response.status, body };
      }
      if (!response.ok) {
        const code = knownBuilderError(body);
        setErrorMessage(builderApiErrorMessage(response.status, body, action));
        if (response.status === 404 && code === "course_not_found") {
          router.replace("/admin/courses");
          router.refresh();
        } else if (response.status === 404 || response.status === 409) {
          router.refresh();
        }
        return { ok: false, status: response.status, body };
      }
      if (action === "module" || action === "lesson" || action === "content") {
        announceCourseBuilderToast({
          title: action === "content"
            ? "Lesinhoud opgeslagen"
            : action === "module"
              ? "Module changes saved"
              : "Lesson changes saved",
          message: "Your changes have been saved successfully.",
        });
      }
      router.refresh();
      return { ok: true, status: response.status, body };
    } catch {
      setErrorMessage(builderApiErrorMessage(0, null, action));
      return { ok: false, status: 0, body: null };
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return { pending, errorMessage, setErrorMessage, run };
}
