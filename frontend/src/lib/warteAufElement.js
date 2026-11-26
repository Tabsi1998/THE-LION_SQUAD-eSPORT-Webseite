// Auf ein Element warten, das erst nach dem Laden erscheint (#2059): Anker wie #nummer stehen in Karten, die ihre Daten
// selbst holen, und die Überschrift einer Gruppe kommt erst mit ihrem nachgeladenen Teil. Sofort nachsehen, dann bei
// jeder Änderung im Dokument - höchstens `timeoutMs` lang. Gibt `abbrechen` zurück (beim Verlassen der Seite).

export function warteAufElement(finde, rufAuf, { timeoutMs = 4000, root = typeof document === "undefined" ? null : document.body } = {}) {
  let fertig = false;
  let observer = null;
  let timer = null;
  const ende = (element) => {
    if (fertig) return;
    fertig = true;
    observer?.disconnect();
    if (timer) clearTimeout(timer);
    if (element) rufAuf(element);
  };
  const jetzt = finde();
  if (jetzt) {
    ende(jetzt);
    return () => {};
  }
  if (!root || typeof MutationObserver === "undefined") return () => {};
  observer = new MutationObserver(() => {
    const element = finde();
    if (element) ende(element);
  });
  observer.observe(root, { childList: true, subtree: true });
  timer = setTimeout(() => ende(null), timeoutMs);
  return () => ende(null);
}

const STOP_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"];

/**
 * Nach dem Sprung zu einem Anker das Ziel kurz im Blick halten: Laden Karten darüber nach und werden höher (seit der
 * Schrift-Treppe, #1302, mit größerem Kleintext etwa die Wunschnummer über „Meine Daten“), springt die Seite noch einmal
 * hin. Höchstens `ms` lang und nur, solange die Person nicht selbst scrollt, wischt, tippt oder eine Taste drückt.
 * Gibt `abbrechen` zurück.
 */
export function bleibAmZiel(ziel, { ms = 1500, ResizeObserver = globalThis.ResizeObserver, root = typeof document === "undefined" ? null : document.body } = {}) {
  if (!ziel || typeof ResizeObserver !== "function") return () => {};
  // Wo das Ziel nach dem Sprung steht: oben, mit seinem Abstand (scroll-mt-…) - auch wenn der Sprung noch gleitet.
  const start = typeof globalThis.Element === "function" && ziel instanceof globalThis.Element
    ? Number.parseFloat(getComputedStyle(ziel).scrollMarginTop) || 0
    : ziel.getBoundingClientRect().top;
  let fertig = false;
  const observer = new ResizeObserver(() => {
    if (fertig) return;
    if (Math.abs(ziel.getBoundingClientRect().top - start) > 4) ziel.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
  });
  const ende = () => {
    if (fertig) return;
    fertig = true;
    observer.disconnect();
    clearTimeout(timer);
    STOP_EVENTS.forEach((name) => window.removeEventListener(name, ende, true));
  };
  const timer = setTimeout(ende, ms);
  STOP_EVENTS.forEach((name) => window.addEventListener(name, ende, { capture: true, passive: true }));
  if (root) observer.observe(root);
  return ende;
}
