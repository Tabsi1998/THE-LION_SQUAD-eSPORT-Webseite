import { roundLabel, weekdayShort } from "./seriesFormat";

// Runde mit Läufen in der App (#1930, #1974): Termine mit derselben Runde (`weekend` vom Server, sonst dasselbe
// Kürzel) sind EINE Runde mit mehreren Läufen (Qualifying, Sprint, Rennen …). Dieselben Regeln wie im Web
// (frontend/src/lib/raceWeekend.js): gruppieren, beschriften, Wertung je Lauf, Poles, Ø Start und Quali-Duell. Ein
// Termin ohne Lauf ist ein Rennen - ein älterer Server ohne `session`/`weekend` sieht also aus wie bisher.

export type WeekendRound = {
  id: string;
  position?: number | null;
  code?: string | null;
  title?: string | null;
  venue?: string | null;
  club_day?: string | null;
  time?: string | null;
  state?: string | null;
  kind?: string | null;
  counts?: boolean | null;
  country_code?: string | null;
  /** Lauf des Termins („Qualifying“, „Sprint“ …) - null heißt „Rennen“ (#1930). */
  session?: string | null;
  session_kind?: string | null;
  /** Nummer der Runde (#1930) - Läufe einer Runde teilen sie. */
  weekend?: number | null;
};

export type WeekendSettings = {
  formats?: Array<{
    from_round?: number | null;
    note?: string | null;
    sessions?: Array<{ label?: string | null; counts?: boolean | null; points?: unknown; grid?: string | null; reverse_top?: number | null }> | null;
  }> | null;
} | null | undefined;

function squash(value: unknown): string {
  return String(value ?? "").split(/\s+/).join("").toLowerCase().split("-").join("");
}

/** Art eines Laufs aus dem Namen - wie der Server: `qualifying`, `sprint` oder `race`. */
export function sessionKind(label: unknown): "qualifying" | "sprint" | "race" {
  const key = squash(label);
  if (key.includes("quali") || key.includes("shootout") || key === "q" || key === "zeittraining") return "qualifying";
  if (key.includes("sprint") || key === "s") return "sprint";
  return "race";
}

/** Art des Laufs eines Termins - vom Server, sonst aus dem Namen. */
export function roundKind(round: Pick<WeekendRound, "session" | "session_kind"> | null | undefined): string {
  return round?.session_kind || sessionKind(round?.session);
}

/** Name des Laufs auf einem Chip: „Quali“, „Sprint“, „Rennen“ - ohne Lauf „Rennen“. */
export function chipLabel(round: Pick<WeekendRound, "session"> | null | undefined): string {
  const label = String(round?.session || "").trim();
  if (!label) return "Rennen";
  return label.replace(/qualifying/i, "Quali");
}

const ABBREVIATIONS: Record<string, string> = { qualifying: "Q", quali: "Q", shootout: "SO", sprint: "S", rennen: "R", race: "R", hauptrennen: "HR", feature: "HR" };

/** Kurzform für schmale Stellen: Q, S, R, HR, L1 … - sonst die Anfangsbuchstaben (höchstens drei). */
export function sessionAbbr(round: Pick<WeekendRound, "session" | "session_kind"> | null | undefined): string {
  const label = String(round?.session || "").trim();
  if (!label) return "R";
  const known = ABBREVIATIONS[label.toLowerCase()];
  if (known) return known;
  const heat = /^(lauf|heat)\s*(\d)$/i.exec(label);
  if (heat) return `L${heat[2]}`;
  if (roundKind(round) === "qualifying") return "Q";
  const words = label.split(/[\s-]+/).filter(Boolean);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : label.slice(0, 3)).slice(0, 3).toUpperCase();
}

/** Kürzel mit Lauf: „R1 · Sprint“, ohne Lauf nur „R1“. */
export function sessionLabel(round: Pick<WeekendRound, "session" | "code" | "position"> | null | undefined): string {
  const label = String(round?.session || "").trim();
  const code = roundLabel(round);
  return label ? `${code} · ${label}` : code;
}

