import { countryName } from "./countryFlags";
import { formatRaceTime } from "./raceTime";
import { dayLabel, formatNumber, nameOf } from "./seriesFormat";

// Ergebnisseite einer Runde in der App (#1950, #1974): was der Screen aus
// /api/reference-series/public/<spur>/<saison>/rounds/<nr> und …/statistics macht - dieselben Regeln wie im Web
// (frontend/src/lib/roundResults.js, countUp.js, seasonStatistics.js). Der Server rechnet; hier wird nur gewählt
// (Reiter), beschriftet (Platz, Abzeichen, Zeiten mit Komma) und die Zusammenfassung gebaut. Außerhalb der Tabelle
// stehen mit Namen nur öffentliche Vereinsfahrer (`club_drivers`), sonst das Team. Jedes Feld kann fehlen.

export type RoundRow = {
  key: string;
  place?: number | null;
  status?: string | null;
  name?: string | null;
  name_hidden?: boolean | null;
  club_member?: boolean | null;
  profile_slug?: string | null;
  own?: boolean | null;
  start_number?: string | null;
  team?: string | null;
  team_color?: string | null;
  grid?: number | null;
  gained?: number | null;
  time?: string | null;
  gap?: string | null;
  penalty_seconds?: number | null;
  points?: number | null;
  marks?: string[] | null;
  fastest_lap?: boolean | null;
  fastest_lap_time?: string | null;
  driver_of_the_day?: boolean | null;
};

export type RoundSession = {
  id?: string;
  key: string;
  session?: string | null;
  label: string;
  kind?: string | null;
  state?: string | null;
  club_day?: string | null;
  time?: string | null;
  counts?: boolean | null;
  has_result?: boolean | null;
  columns?: string[] | null;
  rows?: RoundRow[] | null;
  pole?: { key?: string | null; time?: string | null } | null;
  best_club?: string | null;
  no_score_reason?: string | null;
  no_score_note?: string | null;
  grid_source?: string | null;
  reverse_top?: number | null;
};

export type RoundInfo = {
  number?: number | null;
  total?: number | null;
  code?: string | null;
  title?: string | null;
  venue?: string | null;
  country_code?: string | null;
  club_day?: string | null;
  kind?: string | null;
  cancelled?: boolean | null;
  scored?: boolean | null;
};

export type Neighbour = { number?: number | null; code?: string | null; title?: string | null; venue?: string | null; country_code?: string | null } | null;

type SummaryEntry = { key?: string | null; session?: string | null; grid?: number | null; time?: string | null } | null;

/** Die Antwort der Rundenseite - jedes Feld kann fehlen. */
export type RoundPage = {
  lineage?: { title?: string | null; slug?: string | null; kind?: string | null; game_name?: string | null } | null;
  series?: { season?: string | null; tier?: string | null; title?: string | null; season_slug?: string | null; status?: string | null; cancelled_on?: string | null; cancel_reason?: string | null } | null;
  own_teams?: string[] | null;
  round?: RoundInfo | null;
  previous?: Neighbour;
  next?: Neighbour;
  sessions?: RoundSession[] | null;
  main?: string | null;
  summary?: { winner?: SummaryEntry; pole?: SummaryEntry; fastest_lap?: SummaryEntry; driver_of_the_day?: SummaryEntry } | null;
  club_drivers?: string[] | null;
};

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** Schlüssel eines Laufs für die Adresse - wie im Server: „Qualifying“ → `qualifying`, „Lauf 1“ → `lauf-1`. */
export function sessionKey(label: unknown): string {
  const text = String(label ?? "").split(/\s+/).filter(Boolean).join(" ").toLowerCase() || "rennen";
  let out = "";
  let dash = false;
  for (const raw of text) {
    const char = UMLAUTS[raw] || raw;
    if (/^[a-z0-9]+$/.test(char)) {
      out += char;
      dash = false;
    } else if (out && !dash) {
      out += "-";
      dash = true;
    }
  }
  return out.replace(/-+$/, "") || "rennen";
}

/** Adresse einer Runde im Web (für „Im Web öffnen“), optional mit Lauf (`?lauf=sprint`). */
export function roundWebPath(lineage: string, season: string, number: number | string, session = ""): string {
  if (!lineage || !season || !number) return "";
  const base = `/references/series/${encodeURIComponent(lineage)}/${encodeURIComponent(season)}/runde/${number}`;
  return session ? `${base}?lauf=${encodeURIComponent(session)}` : base;
}

