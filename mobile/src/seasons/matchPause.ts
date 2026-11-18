import { useEffect, useSyncExternalStore } from "react";
import { stillScreen } from "./intensity";

// Turniertag (#1169) wie frontend/src/seasons/matchPause.js: Ist das eigene Spiel aufgerufen oder läuft es (Einzel,
// Team, Durchgang), pausiert die Saison-Deko auf allen Screens, bis das Ergebnis da ist. Einen eigenen Abruf gibt es
// dafür nicht: die Screens, die ohnehin laden, melden hier, was sie wissen - das Dashboard (`/mobile/dashboard`, alle
// offenen eigenen Spiele) und die Matchseite. Fragt gerade keiner im Takt nach, gilt der Stand bis zum nächsten Laden.
// Dazu die stillen Reiter: der Turnierbaum liegt im Screen „TournamentDetail“ und hält die Bühne still, solange er
// offen ist. Die Fälle stehen in frontend/src/seasons/stillness.cases.json.

type OwnMatch = { id?: unknown; match_id?: unknown; status?: unknown; state?: unknown; live_state?: unknown } | null | undefined;
export type MatchSource = "dashboard" | "queue" | "match";

/**
 * Sicherheitsablauf (wie im Web): Spätestens so lange nach der letzten Meldung endet die Pause, auch wenn kein Screen
 * mehr lädt - ein vergessenes „läuft“ hält die Deko nicht den ganzen Abend an. Kein Nachfragen, nur ein Wecker.
 */
export const PAUSE_MAX_MS = 3 * 60 * 60 * 1000;

// Wie „läuft“ in der Warteschlange (services/match_scheduler.py): gespielt wird, bis das Ergebnis da ist.
const RUNNING = new Set(["in_progress", "running", "waiting_result"]);
const LIVE_STATES = new Set(["running", "called"]);
const DONE = new Set(["completed", "archived", "forfeit", "bye", "no_show", "cancelled", "disputed"]);

/** Hält dieses Spiel die Deko an? Aufgerufen (Warteschlange `state`, Dashboard `live_state`) oder es läuft. */
export function holdsDeco(match: unknown): boolean {
  if (!match || typeof match !== "object") return false;
  const row = match as Exclude<OwnMatch, null | undefined>;
  const status = String(row.status || "");
  if (DONE.has(status)) return false;
  return LIVE_STATES.has(String(row.state)) || LIVE_STATES.has(String(row.live_state)) || RUNNING.has(status);
}

export function decoPaused(matches: unknown): boolean {
  return Array.isArray(matches) && matches.some(holdsDeco);
}

const idOf = (match: unknown) => (match && typeof match === "object" ? String((match as Exclude<OwnMatch, null | undefined>).id || (match as Exclude<OwnMatch, null | undefined>).match_id || "") : "");

let held = new Map<string, boolean>();
const stillHolds = new Set<string>();
let paused = false;
// Der Wecker des Sicherheitsablaufs: endet die Pause ohne neue Meldung, erfährt es die Bühne von selbst.
let alarm: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function update(next: Map<string, boolean>) {
  held = next;
  const now = [...held.values()].some(Boolean);
  if (now === paused) return;
  paused = now;
  emit();
}

/**
 * Was eine Quelle über eigene Spiele weiß. `dashboard`: alle offenen eigenen Spiele - ersetzt den ganzen Stand.
 * `queue`: eigene Spiele aus der Warteschlange - ergänzt. `match`: ein Spiel der Matchseite - die sehen auch
 * Zuschauer, deshalb ändert sie nur Spiele, die schon als eigene bekannt sind (etwa „Ergebnis da“); eine fremde
 * Matchseite ist keine Meldung und verlängert auch den Sicherheitsablauf nicht.
 */
export function noteOwnMatches(matches: unknown, source: MatchSource = "dashboard") {
  if (source === "dashboard" && !Array.isArray(matches)) return;
  const rows: unknown[] = Array.isArray(matches) ? matches : [];
  const next = source === "dashboard" ? new Map<string, boolean>() : new Map(held);
  let touched = source !== "match";
  rows.forEach((match) => {
    const id = idOf(match);
    if (!id || (source === "match" && !next.has(id))) return;
    touched = true;
    next.set(id, holdsDeco(match));
  });
  if (!touched) return;
  update(next);
  if (alarm) clearTimeout(alarm);
  alarm = paused ? setTimeout(expire, PAUSE_MAX_MS) : null;
}

// Greift der Sicherheitsablauf, verfallen auch die gemerkten Spiele - eine spätere Meldung weckt das alte „läuft“ nicht.
function expire() {
  alarm = null;
  held = new Map();
  if (!paused) return;
  paused = false;
  emit();
}

/** Abmelden oder eine andere Person: der Stand gehört nicht mehr dazu. */
export function clearOwnMatches() {
  if (alarm) clearTimeout(alarm);
  alarm = null;
  update(new Map());
}

export function ownMatchesPaused(): boolean {
  return paused;
}

/** Ein stiller Reiter (`screen` muss als still gelten) ist offen bzw. wieder zu. */
export function setStillHold(id: string, screen: string, active: boolean) {
  const on = active && stillScreen(screen);
  if (on === stillHolds.has(id)) return;
  if (on) stillHolds.add(id);
  else stillHolds.delete(id);
  emit();
}

export function stillHeld(): boolean {
  return stillHolds.size > 0;
}

/** Nur für Tests. */
export function clearStillHolds() {
  if (!stillHolds.size) return;
  stillHolds.clear();
  emit();
}

export function subscribeOwnMatches(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => paused || stillHolds.size > 0;

/** Bleibt die Bühne gerade leer - eigenes Spiel aufgerufen bzw. laufend, oder ein stiller Reiter offen? */
export function useDecoPaused(): boolean {
  return useSyncExternalStore(subscribeOwnMatches, snapshot, snapshot);
}

/** Hält die Bühne still, solange `active` (etwa: Reiter „Baum“ offen und Screen im Blick). */
export function useStillHold(id: string, screen: string, active: boolean) {
  useEffect(() => {
    setStillHold(id, screen, active);
    return () => setStillHold(id, screen, false);
  }, [id, screen, active]);
}