function codeKey(code: unknown): string {
  return String(code || "").split(/\s+/).join("").toLowerCase();
}

/** Die Runde eines Termins: die Nummer vom Server, sonst das Kürzel - aber nur mit Läufen. */
export function weekendKey(round: Pick<WeekendRound, "id" | "code" | "weekend"> | null | undefined, byCode = true): string {
  if (round?.weekend) return `w${round.weekend}`;
  const code = codeKey(round?.code);
  return code && byCode ? `c${code}` : `id${round?.id}`;
}

/** Hat die Saison Läufe? Erst dann zeigen Kalender und Tabelle Chips. */
export function hasSessions(rounds: Array<Pick<WeekendRound, "session">> | null | undefined): boolean {
  return (rounds || []).some((round) => String(round?.session || "").trim());
}

const STATE_ORDER = ["today", "missing", "postponed", "planned"];

/** Stand einer Runde aus ihren Läufen: abgesagt nur, wenn alle es sind; gewertet, wenn alle übrigen gewertet sind;
 * sonst der dringendste offene (heute, Ergebnis fehlt, verschoben, geplant). */
export function weekendState(rounds: Array<Pick<WeekendRound, "state">> | null | undefined): string {
  const live = (rounds || []).filter((round) => round.state !== "cancelled");
  if (!live.length) return "cancelled";
  if (live.every((round) => round.state === "scored")) return "scored";
  return STATE_ORDER.find((state) => live.some((round) => round.state === state)) || "planned";
}

export type WeekendGroup<T extends WeekendRound> = {
  key: string;
  /** Nummer der Runde für die Ergebnisseite - nur, wenn der Server sie schickt (#1950). */
  number: number | null;
  rounds: T[];
  lead: T;
  code: string | null | undefined;
  position: number | null | undefined;
  kind: string | null | undefined;
  venue: string | null | undefined;
  title: string | null | undefined;
  country_code: string | null | undefined;
  state: string;
  multi: boolean;
};

