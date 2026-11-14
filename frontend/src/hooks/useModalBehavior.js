import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keyboard behaviour every one of our own overlays needs: Escape closes it, Tab
 * stays inside it, and focus returns where it came from afterwards.
 *
 * Radix handles this for the dialogs built on it; these are the hand-rolled
 * overlays that do not go through Radix. Focus is moved into the overlay even
 * for the celebration popups that appear on their own, because they cover the
 * whole screen: without it a keyboard user cannot reach their close button.
 *
 * Focus only goes back when it is still inside the overlay (or was lost with it): an action that already moved it on
 * on purpose - inserting a picture puts it back into the text editor - keeps it there (#937).
 *
 * Returns the ref to put on the element that holds the focusable content.
 */
export function useModalBehavior(active, onDismiss) {
  const containerRef = useRef(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    const previouslyFocused = document.activeElement;

    const focusableItems = () => Array.from(container?.querySelectorAll(FOCUSABLE) || []);

    if (container && !container.contains(document.activeElement)) {
      const [first] = focusableItems();
      (first || container).focus?.();
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismissRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !container) return;
      const items = focusableItems();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !container.contains(current))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (current === last || !container.contains(current))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const current = document.activeElement;
      const movedOnPurpose = current && current !== document.body && !container?.contains(current);
      if (!movedOnPurpose) previouslyFocused?.focus?.();
    };
  }, [active]);

  return containerRef;
}
