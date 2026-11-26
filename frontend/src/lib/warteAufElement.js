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
