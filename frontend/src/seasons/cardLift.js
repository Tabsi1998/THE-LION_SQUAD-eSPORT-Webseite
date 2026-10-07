// Karten-Signal (Jahreszeiten IV, #1087): Alle Karten heben sich beim Drüberfahren (#1071). Die Deko einer Saison, die
// an genau dieser Karte hängt (Schneehaube, Netz, Fledermaus, verstecktes Ei, liegendes Konfetti), fährt mit und
// reagiert - jede Saison auf ihre Art. Hier liegt nur das gemeinsame Signal:
//
// - „enter“ sofort, wenn die Maus eine Karte mit Saison-Anker betritt: die Deko dieser Karte (data-season-card) fährt
//   mit der Karte hoch und beim Verlassen wieder herunter (CSS, gleiche Dauer und Kurve wie die Karte).
// - „lift“, wenn die Maus eine Viertelsekunde auf der Karte bleibt - Drüberwischen löst nichts aus. Genau einmal je
//   Anheben. Die Module entscheiden selbst und kennen ihre Ruhezeit je Karte (createRest).
// - „leave“ beim Verlassen, mit `lifted`, ob das Anheben fertig war.
//
// Nur mit Maus (hover: hover, pointerType „mouse“), nie mit „Bewegung reduzieren“. Höchstens eine große Reaktion
// gleichzeitig (startReaction über das Bewegungsbudget). Die App meldet dasselbe beim Antippen einer Karte
// (mobile/src/seasons/cardLift.ts).

import { ANCHOR_SELECTORS, elementId } from "./anchors";
import { getMotionScheduler, releaseMotion, requestMotion } from "./motion";

export const LIFT_DELAY_MS = 250;
/** So weit hebt sich eine Karte (index.css, .tls-card:hover) - die Deko fährt genauso weit mit. */
export const LIFT_PX = 5;
export const CARD_EVENT = "tls:season-card";
/** Ruhezeit je Karte: große Reaktionen (Schnee, Netz) etwa eine Minute, kleine zehn Sekunden. */
export const REST_MS = { big: 60000, small: 10000 };
export const CARD_SELECTOR = ANCHOR_SELECTORS.card;
/** Nur Karten, die sich wirklich heben (die Klasse aus #1071). */
export const LIFTING_CLASS = "tls-card";

/** Der Schlüssel einer Karte - derselbe, den der Anker-Kern für sie vergibt (`card:<id>`). */
export function cardKey(element) {
  return `card:${elementId(element)}`;
}

/** Gehört ein Platz (Schlüssel `card:<id>:<n>`) zu dieser Karte (`card:<id>`)? */
export function belongsTo(slotKey, key) {
  if (!slotKey || !key) return false;
  return slotKey === key || String(slotKey).startsWith(`${key}:`);
}

/** Der Kartenschlüssel eines Platzes (`card:<id>:<n>` -> `card:<id>`), sonst null. */
export function cardOf(slotKey) {
  const match = /^(card:\d+)(?::|$)/.exec(String(slotKey || ""));
  return match ? match[1] : null;
}

/** Darf es überhaupt Signale geben? Eine Maus (hover: hover) und keine reduzierte Bewegung. */
export function signalsAllowed(win) {
  if (!win || typeof win.matchMedia !== "function") return false;
  return win.matchMedia("(hover: hover)").matches && !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Ruhezeit je Karte: `take(key)` ist true, wenn die Reaktion jetzt darf (und merkt sich den Zeitpunkt). */
export function createRest(ms, now = () => Date.now()) {
  const last = new Map();
  return {
    take(key) {
      const at = now();
      const previous = last.get(key);
      if (previous !== undefined && at - previous < ms) return false;
      last.set(key, at);
      return true;
    },
    left(key) {
      const previous = last.get(key);
      return previous === undefined ? 0 : Math.max(0, ms - (now() - previous));
    },
    clear() {
      last.clear();
    },
  };
}

/**
 * Eine große Reaktion starten (Schnee abschütteln, Netz reißen): höchstens eine gleichzeitig. Kommt von der Person,
 * darum ohne Aufwärmzeit - aber nie neben einer anderen großen. Liefert das Token oder null.
 */
export function startReaction(kind = "card_big") {
  const scheduler = getMotionScheduler();
  if (scheduler.snapshot().active.includes(kind)) return null;
  return requestMotion(kind, { force: true });
}

export function endReaction(token) {
  if (token) releaseMotion(token);
}

function rectFor(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
}

/**
 * Die Rechnung des Signals ohne DOM-Ereignisse (Tests): `enter(element)` und `leave()` in der Zeit, `emit` bekommt
 * {type: "enter" | "lift" | "leave", key, element, rect?, lifted?}.
 */
export function createLiftTracker({ emit, delayMs = LIFT_DELAY_MS, schedule = (fn, ms) => setTimeout(fn, ms), cancel = (id) => clearTimeout(id) }) {
  let current = null;
  const tracker = {
    enter(element) {
      if (!element) return;
      if (current && current.element === element) return;
      if (current) tracker.leave();
      const entry = { key: cardKey(element), element, timer: null, lifted: false };
      current = entry;
      emit({ type: "enter", key: entry.key, element });
      entry.timer = schedule(() => {
        if (current !== entry || entry.lifted) return;
        entry.lifted = true;
        emit({ type: "lift", key: entry.key, element, rect: rectFor(element) });
      }, delayMs);
    },
    leave() {
      if (!current) return;
      const entry = current;
      current = null;
      cancel(entry.timer);
      emit({ type: "leave", key: entry.key, element: entry.element, lifted: entry.lifted });
    },
    get current() {
      return current;
    },
  };
  return tracker;
}

/** Die Deko dieser Karte fährt mit (CSS: [data-season-card][data-season-lifted]). */
export function follow(doc, key, lifted) {
  if (!doc || typeof doc.querySelectorAll !== "function" || !key) return 0;
  const nodes = doc.querySelectorAll(`[data-season-card="${key}"]`);
  nodes.forEach((node) => {
    if (lifted) node.setAttribute("data-season-lifted", "");
    else node.removeAttribute("data-season-lifted");
  });
  return nodes.length;
}

/**
 * Für Ebenen, die selbst zeichnen (Canvas: Konfetti, Regen): wie weit die Kante einer Karte gerade gehoben ist (px,
 * negativ = nach oben) - mit derselben Dauer und einer weichen Kurve wie die Karte. `onSignal` bekommt die Ereignisse.
 */
export function createLiftOffsets(now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()), durationMs = 240) {
  let state = null;
  return {
    onSignal(detail) {
      if (detail.type === "enter") state = { key: detail.key, up: true, at: now() };
      else if (detail.type === "leave" && state && state.key === detail.key) state = { key: detail.key, up: false, at: now() };
    },
    offset(key) {
      if (!state || !key || state.key !== key) return 0;
      const p = Math.min(1, Math.max(0, (now() - state.at) / durationMs));
      const eased = 1 - (1 - p) ** 3;
      if (!state.up && p >= 1) {
        state = null;
        return 0;
      }
      return -LIFT_PX * (state.up ? eased : 1 - eased);
    },
  };
}

