"use client";

import { createElement as h, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";

type BuilderDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  size?: "standard" | "drawer" | "confirmation";
  dirty?: boolean;
  pending?: boolean;
  children: ReactNode | ((requestClose: () => void) => ReactNode);
  onClose(): void;
};

export function CourseBuilderDialog({
  open,
  title,
  description,
  size = "standard",
  dirty = false,
  pending = false,
  children,
  onClose,
}: BuilderDialogProps): ReactElement | null {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  function requestClose() {
    if (pending) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  useEffect(() => {
    if (!open) return;
    const dialog = document.getElementById(dialogId);
    if (!(dialog instanceof HTMLDialogElement)) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    if (!dialog.open) dialog.showModal();
    const firstFocusable = dialog.querySelector<HTMLElement>("[autofocus]")
      ?? dialog.querySelector<HTMLElement>(".course-builder-dialog__body input:not(:disabled), .course-builder-dialog__body textarea:not(:disabled), .course-builder-dialog__body button:not(:disabled)")
      ?? dialog.querySelector<HTMLElement>("button:not(:disabled)");
    firstFocusable?.focus();

    return () => {
      if (dialog.open) dialog.close();
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [dialogId, open]);

  if (!open) return null;

  const content = typeof children === "function" ? children(requestClose) : children;

  return h("dialog", {
    id: dialogId,
    className: `course-builder-dialog course-builder-dialog--${size}`,
    "aria-labelledby": titleId,
    "aria-describedby": description ? descriptionId : undefined,
    onCancel: (event: { preventDefault(): void }) => {
      event.preventDefault();
      requestClose();
    },
    onKeyDown: (event: {
      key: string;
      shiftKey: boolean;
      target: EventTarget | null;
      currentTarget: EventTarget;
      preventDefault(): void;
    }) => {
      if (event.key !== "Tab") return;
      const dialog = event.currentTarget as HTMLDialogElement;
      if (event.target instanceof HTMLElement && event.target.closest("dialog") !== dialog) return;

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        "a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])",
      )).filter((element) => element.closest("dialog") === dialog && !element.hidden && element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    },
    onClick: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
      if (event.target === event.currentTarget) requestClose();
    },
  },
    h("div", { className: "course-builder-dialog__header" },
      h("div", null,
        h("h2", { id: titleId }, title),
        description ? h("p", { id: descriptionId }, description) : null,
      ),
      h("button", {
        className: "course-builder-dialog__close",
        type: "button",
        disabled: pending,
        "aria-label": `Close ${title}`,
        onClick: requestClose,
      }, "×"),
    ),
    h("div", { className: "course-builder-dialog__body" }, content),
    h(CourseBuilderDialog, {
      open: confirmDiscard,
      title: "Discard unsaved changes?",
      description: "Your unsaved changes will be lost if you discard them.",
      size: "confirmation",
      onClose: () => setConfirmDiscard(false),
      children: h("div", { className: "form-actions" },
        h("button", {
          className: "secondary-action",
          type: "button",
          onClick: () => setConfirmDiscard(false),
        }, "Continue editing"),
        h("button", {
          className: "destructive-action",
          type: "button",
          onClick: () => {
            setConfirmDiscard(false);
            onClose();
          },
        }, "Discard changes"),
      ),
    }),
  );
}
