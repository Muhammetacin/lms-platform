"use client";

import { createElement as h, useEffect, useState } from "react";

type ToastDetail = { title: string; message: string };

export function announceCourseBuilderToast(detail: ToastDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ToastDetail>("course-builder:toast", { detail }));
}

export function CourseBuilderToastRegion() {
  const [toast, setToast] = useState<ToastDetail | null>(null);

  useEffect(() => {
    function showToast(event: Event) {
      if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail.title !== "string") return;
      setToast({ title: event.detail.title, message: event.detail.message });
    }

    window.addEventListener("course-builder:toast", showToast);
    return () => {
      window.removeEventListener("course-builder:toast", showToast);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 4_000);
    return () => clearTimeout(timeout);
  }, [toast]);

  if (!toast) return h("div", { className: "course-builder-toast-region", "aria-live": "polite", "aria-atomic": "true" });

  return h("div", { className: "course-builder-toast-region", "aria-live": "polite", "aria-atomic": "true" },
    h("div", { className: "course-builder-toast", role: "status" },
      h("div", null,
        h("strong", null, toast.title),
        h("p", null, toast.message),
      ),
      h("button", {
        type: "button",
        className: "course-builder-toast__close",
        "aria-label": "Dismiss notification",
        onClick: () => setToast(null),
      }, "×"),
    ),
  );
}