/** Der gezeigte Lauf: der gewählte, sonst das Hauptrennen, sonst der erste. */
export function pickSession(page: RoundPage | null | undefined, wanted: string | null | undefined): RoundSession | null {
  const sessions = (page?.sessions || []).filter((item) => item?.key);
  return sessions.find((item) => item.key === wanted) || sessions.find((item) => item.key === page?.main) || sessions[0] || null;
}

const STATUS_SHORT: Record<string, string> = { dnf: "DNF", dns: "DNS", dsq: "DSQ" };
const STATUS_WORD: Record<string, string> = { dnf: "Ausfall", dns: "Nicht gestartet", dsq: "Disqualifiziert" };

/** Platz in der ersten Spalte: die Zahl, sonst DNF, DNS oder DSQ. */
export function posLabel(row: RoundRow | null | undefined): string {
  if (row?.status && row.status !== "finished") return STATUS_SHORT[row.status] || "–";
  return row?.place ? String(row.place) : "–";
}

/** Gold, Silber, Bronze für Platz 1 bis 3 im Ziel. */
export function medalOf(row: RoundRow | null | undefined): 1 | 2 | 3 | null {
  if (row?.status && row.status !== "finished") return null;
  const place = row?.place;
  return place === 1 || place === 2 || place === 3 ? place : null;
}

/** Strafsekunden: „+5 s“. */
export function penaltyLabel(seconds: unknown): string {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? `+${formatNumber(value)} s` : "";
}

export type Badge = { key: "pole" | "fastest_lap" | "driver_of_the_day" | "dnf" | "dsq" | "penalty"; label: string; short: string };

/** Abzeichen einer Zeile am Handy: Pole, Beste Runde, Fahrer des Tages, DNF, DSQ und die Strafe. */
export function rowBadges(row: RoundRow | null | undefined): Badge[] {
  const marks = new Set(row?.marks || []);
  const out: Badge[] = [];
  if (marks.has("pole")) out.push({ key: "pole", label: "Pole", short: "Pole" });
  if (row?.fastest_lap) out.push({ key: "fastest_lap", label: "Schnellste Runde", short: "Beste Runde" });
  if (row?.driver_of_the_day) out.push({ key: "driver_of_the_day", label: "Fahrer des Tages", short: "Fahrer des Tages" });
  if (row?.status === "dnf") out.push({ key: "dnf", label: "Ausfall", short: "DNF" });
  if (row?.status === "dsq") out.push({ key: "dsq", label: "Disqualifiziert", short: "DSQ" });
  const penalty = penaltyLabel(row?.penalty_seconds);
  if (penalty) out.push({ key: "penalty", label: `${penalty} Strafe`, short: `${penalty} Strafe` });
  return out;
}

/** Start → Ziel in Worten: „3 Plätze gutgemacht“, „1 Platz verloren“ - leer ohne Startplatz oder bei gleichem Platz. */
export function movementLabel(row: RoundRow | null | undefined): string {
  const gained = Number(row?.gained);
  if (row?.gained === null || row?.gained === undefined || !Number.isFinite(gained) || gained === 0) return "";
  const by = Math.abs(gained);
  return `${by} ${by === 1 ? "Platz" : "Plätze"} ${gained > 0 ? "gutgemacht" : "verloren"}`;
}

/** Rechts groß: die gefahrene Zeit, sonst der Abstand bzw. das Wort für den Ausfall. Zeiten mit Komma (#1981). */
export function mobileMain(row: RoundRow | null | undefined): string {
  return formatRaceTime(row?.time) || formatRaceTime(row?.gap) || (row?.status && row.status !== "finished" ? STATUS_WORD[row.status] || "" : "") || "–";
}

/** Darunter klein: der Abstand (wenn auch eine Zeit dasteht) und die Punkte („15 P“). */
export function mobileSub(row: RoundRow | null | undefined, { points = false }: { points?: boolean } = {}): string {
  const parts: string[] = [];
  if (formatRaceTime(row?.time) && formatRaceTime(row?.gap)) parts.push(formatRaceTime(row?.gap));
  if (points && row?.points !== null && row?.points !== undefined) parts.push(`${formatNumber(row.points)} P`);
  return parts.join(" · ");
}

