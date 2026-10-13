import { compareByNearestDate } from "@/lib/contentSort";
import { asInstant, viennaDay } from "@/lib/vienna";

// Das Event als Klammer (#1182): Turniere und Fast Laps, die zu einem Event gehören, stehen in seiner Karte (Fabians
// Variante A, aufklappbar) - nicht noch einmal einzeln. Wer will, schaltet „zusätzlich einzeln“ an (letzte Wahl je
// Gerät). „Nur meine“ (#1189) behält, wofür man selbst oder das eigene Team dabei ist - in einer Event-Karte auch nur
// diese Turniere. Dieselbe Rechnung wie in der App (mobile/src/lib/eventGroups.ts).

export const LIST_MODE_STORAGE_KEY = "tls_events_list_mode";
export const LIST_MODES = [
  { key: "nested", label: "Turniere im Event" },
  { key: "separate", label: "Zusätzlich einzeln" },
];
export const FILTERS = [
  { key: "all", label: "Alle" },
  { key: "events", label: "Events" },
  { key: "tournaments", label: "Turniere" },
  { key: "fastlaps", label: "Fast Laps" },
];

const MINE_GROUP = { event: "events", tournament: "tournaments", fastlap: "fastlaps" };
const DONE = new Set(["completed", "results_published", "archived", "cancelled"]);

export function listMode(stored) {
  return stored === "separate" ? "separate" : "nested";
}

/** Der eigene Stand zu einem Eintrag aus `GET /api/calendar/mine` - oder null. */
export function mineState(mine, kind, id) {
  return mine?.[MINE_GROUP[kind]]?.[id] || null;
}

/** Vorbei ist, was beendet/abgesagt ist oder dessen letzter Tag vor dem heutigen Wiener Tag liegt. */
export function isPast(item, now = new Date()) {
  const state = item?.public_phase?.state || item?.status;
  if (DONE.has(state) || DONE.has(item?.status)) return true;
  const last = item?.end_date || item?.start_date;
  if (!last) return false;
  const time = asInstant(last);
  if (Number.isNaN(time.getTime())) return false;
  return viennaDay(time) < viennaDay(now);
}

function byDate(a, b) {
  return compareByNearestDate(a.item.start_date, b.item.start_date, a.item.status, b.item.status, a.item.public_phase, b.item.public_phase);
}

// In der Event-Karte zählt der Ablauf: nach Beginn, ohne Datum zuletzt.
function byStart(a, b) {
  const at = a.item.start_date ? asInstant(a.item.start_date).getTime() : Number.MAX_SAFE_INTEGER;
  const bt = b.item.start_date ? asInstant(b.item.start_date).getTime() : Number.MAX_SAFE_INTEGER;
  return at - bt;
}

function single(kind, item, mine, parent) {
  return { kind, key: `${kind}-${item.id}`, item, mine: mineState(mine, kind, item.id), event: parent || null };
}

/**
 * Karten für die Liste: Events mit ihren Turnieren und Fast Laps, dazu, was zu keinem gezeigten Event gehört.
 *
 * - `mode`: „nested“ (Turniere stehen nur im Event) oder „separate“ (zusätzlich als eigene Karte).
 * - `filter`: „all“, „events“ (nur Event-Karten), „tournaments“ bzw. „fastlaps“ (alle einzeln, mit Hinweis aufs Event).
 * - `keep(item)`: welche Turniere und Fast Laps als eigene Karte in Frage kommen (Kommend/Vergangen). In einer
 *   Event-Karte stehen immer alle seine Turniere - auch das gestern beendete eines laufenden LAN-Wochenendes.
 * - `onlyMine` mit `mine` aus `GET /api/calendar/mine`: nur, wobei man dabei ist.
 */
export function buildCards({ events = [], tournaments = [], fastlaps = [] } = {}, { mode = "nested", filter = "all", onlyMine = false, mine = null, keep = () => true } = {}) {
  const eventById = new Map(events.filter((event) => event?.id).map((event) => [event.id, event]));
  const children = new Map();
  const loose = [];
  const add = (kind, item) => {
    if (!item?.id) return;
    const parent = item.event_id ? eventById.get(item.event_id) : null;
    if (parent) {
      const row = single(kind, item, mine, parent);
      children.set(parent.id, [...(children.get(parent.id) || []), row]);
      if (mode === "separate" || filter === "tournaments" || filter === "fastlaps") loose.push(row);
    } else {
      loose.push(single(kind, item, mine, null));
    }
  };
  tournaments.forEach((item) => add("tournament", item));
  fastlaps.forEach((item) => add("fastlap", item));

  const eventCards = events.filter((event) => event?.id).map((event) => {
    const rows = (children.get(event.id) || []).slice().sort(byStart);
    return { kind: "event", key: `event-${event.id}`, item: event, mine: mineState(mine, "event", event.id), children: onlyMine ? rows.filter((row) => row.mine) : rows };
  });
  const singles = loose.filter((row) => keep(row.item));

  let cards;
  if (filter === "events") cards = eventCards;
  else if (filter === "tournaments") cards = singles.filter((row) => row.kind === "tournament");
  else if (filter === "fastlaps") cards = singles.filter((row) => row.kind === "fastlap");
  else cards = [...eventCards, ...singles];

  if (onlyMine) cards = cards.filter((card) => card.mine || (card.kind === "event" && card.children.length));
  return cards.sort(byDate);
}

/** Zusammenfassung einer Event-Karte: „2 Turniere · 1 Fast Lap“. */
export function childSummary(rows = []) {
  const tournaments = rows.filter((row) => row.kind === "tournament").length;
  const fastlaps = rows.filter((row) => row.kind === "fastlap").length;
  return [
    tournaments ? `${tournaments} ${tournaments === 1 ? "Turnier" : "Turniere"}` : "",
    fastlaps ? `${fastlaps} ${fastlaps === 1 ? "Fast Lap" : "Fast Laps"}` : "",
  ].filter(Boolean).join(" · ");
}

/** Spielart einer Zeile: Spiel und Einzel/Team beim Turnier, „Fast Lap“ bei der Fast Lap. */
export function playLabel(row) {
  if (row.kind === "fastlap") return "Fast Lap";
  const game = row.item.game?.short_name || row.item.game?.name || row.item.game_name || "";
  const mode = row.item.team_mode && row.item.team_mode !== "solo" ? "Team" : row.item.team_mode === "solo" ? "Einzel" : "";
  return [game, mode].filter(Boolean).join(" · ");
}

/**
 * Startseite (#1182): ein Event mit seinen Turnieren und Fast Laps ist eine Zeile - die gehören in `children`.
 * Steht das Event nicht in der Liste, bleibt das Turnier für sich.
 */
export function nestUnderEvents(items = []) {
  const events = new Map(items.filter((item) => item.kind === "event" && item.id).map((item) => [item.id, { ...item, children: [] }]));
  const out = [];
  for (const item of items) {
    if (item.kind === "event") {
      out.push(events.get(item.id) || item);
      continue;
    }
    const parent = item.event_id ? events.get(item.event_id) : null;
    if (parent) parent.children.push(item);
    else out.push(item);
  }
  return out;
}
