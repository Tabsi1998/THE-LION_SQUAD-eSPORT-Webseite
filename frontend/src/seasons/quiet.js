// Ruhezonen (H10, #698): Bereiche, in denen keine Saison-Deko sitzen, landen oder liegen darf - Formulare,
// Dialoge, Menüs, Brackets, Ranglisten, Zahlungs- und Anmeldeschritte, alles mit `data-season-quiet`. Eine
// zentrale Regel statt vieler Sonderfälle: Anker, Netze, Augen und Landeplätze fragen hier nach, Deko, die
// unter einen geöffneten Dialog gerät, weicht aus.

export const QUIET_ATTRIBUTE = "data-season-quiet";
export const QUIET_SELECTOR = [
  `[${QUIET_ATTRIBUTE}]`,
  "form",
  "[role='dialog']",
  "[role='alertdialog']",
  "[role='menu']",
  "[role='listbox']",
  "[role='combobox']",
  "[data-radix-popper-content-wrapper]",
  "[data-state='open'][data-side]",
  "table",
].join(", ");
// Geöffnete Dialoge und Menüs - dort weicht Deko sofort aus (Overlay-Vorrang).
export const OVERLAY_SELECTOR = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]";
export const QUIET_PADDING = 12;

function visible(rect) {
  return rect && rect.width >= 8 && rect.height >= 8;
}

/**
 * Alle Ruhezonen der Seite als Rechtecke in Seitenkoordinaten (plus Rand). Unsichtbare oder winzige Elemente
 * zählen nicht; `fixed` markiert Zonen, die am Fenster kleben (Dialoge, Menüs) - für Fenster-Anker.
 */
export function measureQuietZones(doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window, { padding = QUIET_PADDING, selector = QUIET_SELECTOR } = {}) {
  if (!doc || typeof doc.querySelectorAll !== "function") return [];
  const sx = (win && win.scrollX) || 0;
  const sy = (win && win.scrollY) || 0;
  const zones = [];
  doc.querySelectorAll(selector).forEach((element) => {
    if (typeof element.getBoundingClientRect !== "function") return;
    const rect = element.getBoundingClientRect();
    if (!visible(rect)) return;
    const overlay = typeof element.matches === "function" && element.matches(OVERLAY_SELECTOR);
    zones.push({
      left: rect.left + sx - padding, top: rect.top + sy - padding,
      right: rect.right + sx + padding, bottom: rect.bottom + sy + padding,
      viewLeft: rect.left - padding, viewTop: rect.top - padding, viewRight: rect.right + padding, viewBottom: rect.bottom + padding,
      overlay, element,
    });
  });
  return zones;
}

/** Liegt der Punkt (Seitenkoordinaten, oder Fensterkoordinaten mit `fixed`) in einer Ruhezone? */
export function pointInQuiet(point, zones, { fixed = false } = {}) {
  if (!point || !zones?.length) return false;
  return zones.some((zone) => (fixed
    ? point.x >= zone.viewLeft && point.x <= zone.viewRight && point.y >= zone.viewTop && point.y <= zone.viewBottom
    : point.x >= zone.left && point.x <= zone.right && point.y >= zone.top && point.y <= zone.bottom));
}

/** Schneidet das Rechteck (Seitenkoordinaten) eine Ruhezone? */
export function rectInQuiet(rect, zones, { fixed = false, overlayOnly = false } = {}) {
  if (!rect || !zones?.length) return false;
  return zones.some((zone) => {
    if (overlayOnly && !zone.overlay) return false;
    const l = fixed ? zone.viewLeft : zone.left;
    const t = fixed ? zone.viewTop : zone.top;
    const r = fixed ? zone.viewRight : zone.right;
    const b = fixed ? zone.viewBottom : zone.bottom;
    return rect.left < r && rect.right > l && rect.top < b && rect.bottom > t;
  });
}

/** Nur die Zonen, die am Fenster kleben (geöffnete Dialoge/Menüs) - für das Ausweichen. */
export function overlayZones(zones) {
  return (zones || []).filter((zone) => zone.overlay);
}

/**
 * Beobachtet die Seite auf geöffnete Dialoge und Menüs und ruft `onChange` (entprellt), wenn sich etwas tut -
 * damit Deko darunter ausweichen kann. Ohne MutationObserver (alte Umgebung) passiert nichts.
 */
export function watchOverlays(onChange, { doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window, debounceMs = 120 } = {}) {
  if (!doc || !win || typeof win.MutationObserver !== "function" || !doc.body) return () => {};
  let timer = 0;
  const notify = () => {
    win.clearTimeout(timer);
    timer = win.setTimeout(onChange, debounceMs);
  };
  const observer = new win.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") { notify(); return; }
      const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
      if (nodes.some((node) => node.nodeType === 1 && (typeof node.matches === "function" && (node.matches(OVERLAY_SELECTOR) || node.querySelector?.(OVERLAY_SELECTOR))))) { notify(); return; }
    }
  });
  observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "role", "aria-hidden", "open"] });
  return () => {
    observer.disconnect();
    win.clearTimeout(timer);
  };
}