/** Zeigt der Lauf Zeiten bzw. Punkte? (Spalten vom Server - nur, was in einer Zeile steht.) */
export function sessionShows(session: RoundSession | null | undefined): { times: boolean; points: boolean; number: boolean } {
  const columns = new Set(session?.columns || []);
  return { times: columns.has("time") || columns.has("gap"), points: columns.has("points"), number: columns.has("start_number") };
}

function findRow(page: RoundPage | null | undefined, key: string, wanted: string | null | undefined): RoundRow | null {
  const sessions = page?.sessions || [];
  const ordered = [...sessions.filter((item) => item.key === wanted), ...sessions];
  for (const session of ordered) {
    const row = (session.rows || []).find((item) => item.key === key);
    if (row) return row;
  }
  return null;
}

export type PersonLine = { value: string; team: string; color: string | null; named: boolean; profile: string | null };

/** Wer außerhalb der Tabelle steht: ein öffentlicher Vereinsfahrer mit Namen, sonst sein Team (ohne Team: Nummer). */
export function personLine(row: RoundRow | null | undefined, publicKeys: string[] | null | undefined = []): PersonLine | null {
  if (!row) return null;
  const named = (publicKeys || []).includes(row.key) && !row.name_hidden && row.name;
  if (named) return { value: nameOf(row), team: row.team || "", color: row.team_color || null, named: true, profile: row.profile_slug || null };
  const value = row.team || (row.start_number ? `Nr. ${row.start_number}` : "–");
  return { value, team: "", color: row.team ? row.team_color || null : null, named: false, profile: null };
}

export type SummaryCard = PersonLine & { key: string; label: string; sub?: string; count?: string };

/** Die Zusammenfassung oben: Sieger, Pole, schnellste Runde, Fahrer des Tages und - je Reiter - der beste Vereinsfahrer.
 * Karten ohne Daten fallen weg. Zeiten zählen hoch (`count`). */
export function summaryCards(page: RoundPage | null | undefined, session: RoundSession | null | undefined): SummaryCard[] {
  const summary = page?.summary || {};
  const publicKeys = page?.club_drivers || [];
  const cards: SummaryCard[] = [];
  const add = (key: string, label: string, entry: SummaryEntry | undefined, build: (row: RoundRow | null, person: PersonLine) => { sub?: string; count?: string }) => {
    if (!entry?.key) return;
    const row = findRow(page, entry.key, entry.session);
    const person = personLine(row, publicKeys);
    if (person) cards.push({ key, label, ...person, ...build(row, person) });
  };
  add("winner", "Sieger", summary.winner, (row, person) => ({
    sub: [person.named ? person.team : "", row?.grid ? `von Startplatz ${row.grid}` : ""].filter(Boolean).join(" · "),
  }));
  add("pole", "Pole", summary.pole, () => ({ count: formatRaceTime(summary.pole?.time) }));
  add("fastest_lap", "Schnellste Runde", summary.fastest_lap, () => ({ count: formatRaceTime(summary.fastest_lap?.time) }));
  add("driver_of_the_day", "Fahrer des Tages", summary.driver_of_the_day, (_row, person) => ({ sub: person.named ? person.team : "" }));
  const best = session?.best_club ? (session.rows || []).find((row) => row.key === session.best_club) : null;
  if (best) {
    const multi = (page?.sessions || []).filter((item) => item.has_result).length > 1;
    const points = best.points !== null && best.points !== undefined ? `${formatNumber(best.points)} ${Number(best.points) === 1 ? "Punkt" : "Punkte"}` : "";
    cards.push({
      key: "best_club",
      label: multi ? `Bester Vereinsfahrer · ${session?.label}` : "Bester Vereinsfahrer",
      value: `${nameOf(best)} · ${best.status === "finished" && best.place ? `P${best.place}` : posLabel(best)}`,
      team: best.team || "",
      color: best.team_color || null,
      named: true,
      profile: best.profile_slug || null,
      sub: [best.team, points].filter(Boolean).join(" · "),
    });
  }
  return cards;
}

/** Kopf: Name der Runde (Land, sonst Titel bzw. Ort), darunter Titel bzw. Ort, wenn sie etwas anderes sagen. */
export function roundHeading(round: RoundInfo | null | undefined): { heading: string; sub: string } {
  const country = countryName(round?.country_code);
  const title = String(round?.title || "").trim();
  const venue = String(round?.venue || "").trim();
  const heading = country || title || venue || round?.code || `Runde ${round?.number || ""}`.trim();
  const sub = [title, venue].filter((part, index, list) => part && part !== heading && list.indexOf(part) === index).join(" · ");
  return { heading, sub };
}

