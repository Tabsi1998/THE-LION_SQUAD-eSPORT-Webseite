import { compareByNearestDate } from "./contentSort";
import { asInstant } from "./vienna";

// Das Event als Klammer (#1182): Turniere und Fast Laps, die zu einem Event gehören, stehen in seiner Karte (Fabians
// Variante A, aufklappbar) - nicht noch einmal einzeln. Wer will, schaltet „zusätzlich einzeln“ an (letzte Wahl am
// Gerät). „Nur meine“ (#1189) behält, wofür man selbst oder das eigene Team dabei ist - in einer Event-Karte auch nur
// diese Turniere. Dieselbe Rechnung wie im Web (frontend/src/lib/eventGroups.js).

export type GroupKind = "event" | "tournament" | "fastlap";
export type GroupFilter = "all" | "events" | "tournaments" | "fastlaps";
export type ListMode = "nested" | "separate";
export type OwnState = { state?: string | null; label?: string | null; team_name?: string | null };
/** Antwort von `GET /api/calendar/mine`: je Art Kennung → eigener Stand. */
export type MineMap = { events?: Record<string, OwnState>; tournaments?: Record<string, OwnState>; fastlaps?: Record<string, OwnState> } | null;

type Doc = {
  id: string;
  event_id?: string | null;
  start_date?: string | null;
  date?: string | null;
  status?: string | null;
  public_phase?: { label?: string | null } | null;
};

export type GroupRow<T extends Doc = Doc> = { kind: GroupKind; key: string; item: T; mine: OwnState | null; event: Doc | null };
export type GroupCard<T extends Doc = Doc> = GroupRow<T> & { children: GroupRow<T>[] };

export const LIST_MODE_KEY = "tls_events_list_mode";
const MINE_GROUP: Record<GroupKind, "events" | "tournaments" | "fastlaps"> = { event: "events", tournament: "tournaments", fastlap: "fastlaps" };

export function listMode(stored: string | null | undefined): ListMode {
  return stored === "separate" ? "separate" : "nested";
}

export function mineState(mine: MineMap, kind: GroupKind, id: string): OwnState | null {
  return mine?.[MINE_GROUP[kind]]?.[id] || null;
}

function startOf(item: Doc): string | null {
  return item.start_date || item.date || null;
}

function byDate(a: GroupRow, b: GroupRow): number {
  return compareByNearestDate(startOf(a.item), startOf(b.item), a.item.status, b.item.status, a.item.public_phase?.label, b.item.public_phase?.label);
}

// In der Event-Karte zählt der Ablauf: nach Beginn, ohne Datum zuletzt.
function byStart(a: GroupRow, b: GroupRow): number {
  const at = startOf(a.item) ? asInstant(startOf(a.item) as string).getTime() : Number.MAX_SAFE_INTEGER;
  const bt = startOf(b.item) ? asInstant(startOf(b.item) as string).getTime() : Number.MAX_SAFE_INTEGER;
  return at - bt;
}

/**
 * Karten für die Liste: Events mit ihren Turnieren und Fast Laps, dazu, was zu keinem gezeigten Event gehört.
 * „events“ zeigt nur Event-Karten, „tournaments“ und „fastlaps“ alle einzeln (mit Hinweis aufs Event).
 */