/** Das Signal für eine Ebene, die kein React ist: an der echten Seite das gemeinsame, sonst keines. */
export function defaultSignal(win = typeof window === "undefined" ? null : window) {
  return win && win.document && typeof win.document.addEventListener === "function" ? cardSignal(win.document, win) : null;
}

let shared = null;

/**
 * Das eine Signal der Seite, solange jemand zuhört (Zählung): `subscribe(handler)` liefert das Abmelden. Hört niemand
 * mehr zu, sind die Ereignisse am Dokument wieder weg.
 */
export function cardSignal(doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window) {
  if (shared && shared.doc === doc) return shared;
  const handlers = new Set();
  let lifted = null;
  const emit = (detail) => {
    if (detail.type === "enter") {
      lifted = detail.key;
      follow(doc, detail.key, true);
    }
    if (detail.type === "leave") {
      if (lifted === detail.key) lifted = null;
      follow(doc, detail.key, false);
    }
    handlers.forEach((handler) => {
      try {
        handler(detail);
      } catch {
        // eine Saison darf das Signal der anderen nicht anhalten
      }
    });
    if (win && typeof win.dispatchEvent === "function" && typeof win.CustomEvent === "function") {
      win.dispatchEvent(new win.CustomEvent(CARD_EVENT, { detail: { type: detail.type, key: detail.key, rect: detail.rect || null, lifted: detail.lifted } }));
    }
  };
  const tracker = createLiftTracker({ emit, schedule: (fn, ms) => win.setTimeout(fn, ms), cancel: (id) => win.clearTimeout(id) });
  const onOver = (event) => {
    if (event.pointerType && event.pointerType !== "mouse") return;
    const target = event.target;
    const card = target && typeof target.closest === "function" ? target.closest(CARD_SELECTOR) : null;
    if (!card || !card.classList || !card.classList.contains(LIFTING_CLASS) || !signalsAllowed(win)) {
      tracker.leave();
      return;
    }
    tracker.enter(card);
  };
  const onOut = (event) => {
    const entry = tracker.current;
    if (!entry) return;
    const next = event.relatedTarget;
    if (next && typeof entry.element.contains === "function" && entry.element.contains(next)) return;
    tracker.leave();
  };
  const onHide = () => tracker.leave();
  let attached = false;
  const attach = () => {
    if (attached || !doc) return;
    attached = true;
    doc.addEventListener("pointerover", onOver, { passive: true });
    doc.addEventListener("pointerout", onOut, { passive: true });
    win?.addEventListener?.("blur", onHide);
  };
  const detach = () => {
    if (!attached || !doc) return;
    attached = false;
    tracker.leave();
    doc.removeEventListener("pointerover", onOver);
    doc.removeEventListener("pointerout", onOut);
    win?.removeEventListener?.("blur", onHide);
  };
  shared = {
    doc,
    subscribe(handler) {
      handlers.add(handler);
      attach();
      return () => {
        handlers.delete(handler);
        if (!handlers.size) detach();
      };
    },
    /** Welche Karte gerade gehoben ist (Schlüssel) - für Deko, die neu gezeichnet wird, während die Karte oben ist. */
    get lifted() {
      return lifted;
    },
    tracker,
  };
  return shared;
}

/** Nur für Tests: das gemeinsame Signal vergessen. */
export function resetCardSignal() {
  shared = null;
}