/** Zeile über dem Namen: „Runde 1 von 24 · Do., 08.10.2026“. */
export function roundEyebrow(round: RoundInfo | null | undefined): string {
  const position = round?.number ? `Runde ${round.number}${round.total ? ` von ${round.total}` : ""}` : "";
  return [position, dayLabel(round?.club_day)].filter(Boolean).join(" · ");
}

/** Eine Zeile unter dem Namen: „R1 · Do., 08.10.2026 · Baku City Circuit“. */
export function roundSubline(round: RoundInfo | null | undefined, sub = ""): string {
  return [round?.code || (round?.number ? `R${round.number}` : ""), dayLabel(round?.club_day), sub].filter(Boolean).join(" · ");
}

/** Vorige bzw. nächste Runde: „R2 Singapur“. */
export function neighbourLabel(item: Neighbour | undefined): string {
  if (!item) return "";
  const place = countryName(item.country_code) || item.title || item.venue || "";
  return [item.code || `Runde ${item.number}`, place].filter(Boolean).join(" ");
}

/** Was im Reiter steht, wenn es (noch) kein Ergebnis gibt. */
export function emptyText(session: Pick<RoundSession, "label" | "state" | "club_day" | "time"> & { key?: string } | null | undefined): string {
  if (!session) return "Für diese Runde gibt es noch keine Läufe.";
  if (session.state === "cancelled") return `${session.label} abgesagt.`;
  const when = [dayLabel(session.club_day), session.time ? `${session.time} Uhr` : ""].filter(Boolean).join(", ");
  if (session.state === "missing") return `Ergebnis folgt – ${session.label}${when ? ` am ${when}` : ""}.`;
  return `Noch kein Ergebnis – ${session.label}${when ? ` am ${when}` : ""}.`;
}

// ---------------------------------------------------------------- Hochzählen (wie lib/countUp.js im Web)

export const COUNT_UP_MS = 900;
export const COUNT_UP_STAGGER_MS = 25;
export const COUNT_UP_MAX_ROWS = 24;

const BODY = /^\d+(?::\d{2}){0,2}(?:[.,]\d{1,6})?$/;

export type CountShape = { text: string; sign: string; separator: string; widths: number[]; fraction: number; total: number };

/** Die Form einer Zeit zum Hochzählen („31:55,056“) - `null` für Wörter, Null und alles andere. */
export function countShape(value: unknown): CountShape | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const sign = text[0] === "+" || text[0] === "-" || text[0] === "−" ? text[0] : "";
  const body = text.slice(sign.length);
  if (!BODY.test(body)) return null;
  const separator = body.includes(",") ? "," : body.includes(".") ? "." : "";
  const [whole, fraction = ""] = separator ? body.split(separator) : [body, ""];
  const parts = whole.split(":");
  const scale = 10 ** fraction.length;
  let units = 0;
  for (const part of parts) units = units * 60 + Number(part);
  // Ohne Doppelpunkt ist der ganze Teil keine Uhr: 95,5 Sekunden bleiben 95,5.
  const total = (parts.length > 1 ? units : Number(whole)) * scale + Number(fraction || 0);
  if (!total) return null;
  return { text, sign, separator, widths: parts.map((part) => part.length), fraction: fraction.length, total };
}

/** Ein Zwischenstand in derselben Form (gleiche Stellen, gleiches Trennzeichen). */
export function formatShape(shape: CountShape, amount: number): string {
  "worklet";
  const scale = 10 ** shape.fraction;
  const whole = Math.floor(amount / scale);
  const fractionText = shape.fraction ? `${shape.separator}${String(amount % scale).padStart(shape.fraction, "0")}` : "";
  const values: number[] = [];
  let rest = whole;
  for (let index = shape.widths.length - 1; index > 0; index -= 1) {
    values.unshift(rest % 60);
    rest = Math.floor(rest / 60);
  }
  values.unshift(rest);
  const wholeText = values.map((value, index) => String(value).padStart(shape.widths[index], "0")).join(":");
  return `${shape.sign}${wholeText}${fractionText}`;
}

/** Ruhig auslaufend wie im Web. */
export function easeOutCubic(t: number): number {
  "worklet";
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - (1 - t) ** 3;
}

