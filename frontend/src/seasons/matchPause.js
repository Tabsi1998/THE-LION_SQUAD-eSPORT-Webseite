import { useSyncExternalStore } from "react";

// Turniertag (#1169): Ist das eigene Spiel aufgerufen oder läuft es (Einzel, Team, Durchgang), pausiert die Saison-Deko
// auf allen Seiten, bis das Ergebnis da ist. Einen eigenen Abruf gibt es dafür nicht: die Seiten, die ohnehin laden,
// melden hier, was sie wissen - die Startseite (`/mobile/dashboard`, alle offenen eigenen Spiele), die Warteschlange vor
// Ort (`/live-queue/me`) und die Matchseite. Fragt gerade keine im Takt nach, gilt der Stand bis zum nächsten Laden.
// Die App rechnet genauso (mobile/src/seasons/matchPause.ts); die Fälle stehen in stillness.cases.json.

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

let held = new Map();
let paused = false;
const listeners = new Set();

function update(next) {
  held = next;
  const now = [...held.values()].some((entry) => entry.live);
  if (now === paused) return;
  paused = now;
  listeners.forEach((listener) => listener());
}

/**
 * Was eine Quelle über eigene Spiele weiß. `dashboard`: alle offenen eigenen Spiele - ersetzt den ganzen Stand.
 * `queue`: eigene Spiele eines Turniers aus der Warteschlange (`scope`: das Turnier) - ergänzt; ein Spiel, das aus
 * der Warteschlange desselben Turniers verschwindet, hat sein Ergebnis. `match`: ein Spiel der Matchseite - die sehen
 * auch Zuschauer, deshalb ändert sie nur Spiele, die schon als eigene bekannt sind (etwa „Ergebnis da“).
 */
export function noteOwnMatches(matches, source = "dashboard", { scope = null } = {}) {
  if (source === "dashboard" && !Array.isArray(matches)) return;
  const rows = Array.isArray(matches) ? matches : [];
  const next = source === "dashboard" ? new Map() : new Map(held);
  if (source === "queue" && scope) {
    const seen = new Set(rows.map(idOf));
    next.forEach((entry, id) => {
      if (entry.scope === scope && !seen.has(id)) next.delete(id);
    });
  }
  rows.forEach((match) => {
    const id = idOf(match);
    if (!id || (source === "match" && !next.has(id))) return;
    next.set(id, { live: holdsDeco(match), scope: source === "queue" ? scope : next.get(id)?.scope || null });
  });
  update(next);
}

/** Abmelden oder eine andere Person: der Stand gehört nicht mehr dazu. */
export function clearOwnMatches() {
  update(new Map());
}

export function ownMatchesPaused() {
  return paused;
}

export function subscribeOwnMatches(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Pausiert das eigene Spiel gerade die Deko? */
export function useDecoPaused() {
  return useSyncExternalStore(subscribeOwnMatches, ownMatchesPaused, () => false);
}
