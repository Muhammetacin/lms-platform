"use client";

import { createElement as h, type ReactNode } from "react";

export function CourseBuilderActionsMenu({
  label,
  children,
}: {
  label: string;
  children?: ReactNode;
}) {
  return h("details", {
    className: "course-builder-actions-menu",
    onClick: (event: { target: EventTarget | null; currentTarget: EventTarget & { open: boolean } }) => {
      if (event.target instanceof HTMLElement && event.target.closest("button")) {
        event.currentTarget.open = false;
      }
    },
  },
    h("summary", { "aria-label": `More actions for ${label}` },
      h("span", { "aria-hidden": "true" }, "•••"),
    ),
    h("div", { className: "course-builder-actions-menu__items", role: "group", "aria-label": `${label} actions` }, children),
  );
}
