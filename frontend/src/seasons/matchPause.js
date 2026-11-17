import { clearDecoPause, decoPauseActive, decoPauseGeneration, setDecoPause, subscribeDecoPause } from "./decoPause";

// Turniertag (#1169): Ist das eigene Spiel aufgerufen oder läuft es (Einzel, Team, Durchgang), pausiert die Saison-Deko
// auf allen Seiten, bis das Ergebnis da ist. Einen eigenen Abruf gibt es dafür nicht: die Seiten, die ohnehin laden,
// melden hier, was sie wissen - die Startseite (`/mobile/dashboard`, alle offenen eigenen Spiele), die Warteschlange vor
// Ort (`/live-queue/me`) und die Matchseite. Fragt gerade keine im Takt nach, gilt der Stand bis zum nächsten Laden,
// höchstens aber PAUSE_MAX_MS. Nur diese Seiten laden die Datei - im Start-Bundle liegt nur decoPause.js.
// Die App rechnet genauso (mobile/src/seasons/matchPause.ts); die Fälle stehen in stillness.cases.json.

/**
 * Sicherheitsablauf: Spätestens so lange nach der letzten Meldung endet die Pause, auch wenn keine Seite mehr lädt -
 * ein vergessenes „läuft“ hält die Deko nicht den ganzen Abend an. Kein Nachfragen, nur ein Wecker.
 */
export const PAUSE_MAX_MS = 3 * 60 * 60 * 1000;

// Wie „läuft“ in der Warteschlange (services/match_scheduler.py): gespielt wird, bis das Ergebnis da ist.
const RUNNING = new Set(["in_progress", "running", "waiting_result"]);
const LIVE_STATES = new Set(["running", "called"]);
const DONE = new Set(["completed", "archived", "forfeit", "bye", "no_show", "cancelled", "disputed"]);

/** Hält dieses Spiel die Deko an? Aufgerufen (Warteschlange `state`, Startseite `live_state`) oder es läuft. */
export function holdsDeco(match) {
  if (!match || typeof match !== "object") return false;
  const status = String(match.status || "");
  if (DONE.has(status)) return false;
  return LIVE_STATES.has(match.state) || LIVE_STATES.has(match.live_state) || RUNNING.has(status);
}

export function decoPaused(matches) {
  return Array.isArray(matches) && matches.some(holdsDeco);
}

const idOf = (match) => (match && typeof match === "object" ? String(match.id || match.match_id || "") : "");

// Die bekannten eigenen Spiele: Kennung → { live, scope }. Nach dem Abmelden (neue `generation`) gelten sie nicht mehr.
let held = new Map();
let heldGeneration = decoPauseGeneration;
// Der Wecker des Sicherheitsablaufs: endet die Pause ohne neue Meldung, erfahren es Bühne und Fußzeile von selbst.
let alarm = 0;

/** Vergessen: die gemerkten Spiele und der Wecker - beim Abmelden und wenn der Sicherheitsablauf greift. */
function forget() {
  held = new Map();
  clearTimeout(alarm);
  alarm = 0;
  heldGeneration = decoPauseGeneration;
}

// Abmelden ruft im Start-Teil nur clearDecoPause (SeasonContext.jsx) - der Zähler springt, bevor die Pause endet. Dieser
// Zuhörer räumt dann Spiele und Wecker ab, ohne dass diese Datei in den Start-Teil muss.
subscribeDecoPause(() => {
  if (heldGeneration !== decoPauseGeneration) forget();
});

/**
 * Was eine Quelle über eigene Spiele weiß. `dashboard`: alle offenen eigenen Spiele - ersetzt den ganzen Stand.
 * `queue`: eigene Spiele eines Turniers aus der Warteschlange (`scope`: das Turnier) - ergänzt; ein Spiel, das aus
 * der Warteschlange desselben Turniers verschwindet, hat sein Ergebnis. `match`: ein Spiel der Matchseite - die sehen
 * auch Zuschauer, deshalb ändert sie nur Spiele, die schon als eigene bekannt sind (etwa „Ergebnis da“); eine fremde
 * Matchseite ist keine Meldung und verlängert auch den Sicherheitsablauf nicht.
 */
export function noteOwnMatches(matches, source = "dashboard", { scope = null } = {}) {
  if (source === "dashboard" && !Array.isArray(matches)) return;
  if (heldGeneration !== decoPauseGeneration) forget();
  const rows = Array.isArray(matches) ? matches : [];
  const next = source === "dashboard" ? new Map() : new Map(held);
  if (source === "queue" && scope) {
    const seen = new Set(rows.map(idOf));
    next.forEach((entry, id) => {
      if (entry.scope === scope && !seen.has(id)) next.delete(id);
    });
  }
  let touched = source !== "match";
  rows.forEach((match) => {
    const id = idOf(match);
    if (!id || (source === "match" && !next.has(id))) return;
    touched = true;
    next.set(id, { live: holdsDeco(match), scope: source === "queue" ? scope : next.get(id)?.scope || null });
  });
  if (!touched) return;
  held = next;
  const live = [...held.values()].some((entry) => entry.live);
  clearTimeout(alarm);
  setDecoPause(live);
  // Greift der Sicherheitsablauf, verfallen auch die gemerkten Spiele - eine spätere Meldung weckt das alte „läuft“ nicht.
  alarm = live ? setTimeout(() => {
    forget();
    setDecoPause(false);
  }, PAUSE_MAX_MS) : 0;
}

/** Abmelden oder eine andere Person: der Stand gehört nicht mehr dazu. */
export function clearOwnMatches() {
  clearDecoPause();
  forget();
}

export function ownMatchesPaused() {
  return decoPauseActive();
}

export const subscribeOwnMatches = subscribeDecoPause;