/** Die Runden in Kalender-Reihenfolge: je Runde die Läufe und der Termin für Kopf und Ort. */
export function groupWeekends<T extends WeekendRound>(rounds: T[] | null | undefined): Array<WeekendGroup<T>> {
  const groups: Array<{ key: string; rounds: T[] }> = [];
  const byKey = new Map<string, { key: string; rounds: T[] }>();
  const byCode = hasSessions(rounds);
  for (const round of rounds || []) {
    if (!round?.id) continue;
    const key = weekendKey(round, byCode);
    let group = byKey.get(key);
    if (!group) {
      group = { key, rounds: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rounds.push(round);
  }
  return groups.map((group) => {
    const lead = group.rounds[0];
    const place = group.rounds.find((round) => round.venue || round.title || round.country_code) || lead;
    return {
      key: group.key,
      number: Number.isInteger(lead.weekend) && Number(lead.weekend) > 0 ? Number(lead.weekend) : null,
      rounds: group.rounds,
      lead,
      code: lead.code,
      position: lead.position,
      kind: group.rounds.some((round) => round.kind === "final") ? "final" : lead.kind,
      venue: place.venue,
      title: place.title,
      country_code: place.country_code,
      state: weekendState(group.rounds),
      multi: group.rounds.length > 1 || hasSessions(group.rounds),
    };
  });
}

/** Zeit eines Lauf-Chips: „20:00“, an einem anderen Tag als der erste Lauf mit Wochentag („Sa 20:00“). */
export function chipWhen(round: Pick<WeekendRound, "club_day" | "time">, first: Pick<WeekendRound, "club_day"> | null | undefined): string {
  if (!round?.time) return "";
  const other = round.club_day && first?.club_day && round.club_day !== first.club_day;
  return other ? `${weekdayShort(round.club_day)} ${round.time}` : round.time;
}

// ---------------------------------------------------------------- Startaufstellung und Punkte je Lauf

const GRID_WORDS: Record<string, string> = {
  reverse_standings_before_round: "Start in umgekehrter WM-Reihenfolge vor der Runde",
  reverse_standings_after_previous_session: "Start in umgekehrter WM-Reihenfolge nach dem Lauf davor",
  reverse_qualifying: "Start in umgekehrter Quali-Reihenfolge",
  reverse_previous_session: "Start in umgekehrter Reihenfolge des Laufs davor",
};
const GRID_ALIASES: Record<string, string> = { reverse_standings: "reverse_standings_before_round" };
const SESSION_REVERSES = ["reverse_qualifying", "reverse_previous_session"];

/** Eine umgekehrte Startaufstellung in Worten (#1960) - „Start in umgekehrter Quali-Reihenfolge (Top 8)“; leer bei
 * Eingabe und aus dem Qualifying. Wer dort vorn steht, hat Startplatz 1, nicht die Pole. */
export function gridWords(grid: string | null | undefined, top: number | null | undefined = null): string {
  const source = GRID_ALIASES[String(grid)] || String(grid || "");
  const words = GRID_WORDS[source];
  if (!words) return "";
  return SESSION_REVERSES.includes(source) && top ? `${words} (Top ${top})` : words;
}

function fromRound(formats: unknown[], from: number | null | undefined): string {
  return formats.length > 1 && Number(from) > 1 ? `ab Runde ${from} ` : "";
}

/** Startaufstellung je Lauf in Worten: nur umgekehrte - „Sprint: Start in umgekehrter Quali-Reihenfolge (Top 8)“. */
export function sessionGridLines(weekend: WeekendSettings): string[] {
  const formats = weekend?.formats || [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const format of formats) {
    for (const session of format?.sessions || []) {
      const words = gridWords(session?.grid, session?.reverse_top);
      if (!words) continue;
      const key = `${String(session?.label).toLowerCase()}|${words}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`${fromRound(formats, format?.from_round)}${session?.label}: ${words}`);
    }
  }
  return lines;
}

/** Punkte je Lauf in Worten: „Sprint: 12 · 9 · 7“ oder „Quali: keine Punkte“ - nur zählende Läufe mit eigener Vorgabe. */
export function sessionPointsLines(weekend: WeekendSettings): string[] {
  const formats = weekend?.formats || [];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const format of formats) {
    for (const session of format?.sessions || []) {
      if (session?.counts === false) continue;
      const text = Array.isArray(session?.points)
        ? session.points.map((value) => String(value).replace(".", ",")).join(" · ")
        : session?.points === "none" ? "keine Punkte" : "";
      const key = `${String(session?.label).toLowerCase()}|${text}`;
      if (!text || seen.has(key)) continue;
      seen.add(key);
      lines.push(`${fromRound(formats, format?.from_round)}${session?.label}: ${text}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------- Wertung je Lauf

type TableResult = { round_id?: string; place?: number | null; points?: number | null; dropped?: boolean };
type TableRow = { key?: string | null; name?: string | null; rank?: number | null; points?: number | null; results?: TableResult[] | null };

const TABLE_KINDS: Array<[string, string]> = [["race", "Rennen"], ["sprint", "Sprint"], ["qualifying", "Quali"]];

function countback(results: TableResult[]): number[] {
  const places = results.map((item) => Number(item.place)).filter((place) => Number.isInteger(place) && place > 0);
  const top = Math.max(0, ...places);
  return Array.from({ length: top }, (_, index) => places.filter((place) => place === index + 1).length);
}

type Ranked<R> = R & { points: number; _countback: number[] };

function ahead<R>(a: Ranked<R>, b: Ranked<R>): number {
  if (a.points !== b.points) return b.points - a.points;
  for (let index = 0; index < Math.max(a._countback.length, b._countback.length); index += 1) {
    const diff = (b._countback[index] || 0) - (a._countback[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

export type SessionTable<R> = { kind: string; label: string; rounds: WeekendRound[]; rows: R[] };

/** Wertung je Lauf (#1930): je Art mit zählenden Läufen (Rennen, Sprint, Quali) die Punkte nur aus diesen Läufen - Rang
 * nach Punkten, dann mehr Siege, zweite Plätze …; sonst geteilter Platz. Erst ab zwei Arten - sonst ist die
 * Gesamtwertung schon die Tabelle. Anpassungen (#1960) gehören zur Gesamtwertung, nicht hierher. */
export function sessionTables<R extends TableRow>(rows: R[] | null | undefined, rounds: WeekendRound[] | null | undefined): Array<SessionTable<R>> {
  const counting = (rounds || []).filter((round) => round.kind !== "final" && round.counts !== false);
  const present = TABLE_KINDS.filter(([kind]) => counting.some((round) => roundKind(round) === kind));
  if (present.length < 2) return [];
  return present.map(([kind, label]) => {
    const own = counting.filter((round) => roundKind(round) === kind);
    const ids = new Set(own.map((round) => round.id));
    const list = (rows || []).map((row) => {
      const results = (row.results || []).filter((item) => ids.has(String(item.round_id)));
      const points = results.reduce((sum, item) => sum + (Number(item.points) || 0), 0);
      return {
        ...row, results: results.map((item) => ({ ...item, dropped: false })), points, adjustments: [], adjustment_points: 0,
        _countback: countback(results), _has: results.length > 0,
      };
    }).filter((row) => row._has);
    list.sort((a, b) => ahead(a, b) || String(a.name || "").localeCompare(String(b.name || ""), "de"));
    const ranked = list.map((row, index) => ({ ...row, rank: index + 1 }));
    ranked.forEach((row, index) => {
      if (index > 0 && ahead(list[index - 1], list[index]) === 0) row.rank = ranked[index - 1].rank;
    });
    const clean = ranked.map(({ _countback, _has, ...row }) => row as unknown as R);
    return { kind, label, rounds: own, rows: clean };
  });
}

// ---------------------------------------------------------------- Fahrer-Detail

export type QualifyingEntry = { round_id?: string | null; places?: Record<string, number | null | undefined> | null; pole?: string | null };

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Ø Startplatz über die Rennen mit Startplatz - `null` ohne. */
export function averageGrid(results: Array<{ grid?: number | null }> | null | undefined): number | null {
  const grids = (results || []).map((item) => finite(item?.grid)).filter((grid): grid is number => grid !== null);
  if (!grids.length) return null;
  return grids.reduce((sum, grid) => sum + grid, 0) / grids.length;
}

/** „Ø Start 4,5“ (eine Nachkommastelle, ganze ohne). */
export function averageGridLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const rounded = Math.round(value * 10) / 10;
  return `Ø Start ${String(rounded).replace(".", ",")}`;
}

/** Poles eines Fahrers: je Runde höchstens eine - aus der Pole am Rennen und der Pole im Qualifying (vom Server). */
export function poleCount(
  row: { key?: string | null; results?: Array<{ round_id?: string; marks?: string[] | null }> | null } | null | undefined,
  rounds: WeekendRound[] | null | undefined,
  qualifying: QualifyingEntry[] | null | undefined,
): number {
  const byCode = hasSessions(rounds);
  const weekendOf = new Map((rounds || []).map((round) => [round.id, weekendKey(round, byCode)]));
  const seen = new Set<string>();
  for (const item of row?.results || []) {
    if ((item.marks || []).includes("pole")) seen.add(weekendOf.get(String(item.round_id)) || String(item.round_id));
  }
  for (const quali of qualifying || []) {
    if (quali?.pole && quali.pole === row?.key) seen.add(weekendOf.get(String(quali.round_id)) || String(quali.round_id));
  }
  return seen.size;
}

/** Quali-Duell zweier Fahrer: in wie vielen gemeinsamen Qualifyings wer vorn lag. */
export function qualiDuel(aKey: string, bKey: string, qualifying: QualifyingEntry[] | null | undefined): { sessions: number; a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const quali of qualifying || []) {
    const mine = finite(quali?.places?.[aKey]);
    const theirs = finite(quali?.places?.[bKey]);
    if (!mine || !theirs) continue;
    if (mine < theirs) a += 1;
    else b += 1;
  }
  return { sessions: a + b, a, b };
}