/** Der Text bei `progress` (0 bis 1) - am Ende genau der Wert vom Server. */
export function countFrame(shape: CountShape | null, progress: number): string {
  "worklet";
  if (!shape) return "";
  if (progress >= 1) return shape.text;
  return formatShape(shape, Math.round(shape.total * easeOutCubic(progress)));
}

/** Versatz je Zeile: 25 ms, höchstens 24 Stufen. */
export function countDelay(index: number): number {
  return Math.min(Math.max(0, index), COUNT_UP_MAX_ROWS) * COUNT_UP_STAGGER_MS;
}

/** Nur die ersten 24 Zeilen zählen hoch - weiter unten steht der Wert gleich da (spart Animationen bei großen Feldern). */
export function countsUp(index: number): boolean {
  return index >= 0 && index < COUNT_UP_MAX_ROWS;
}

// ---------------------------------------------------------------- Statistik der Saison

export type StatRow = {
  key?: string | null;
  name?: string | null;
  name_hidden?: boolean | null;
  club_member?: boolean | null;
  profile_slug?: string | null;
  team?: string | null;
  own?: boolean | null;
  [metric: string]: unknown;
};

export type StatisticsPage = RoundPage & { drivers?: StatRow[] | null; teams?: StatRow[] | null; metrics?: { drivers?: string[] | null; teams?: string[] | null } | null };

export const METRICS: Record<string, { column: string; title: string; order: "high" | "low" }> = {
  wins: { column: "Siege", title: "Meiste Siege", order: "high" },
  podiums: { column: "Podien", title: "Meiste Podien", order: "high" },
  poles: { column: "Poles", title: "Meiste Poles", order: "high" },
  fastest_laps: { column: "SR", title: "Meiste schnellste Runden", order: "high" },
  driver_of_the_day: { column: "FdT", title: "Meiste Fahrer des Tages", order: "high" },
  dnfs: { column: "Ausf.", title: "Meiste Ausfälle", order: "high" },
  avg_grid: { column: "Ø Start", title: "Bester Ø Startplatz", order: "low" },
  avg_finish: { column: "Ø Ziel", title: "Bester Ø Zielplatz", order: "low" },
  gained: { column: "+/−", title: "Meiste gutgemachte Plätze", order: "high" },
};

/** Kennzahlen, die die App kennt - in der Reihenfolge des Servers. */
export function knownMetrics(list: string[] | null | undefined): string[] {
  return (list || []).filter((metric) => METRICS[metric]);
}

export function hasValue(row: StatRow | null | undefined, metric: string): boolean {
  const value = row?.[metric];
  return value !== null && value !== undefined && value !== 0;
}

/** Wert einer Kennzahl: „4,5“, „+3“, „−2“ - ohne Wert „–“. */
export function metricText(row: StatRow | null | undefined, metric: string): string {
  if (!hasValue(row, metric)) return "–";
  const value = Number(row?.[metric]);
  if (metric === "gained") return value > 0 ? `+${formatNumber(value)}` : `−${formatNumber(Math.abs(value))}`;
  return formatNumber(value);
}

const statLabel = (row: StatRow) => String(row.team || nameOf(row)).toLowerCase();

/** Rangliste je Kennzahl: gleiche Werte teilen den Platz; Zeilen ohne Wert ohne Platz am Ende. */
export function rankBy(rows: StatRow[] | null | undefined, metric: string): Array<{ row: StatRow; rank: number | null }> {
  const order = METRICS[metric]?.order === "low" ? 1 : -1;
  const ranked = (rows || []).filter((row) => hasValue(row, metric))
    .sort((a, b) => order * (Number(a[metric]) - Number(b[metric])) || statLabel(a).localeCompare(statLabel(b), "de"));
  let rank = 0;
  const out = ranked.map((row, index) => {
    if (index === 0 || Number(ranked[index - 1][metric]) !== Number(row[metric])) rank = index + 1;
    return { row, rank: rank as number | null };
  });
  const rest = (rows || []).filter((row) => !hasValue(row, metric))
    .sort((a, b) => statLabel(a).localeCompare(statLabel(b), "de"))
    .map((row) => ({ row, rank: null as number | null }));
  return [...out, ...rest];
}

/** Die ersten drei je Kennzahl. */
export function leaders(rows: StatRow[] | null | undefined, metric: string, top = 3): Array<{ row: StatRow; rank: number | null }> {
  return rankBy(rows, metric).filter((entry) => entry.rank !== null).slice(0, top);
}
