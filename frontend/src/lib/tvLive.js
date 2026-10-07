// Live am Turnierbaum-TV (#1116, #1117, #1118): welche Spiele laufen, wie lange schon, was sich seit dem letzten Stand
// geändert hat. Die Spielzeit kommt aus der Startzeit (`started_at`, setzt die Stationsverwaltung) - sie stimmt deshalb
// auch nach dem Neuladen und über Mitternacht. Ohne Startzeit steht nur „Live“.
import { isMatchDone } from "@/lib/slotSource";

export const LIVE_STATUSES = new Set(["running", "in_progress", "live"]);

export function isLiveMatch(match) {
  return LIVE_STATUSES.has(String(match?.status || "").toLowerCase());
}

/** Sekunden seit dem Start - `null` ohne (gültige) Startzeit. Eine Startzeit in der Zukunft (Uhr am TV geht nach) ist 0. */
export function elapsedSeconds(startedAt, nowMs = Date.now()) {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, Math.floor((nowMs - start) / 1000));
}

/** „7:05“, „12:34“, ab einer Stunde „1:02:03“. */
export function clockText(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "";
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** Der kurze Name der Station („PC 3“) - eine nackte Nummer wird zu „Station 3“. */
export function stationName(match) {
  const raw = String(match?.station_name || match?.station?.name || match?.station_label || "").trim();
  if (!raw) return "";
  return /^\d+$/.test(raw) ? `Station ${raw}` : raw;
}

/** Was groß unter einem laufenden Spiel steht: „PC 3 · 12:34“, ohne Startzeit „PC 3 · Live“ oder nur „Live“. */
export function spotlightParts(match, nowMs = Date.now()) {
  const station = stationName(match);
  const seconds = elapsedSeconds(match?.started_at, nowMs);
  const clock = seconds === null ? "" : clockText(seconds);
  return { station, clock, text: [station, clock || "Live"].filter(Boolean).join(" · ") };
}

function resultSignature(match) {
  return (match?.results || [])
    .map((row) => `${row.registration_id}:${row.rank ?? ""}:${row.score ?? row.points ?? ""}`)
    .sort()
    .join("|");
}

/** Der Stand eines Turniers, gegen den der nächste verglichen wird: je Spiel läuft / fertig / Ergebnis. */
export function bracketSnapshot(matches = []) {
  const snapshot = new Map();
  for (const match of matches || []) {
    if (!match?.id) continue;
    snapshot.set(match.id, { live: isLiveMatch(match), done: isMatchDone(match), sig: resultSignature(match) });
  }
  return snapshot;
}

/**
 * Was seit dem letzten Stand neu ist: `started` (jetzt live, vorher nicht) und `decided` (jetzt entschieden, vorher
 * nicht). Beim ersten Stand (`previous` leer) ist nichts neu - nach dem Neuladen zoomt und fährt nichts.
 */
export function bracketChanges(previous, matches = []) {
  const next = bracketSnapshot(matches);
  if (!previous) return { started: [], decided: [], snapshot: next };
  const started = [];
  const decided = [];
  for (const match of matches || []) {
    const before = previous.get(match.id);
    const now = next.get(match.id);
    if (!before || !now) continue;
    if (now.live && !before.live && !now.done) started.push(match.id);
    if (now.done && !before.done && (match.results || []).length) decided.push(match.id);
  }
  return { started, decided, snapshot: next };
}

function roundKey(match) {
  return `${match?.stage_id || ""}::${match?.section || ""}::${match?.round || ""}`;
}

/**
 * Der Zoom beim Start (#1116): ein Spiel - Zoom auf dieses Spiel; mehrere zugleich - ein Zoom auf alle zusammen statt
 * vieler einzelner, beschriftet mit der Runde, wenn sie alle in derselben Runde liegen.
 */
export function liveZoomPlan(matchIds = [], matches = [], { roundLabel = (match) => match?.round_name || "" } = {}) {
  const started = (matches || []).filter((match) => matchIds.includes(match.id));
  if (!started.length) return null;
  if (started.length === 1) {
    const [match] = started;
    const station = stationName(match);
    const name = matchName(match);
    return { matchIds: [match.id], text: station ? `${name} an ${station}` : name };
  }
  const sameRound = new Set(started.map(roundKey)).size === 1;
  const label = sameRound ? roundLabel(started[0]) : "";
  return { matchIds: started.map((match) => match.id), text: [label, `${started.length} Spiele`].filter(Boolean).join(" · ") };
}

/** „Spiel A“, „Durchgang C“ - wie die Karte im Baum. */
export function matchName(match) {
  const key = match?.match_key || "";
  const heat = String(match?.match_type || "duel") !== "duel" || (match?.slots || []).length > 2;
  return `${heat ? "Durchgang" : "Spiel"} ${key}`.trim();
}
