import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// Meldungen (Toasts, aria-live, Status) bleiben auch hinter einem offenen Overlay hörbar und bedienbar.
const LIVE_REGIONS = '[aria-live], [role="status"], [role="alert"]';
const NEVER_INERT = new Set(["SCRIPT", "STYLE", "TEMPLATE", "LINK", "META", "NOSCRIPT"]);

/**
 * Sperrt alles außerhalb von `root` mit `inert` (#2412) - wie `aria-modal` es verspricht: kein Klick, kein Tab und
 * kein Vorleseprogramm erreicht den Hintergrund. Gesperrt wird nur, was nicht schon gesperrt war; die Rückgabe gibt
 * genau das wieder frei.
 */
function inertOutside(root) {
  const keep = new Set([root, ...Array.from(document.querySelectorAll(LIVE_REGIONS)).filter((node) => !root.contains(node))]);
  const path = new Set();
  keep.forEach((node) => {
    for (let parent = node.parentElement; parent && !path.has(parent); parent = parent.parentElement) path.add(parent);
  });
  const locked = [];
  const visit = (parent) => {
    Array.from(parent.children).forEach((child) => {
      if (keep.has(child)) return;
      if (path.has(child)) {
        visit(child);
        return;
      }
      if (NEVER_INERT.has(child.tagName) || child.hasAttribute("inert")) return;
      child.setAttribute("inert", "");
      locked.push(child);
    });
  };
  visit(document.body);
  return () => locked.forEach((node) => node.removeAttribute("inert"));
}

// Offene Overlays von unten nach oben. Nur das oberste nimmt Escape und Tab an und sperrt den Rest der Seite; schließt
// es, gilt wieder das darunter (ein Bild-Dialog im Seitenblatt schließt allein, das Blatt bleibt offen).
const stack = [];

function lockTop() {
  const top = stack[stack.length - 1];
  if (top?.modalRoot?.isConnected && !top.release) top.release = inertOutside(top.modalRoot);
}

function unlockTop() {
  const top = stack[stack.length - 1];
  top?.release?.();
  if (top) top.release = null;
}

function pushOverlay(entry) {
  unlockTop();
  // Gehen zwei verschachtelte Overlays gleichzeitig auf, laufen die Effekte von innen nach außen - das innere bleibt oben.
  let index = stack.length;
  while (index > 0 && entry.container && entry.container.contains(stack[index - 1].container)) index -= 1;
  stack.splice(index, 0, entry);
  lockTop();
}

function popOverlay(entry) {
  const index = stack.indexOf(entry);
  if (index < 0) return;
  const wasTop = index === stack.length - 1;
  if (wasTop) unlockTop();
  stack.splice(index, 1);
  if (wasTop) lockTop();
}

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
 * on purpose - inserting a picture puts it back into the text editor - keeps it there (#937). Because the rest of the
 * page is `inert` while a modal overlay is open, such an action has to move the focus after closing (the text editor
 * focuses in the next frame, when the lock is already lifted).
 *
 * An overlay marked `aria-modal="true"` (on the container or around it) locks everything else on the page with
 * `inert` while it is open (#2412). Only the topmost open overlay reacts to Escape and Tab, so a dialog inside a
 * sheet closes on its own. Escape pressed in a list that lives outside the overlay (a Radix select hangs off the
 * body) belongs to that list.
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
    const entry = { container, modalRoot: container?.closest?.('[aria-modal="true"]') || null, release: null };
    pushOverlay(entry);
    const isTop = () => stack[stack.length - 1] === entry;

    if (container && !container.contains(document.activeElement)) {
      const [first] = focusableItems();
      (first || container).focus?.();
    }

    const onKeyDown = (event) => {
      if (!isTop()) return;
      if (event.key === "Escape") {
        const current = document.activeElement;
        if (container && current && current !== document.body && !container.contains(current)) return;
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
      popOverlay(entry);
      const current = document.activeElement;
      const movedOnPurpose = current && current !== document.body && !container?.contains(current);
      if (!movedOnPurpose) previouslyFocused?.focus?.();
    };
  }, [active]);

  return containerRef;
}
