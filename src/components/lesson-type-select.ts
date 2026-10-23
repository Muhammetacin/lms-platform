"use client";

import { createElement as h, Fragment, useEffect, useId, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { LessonTypeValue } from "../lib/lesson-core.ts";

export type LessonTypeOption = {
  value: LessonTypeValue;
  label: string;
};

function calculatePopupStyle(rect: DOMRect, optionCount: number): CSSProperties {
  const viewportPadding = 8;
  const width = Math.min(Math.max(rect.width, 180), window.innerWidth - viewportPadding * 2);
  const desiredHeight = Math.min(optionCount * 44, window.innerHeight - viewportPadding * 2);
  const spaceBelow = window.innerHeight - rect.bottom - viewportPadding * 2;
  const spaceAbove = rect.top - viewportPadding * 2;
  const opensAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
  const height = Math.max(0, Math.min(desiredHeight, opensAbove ? spaceAbove : spaceBelow));
  const top = opensAbove
    ? rect.top - height - viewportPadding
    : rect.bottom + viewportPadding;
  const left = Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - width - viewportPadding);

  return { top, left, width, maxHeight: height };
}

export function LessonTypeSelect({
  id,
  labelId,
  name,
  value,
  options,
  disabled = false,
  onValueChange,
}: {
  id: string;
  labelId: string;
  name: string;
  value: LessonTypeValue;
  options: LessonTypeOption[];
  disabled?: boolean;
  onValueChange?(value: LessonTypeValue): void;
}) {
  const uniqueId = useId();
  const listboxId = `${uniqueId}-lesson-types`;
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const [popupStyle, setPopupStyle] = useState<CSSProperties>();
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  function positionPopup() {
    const trigger = document.getElementById(id);
    if (trigger instanceof HTMLButtonElement) setPopupStyle(calculatePopupStyle(trigger.getBoundingClientRect(), options.length));
  }

  function openListbox() {
    if (disabled) return;
    setActiveValue(value);
    positionPopup();
    setOpen(true);
  }

  function closeListbox() {
    setOpen(false);
    setActiveValue(value);
  }

  function selectOption(nextValue: LessonTypeValue) {
    onValueChange?.(nextValue);
    setOpen(false);
    document.getElementById(id)?.focus();
  }

  function moveActiveOption(direction: 1 | -1) {
    setActiveValue((currentValue) => {
      const currentIndex = options.findIndex((option) => option.value === currentValue);
      const nextIndex = (currentIndex + direction + options.length) % options.length;
      return options[nextIndex]?.value ?? value;
    });
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab" && open) {
      closeListbox();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openListbox();
      } else {
        moveActiveOption(event.key === "ArrowDown" ? 1 : -1);
      }
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      const option = event.key === "Home" ? options[0] : options.at(-1);
      if (option) setActiveValue(option.value);
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActiveValue(value);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openListbox();
      } else {
        selectOption(activeValue);
      }
    }
  }

  useEffect(() => {
    if (!open) return;

    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const trigger = document.getElementById(id);
      const listbox = document.getElementById(listboxId);
      if (trigger?.contains(target) || listbox?.contains(target)) return;
      setOpen(false);
      setActiveValue(value);
    };
    const reposition = () => {
      const trigger = document.getElementById(id);
      if (trigger instanceof HTMLButtonElement) setPopupStyle(calculatePopupStyle(trigger.getBoundingClientRect(), options.length));
    };

    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [id, listboxId, open, options.length, value]);

  const activeDescendant = options.find((option) => option.value === activeValue);
  const popup = open && typeof document !== "undefined" && popupStyle
    ? createPortal(
        h("div", {
          id: listboxId,
          className: "lesson-type-listbox",
          role: "listbox",
          "aria-labelledby": labelId,
          style: popupStyle,
        }, options.map((option) => h("div", {
          key: option.value,
          id: `${listboxId}-${option.value}`,
          className: "lesson-type-option",
          role: "option",
          "aria-selected": option.value === value,
          "data-active": option.value === activeValue ? "true" : undefined,
          onMouseEnter: () => setActiveValue(option.value),
          onClick: () => selectOption(option.value),
        },
          h("span", null, option.label),
          option.value === value ? h("span", { className: "lesson-type-check", "aria-hidden": "true" }, "✓") : null,
        ))),
        document.body,
      )
    : null;

  return h(Fragment, null,
    h("button", {
      id,
      className: "lesson-type-trigger",
      type: "button",
      role: "combobox",
      "aria-labelledby": labelId,
      "aria-haspopup": "listbox",
      "aria-expanded": open,
      "aria-controls": open ? listboxId : undefined,
      "aria-activedescendant": open && activeDescendant ? `${listboxId}-${activeDescendant.value}` : undefined,
      disabled,
      onClick: () => (open ? closeListbox() : openListbox()),
      onKeyDown: onTriggerKeyDown,
    },
      h("span", null, selectedOption?.label ?? value),
      h("span", { className: "lesson-type-indicator", "aria-hidden": "true" }),
    ),
    h("input", { type: "hidden", name, value, disabled }),
    popup,
  );
}
