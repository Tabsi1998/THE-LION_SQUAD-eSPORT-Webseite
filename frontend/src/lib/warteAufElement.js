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
 * Schrift-Treppe, #1302, mit größerem Kleintext etwa die Wunschnummer über „Meine Daten“), rückt die Seite nach -
 * gleitend, wenn Bewegung erlaubt ist (`motion`). Gemessen wird die Lage des Ziels im Dokument, nicht im Bild: Der
 * erste Sprung gleitet ungestört, nachgerückt wird nur, wenn sich das Ziel danach im Dokument verschiebt.
 * Höchstens `ms` lang und nur, solange die Person nicht selbst scrollt, wischt, tippt oder eine Taste drückt.
 * Gibt `abbrechen` zurück.
 */
export function bleibAmZiel(ziel, {
  ms = 1500, motion = false, ResizeObserver = globalThis.ResizeObserver, root = typeof document === "undefined" ? null : document.body,
  scrollY = () => globalThis.scrollY || 0,
} = {}) {
  if (!ziel || typeof ResizeObserver !== "function") return () => {};
  const imDokument = () => ziel.getBoundingClientRect().top + scrollY();
  let lage = imDokument();
  let fertig = false;
  const observer = new ResizeObserver(() => {
    if (fertig) return;
    const jetzt = imDokument();
    if (Math.abs(jetzt - lage) <= 4) return;
    lage = jetzt;
    ziel.scrollIntoView({ block: "start", inline: "nearest", behavior: motion ? "smooth" : "auto" });
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