export function buildCards<E extends Doc, T extends Doc = E, F extends Doc = E>(
  data: { events?: E[]; tournaments?: T[]; fastlaps?: F[] },
  { mode = "nested", filter = "all", onlyMine = false, mine = null }: { mode?: ListMode; filter?: GroupFilter; onlyMine?: boolean; mine?: MineMap } = {},
): GroupCard<E | T | F>[] {
  type Any = E | T | F;
  const events = (data.events || []).filter((event) => event?.id);
  const eventById = new Map(events.map((event) => [event.id, event]));
  const children = new Map<string, GroupRow<Any>[]>();
  const loose: GroupRow<Any>[] = [];
  const add = (kind: GroupKind, item: Any) => {
    if (!item?.id) return;
    const parent = item.event_id ? eventById.get(item.event_id) || null : null;
    const row: GroupRow<Any> = { kind, key: `${kind}-${item.id}`, item, mine: mineState(mine, kind, item.id), event: parent };
    if (parent) {
      children.set(parent.id, [...(children.get(parent.id) || []), row]);
      if (mode === "separate" || filter === "tournaments" || filter === "fastlaps") loose.push(row);
    } else {
      loose.push(row);
    }
  };
  (data.tournaments || []).forEach((item) => add("tournament", item));
  (data.fastlaps || []).forEach((item) => add("fastlap", item));

  const eventCards: GroupCard<Any>[] = events.map((event) => {
    const rows = (children.get(event.id) || []).slice().sort(byStart);
    return { kind: "event", key: `event-${event.id}`, item: event, mine: mineState(mine, "event", event.id), event: null, children: onlyMine ? rows.filter((row) => row.mine) : rows };
  });
  const singles: GroupCard<Any>[] = loose.map((row) => ({ ...row, children: [] }));

  let cards: GroupCard<Any>[];
  if (filter === "events") cards = eventCards;
  else if (filter === "tournaments") cards = singles.filter((row) => row.kind === "tournament");
  else if (filter === "fastlaps") cards = singles.filter((row) => row.kind === "fastlap");
  else cards = [...eventCards, ...singles];

  if (onlyMine) cards = cards.filter((card) => card.mine || (card.kind === "event" && card.children.length > 0));
  return cards.sort(byDate);
}

/** Zusammenfassung einer Event-Karte: „2 Turniere · 1 Fast Lap“. */
export function childSummary(rows: Array<{ kind: GroupKind }> = []): string {
  const tournaments = rows.filter((row) => row.kind === "tournament").length;
  const fastlaps = rows.filter((row) => row.kind === "fastlap").length;
  return [
    tournaments ? `${tournaments} ${tournaments === 1 ? "Turnier" : "Turniere"}` : "",
    fastlaps ? `${fastlaps} ${fastlaps === 1 ? "Fast Lap" : "Fast Laps"}` : "",
  ].filter(Boolean).join(" · ");
}

/** Der eigene Stand als Text: „Du bist dabei · Lions Rocket“. */
export function ownLabel(state: OwnState | null | undefined): string | null {
  if (!state) return null;
  return [state.label || "Dabei", state.team_name].filter(Boolean).join(" · ");
}

/**
 * Startseite (#1182): ein Event mit seinen Turnieren ist eine Karte - die Turniere stehen in `children`. Steht das
 * Event nicht in der Liste, bleibt das Turnier für sich.
 */
export function nestUnderEvents<T extends { kind: string; id: string; eventId?: string | null }>(items: T[]): Array<T & { children: T[] }> {
  const events = new Map<string, T & { children: T[] }>();
  for (const item of items) if (item.kind === "event" && item.id) events.set(item.id, { ...item, children: [] });
  const out: Array<T & { children: T[] }> = [];
  for (const item of items) {
    if (item.kind === "event") {
      out.push(events.get(item.id) || { ...item, children: [] });
      continue;
    }
    const parent = item.eventId ? events.get(item.eventId) : undefined;
    if (parent) parent.children.push(item);
    else out.push({ ...item, children: [] });
  }
  return out;
}

/** Spielart einer Zeile: Spiel und Einzel/Team beim Turnier, „Fast Lap“ bei der Fast Lap. */
export function playLabel(kind: GroupKind, item: { game?: { display_name?: string; name?: string } | null; game_name?: string | null; team_mode?: string | null }): string {
  if (kind === "fastlap") return "Fast Lap";
  const game = item.game?.display_name || item.game?.name || item.game_name || "";
  const mode = item.team_mode ? (item.team_mode === "solo" ? "Einzel" : "Team") : "";
  return [game, mode].filter(Boolean).join(" · ");
}
