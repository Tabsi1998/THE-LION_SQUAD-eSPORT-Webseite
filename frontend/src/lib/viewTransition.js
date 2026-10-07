// Seitenwechsel über die eingebaute Übergangs-Funktion der Browser (View Transitions, #1073).
//
// Wo der Browser sie kann, blendet er den Inhalt der alten Seite in die neue über; Kopf und untere Leiste stehen
// still (index.css). Sonst bleibt das einfache Einblenden des Inhalts (PublicLayout, .tls-route). Nur nach einem
// Klick auf einen Link der Seite - Weiterleitungen, Zurück und Vor laufen wie bisher. Nicht im Admin, nicht auf den
// TV- und Einrichtungsseiten, nicht mit „Bewegung reduzieren“.
//
// Ablauf: Der Klick merkt sich das Ziel. Startet der Router danach genau diese Navigation, läuft sie im Übergang;
// der Browser hält das alte Bild, bis die neue Seite steht (`routeCommitted`), höchstens WAIT_MS lang.

export const WAIT_MS = 400;
const QUIET = /^\/(?:admin|display|setup|tv)(?:\/|$)/;

export function quietPath(pathname) {
  return QUIET.test(pathname || "");
}

/** Pfad und Suche eines Router-Ziels (String oder {pathname, search, hash}); null bei Sprungmarke. */
export function routeKey(to, base = "http://local") {
  if (!to) return null;
  if (typeof to === "string") {
    const url = new URL(to, base);
    return url.hash ? null : `${url.pathname}${url.search}`;
  }
  if (to.hash && to.hash !== "#") return null;
  return `${to.pathname || "/"}${to.search || ""}`;
}

/**
 * Das Ziel eines Klicks, wenn er eine Seite dieser Website öffnet und der Router ihn übernimmt; sonst null.
 * Neuer Tab, Download, andere Seite, Sprungmarke und Links mit `data-route-plain` zählen nicht.
 */
export function clickTarget(event, win) {
  if (!event || event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target && typeof event.target.closest === "function" ? event.target.closest("a[href]") : null;
  if (!anchor || anchor.hasAttribute("download") || anchor.hasAttribute("data-route-plain")) return null;
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") return null;
  let url;
  try {
    url = new URL(anchor.href, win.location.href);
  } catch {
    return null;
  }
  if (url.origin !== win.location.origin || url.hash) return null;
  const here = `${win.location.pathname}${win.location.search}`;
  const there = `${url.pathname}${url.search}`;
  if (there === here || quietPath(url.pathname) || quietPath(win.location.pathname)) return null;
  return there;
}

export function transitionsAvailable(win) {
  if (!win || !win.document || typeof win.document.startViewTransition !== "function") return false;
  try {
    return !win.matchMedia || !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

// Ein Übergang wartet auf genau eine neue Seite; die zuletzt so gezeigte merkt sich PublicLayout (kein zweites
// Einblenden).
let pending = null;
let shownByTransition = null;

/** Läuft gerade ein Übergang, der auf eine neue Seite wartet? Dann blendet PublicLayout nicht noch selbst ein. */
export function transitionPending() {
  return pending !== null;
}

/** Die neue Seite steht (Router-Wechsel festgeschrieben, Scrollen erledigt): den wartenden Übergang loslassen. */
export function routeCommitted(key) {
  if (!pending || pending.key !== key) return false;
  const { resolve, timer } = pending;
  pending = null;
  shownByTransition = key.split("?")[0];
  clearTimeout(timer);
  resolve(true);
  return true;
}

/** Kam diese Seite über einen Übergang? Einmal abfragbar - danach gilt wieder das eigene Einblenden. */
export function takeTransitionShown(pathname) {
  if (shownByTransition === null || shownByTransition !== pathname) return false;
  shownByTransition = null;
  return true;
}

export function waitForRoute(key, timeout = WAIT_MS) {
  return new Promise((resolve) => {
    const entry = { key, resolve, timer: null };
    entry.timer = setTimeout(() => {
      if (pending === entry) pending = null;
      resolve(false);
    }, timeout);
    pending = entry;
  });
}

/** Startet `go` (die Navigation) im Übergang; ohne Übergangs-Funktion sofort. */
export function navigateWithTransition(win, key, go) {
  const root = win.document.documentElement;
  root.classList.add("tls-vt");
  let transition;
  try {
    transition = win.document.startViewTransition(() => {
      go();
      return waitForRoute(key);
    });
  } catch {
    root.classList.remove("tls-vt");
    go();
    return null;
  }
  const done = () => root.classList.remove("tls-vt");
  Promise.resolve(transition.finished).then(done, done);
  return transition;
}
