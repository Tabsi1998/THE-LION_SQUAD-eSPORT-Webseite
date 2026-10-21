import { countryCode, countryName } from "./countryFlags";
import { formatRaceTime } from "./raceTime";
import { dayNoon, viennaDate } from "./vienna";
import { KIND_LABELS, type LineageInfo } from "./references";

// Saison einer Serie in der App (#1945, nur lesen): was der Screen aus /api/reference-series/public/<spur>/<saison>
// liest - dieselben Regeln wie die Serienseite im Web (frontend/src/lib/racingLeague.js, teamLeague.js,
// referenceCalendar.js, referenceSeriesTable.js). Der Server rechnet und speichert alles; hier wird nur beschriftet.
// Fremde Namen stehen nur in Tabellen. Außerhalb der Tabellen nennt die App nur öffentliche Vereinsfahrer
// (`racing.club_drivers` vom Server). Fehlt ein Teil (alter Server), bleibt der Abschnitt leer - nie ein Absturz.
// Mit #1949: Land je Termin (#1925), mehrere eigene Teams (#1926) und das Rennergebnis mit Startplatz, Zeit, Abstand,
// schnellster Runde und Fahrer des Tages (#1927) - jeweils nur, wenn der Server es schickt.

export type SeasonRound = {
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
  opponent?: string | null;
  original_club_day?: string | null;
  /** Land des Termins (ISO 3166-1 alpha-2) - kommt mit #1925; ältere Server schicken es nicht. */
  country_code?: string | null;
};
export type RoundResult = {
  round_id?: string; place?: number | null; points?: number | null; marks?: string[] | null; counted?: boolean; dropped?: boolean;
  // Rennergebnis (#1927), nur wo eingetragen.
  start_number?: string | null; grid?: number | null; time?: string | null; gap?: string | null; fastest_lap_time?: string | null; driver_of_the_day?: boolean | null;
};
export type StandingRow = {
  key?: string | null;
  rank?: number | null;
  points?: number | null;
  name?: string | null;
  name_hidden?: boolean | null;
  club_member?: boolean | null;
  profile_slug?: string | null;
  results?: RoundResult[] | null;
};
type Match = { team?: string | null; opponent?: string | null; home?: boolean | null; outcome?: string | null; score_for?: number | null; score_against?: number | null; points?: number | null; maps?: Array<{ name?: string | null; score_for?: number | null; score_against?: number | null; outcome?: string | null }> | null };
type TableRow = { key?: string | null; team?: string | null; rank?: number | null; points?: number | null; played?: number | null; won?: number | null; drawn?: number | null; lost?: number | null; own?: boolean | null };

/** Die Antwort der Serienseite - jedes Feld kann fehlen. */
export type SeasonPage = {
  lineage?: LineageInfo | null;
  series?: { season?: string | null; tier?: string | null; title?: string | null; season_slug?: string | null; status?: string | null } | null;
  progress?: { total?: number | null; scored?: number | null } | null;
  rounds?: SeasonRound[] | null;
  standings?: { rows?: StandingRow[] | null } | null;
  team_league?: {
    /** Die eigenen Teams der Saison (#1926) - bei mehreren steht vor dem Gegner, welches gespielt hat. */
    own_teams?: string[] | null;
    matchdays?: Array<{ round?: SeasonRound | null; match?: Match | null }> | null;
    table?: { rows?: TableRow[] | null } | null;
  } | null;
  racing?: {
    club_drivers?: string[] | null;
    club_teams?: string[] | null;
    drivers?: Record<string, { team?: string | null; guest?: boolean | null } | undefined> | null;
    teams?: { rows?: Array<{ team?: string | null; rank?: number | null; points?: number | null }> | null } | null;
  } | null;
};

export const HIDDEN_NAME = "Name ausgeblendet";
export const MOBILE_TOP = 10;

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Zahl wie in den Tabellen des Webs: Komma statt Punkt. */
export function formatNumber(value: unknown): string {
  return String(number(value)).replace(".", ",");
}

export function nameOf(row: StandingRow | null | undefined): string {
  return row?.name_hidden || !row?.name ? HIDDEN_NAME : row.name;
}

export function seasonKind(page: SeasonPage | null | undefined): string {
  if (page?.racing) return "racing";
  return page?.lineage?.kind || "series";
}

export function seasonTitle(page: SeasonPage | null | undefined): string {
  const series = page?.series || {};
  return series.title || [page?.lineage?.title, [series.season, series.tier].filter(Boolean).join(" · ")].filter(Boolean).join(" ");
}

/** Kleine Zeile über dem Titel: Art und Spiel („Rennliga · F1 26“). */
export function seasonEyebrow(page: SeasonPage | null | undefined): string {
  return [KIND_LABELS[seasonKind(page)] || "Serie", page?.lineage?.game_name].filter(Boolean).join(" · ");
}

export function seasonWebPath(lineage: string, season: string): string {
  return `/references/series/${encodeURIComponent(lineage)}/${encodeURIComponent(season)}`;
}

export type SeasonTabKey = "calendar" | "table" | "drivers" | "matchdays";

/** Reiter je Art: Rennliga Kalender, Tabelle, Fahrer; Team-Liga Spieltage, Tabelle; Turnierserie Termine, Tabelle. */
export function seasonTabs(page: SeasonPage | null | undefined): Array<{ key: SeasonTabKey; label: string }> {
  const kind = seasonKind(page);
  if (kind === "racing") return [{ key: "calendar", label: "Kalender" }, { key: "table", label: "Tabelle" }, { key: "drivers", label: "Fahrer" }];
  if (kind === "team_league") return [{ key: "matchdays", label: "Spieltage" }, { key: "table", label: "Tabelle" }];
  return [{ key: "calendar", label: "Termine" }, { key: "table", label: "Tabelle" }];
}

// ---------------------------------------------------------------- Kalender

export const PUBLIC_STATE_LABELS: Record<string, string> = {
  planned: "Geplant", today: "Heute", missing: "Ergebnis folgt", cancelled: "Abgesagt", postponed: "Verschoben", scored: "Gewertet",
};
export type StateTone = "done" | "today" | "missing" | "cancelled" | "postponed" | "planned";
const STATE_TONES: Record<string, StateTone> = { scored: "done", today: "today", missing: "missing", cancelled: "cancelled", postponed: "postponed", planned: "planned" };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** „Do., 05.11.2026“ - leer ohne Tag. */
export function dayLabel(day: string | null | undefined): string {
  if (!day || !DAY_RE.test(day)) return "";
  return viennaDate(dayNoon(day), { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Tag und Uhrzeit eines Termins; heute „Heute · 20:00“, ohne Tag „Termin offen“. */
export function roundWhen(round: SeasonRound | null | undefined): string {
  if (round?.state === "today") return ["Heute", round.time].filter(Boolean).join(" · ");
  const day = dayLabel(round?.club_day);
  if (!day) return "Termin offen";
  return round?.time ? `${day} · ${round.time}` : day;
}

/** Kurzname eines Termins: Kürzel, sonst „Termin 3“. */
export function roundLabel(round: SeasonRound | null | undefined): string {
  return String(round?.code || "").trim() || `Termin ${round?.position || ""}`.trim();
}

// ---------------------------------------------------------------- Rennliga

const MEDALS: Record<number, "gold" | "silver" | "bronze"> = { 1: "gold", 2: "silver", 3: "bronze" };
const STATUS_TEXT: Record<string, string> = { dnf: "DNF", dns: "DNS", dsq: "DSQ" };

export type RaceCell = {
  status: string; place: number | null; text: string; medal: "gold" | "silver" | "bronze" | null; fastest: boolean; pole: boolean; dropped: boolean; points: number | null | undefined;
  grid: number | null; gained: number | null; time: string; gap: string; startNumber: string; fastestTime: string; dotd: boolean;
};

function positive(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}

/** Eine Zelle des Rennrasters: Platz (Podium in Medaillenfarbe) oder DNF/DNS/DSQ, dazu schnellste Runde und Pole. Aus dem
 * Rennergebnis (#1927), wenn eingetragen: Startplatz, gutgemachte Plätze (nur im Ziel), Zeit, Abstand, Startnummer, Zeit
 * der schnellsten Runde und „Fahrer des Tages“. */
export function raceCell(result: RoundResult | null | undefined): RaceCell | null {
  if (!result) return null;
  const marks = new Set(result.marks || []);
  const status = ["dsq", "dns", "dnf"].find((mark) => marks.has(mark)) || "finished";
  const place = positive(result.place);
  const grid = positive(result.grid);
  return {
    grid,
    gained: status === "finished" && place && grid ? grid - place : null,
    // Zeiten mit Komma wie beim Veranstalter (#1981).
    time: formatRaceTime(result.time),
    gap: formatRaceTime(result.gap),
    startNumber: result.start_number || "",
    fastestTime: formatRaceTime(result.fastest_lap_time),
    dotd: Boolean(result.driver_of_the_day),
    status,
    place,
    text: STATUS_TEXT[status] || (place ? String(place) : "–"),
    medal: status === "finished" && place ? MEDALS[place] || null : null,
    fastest: marks.has("fastest_lap"),
    pole: marks.has("pole"),
    dropped: Boolean(result.dropped),
    points: result.points,
  };
}

/** Gutgemachte Plätze in Worten: „3 Plätze gutgemacht“, „1 Platz verloren“, „Platz gehalten“. */
export function gainedWords(gained: number | null | undefined): string {
  if (gained === null || gained === undefined) return "";
  if (gained === 0) return "Platz gehalten";
  const value = Math.abs(gained);
  return `${value} ${value === 1 ? "Platz" : "Plätze"} ${gained > 0 ? "gutgemacht" : "verloren"}`;
}

export function resultIn(row: StandingRow | null | undefined, roundId: string): RoundResult | null {
  return (row?.results || []).find((item) => item.round_id === roundId) || null;
}

const classified = (cell: RaceCell | null) => Boolean(cell && cell.status === "finished" && cell.place);

/** Ein Rennen auf einen Blick, nur mit öffentlichen Vereinsfahrern: der Sieger (wenn er einer von ihnen ist) und der beste von ihnen. */
export function raceSummary(rows: StandingRow[] | null | undefined, roundId: string, publicKeys: string[] | null | undefined = []) {
  const allowed = new Set(publicKeys || []);
  const entries = (rows || []).filter((row) => allowed.has(String(row.key)))
    .map((row) => ({ row, cell: raceCell(resultIn(row, roundId)) })).filter((item): item is { row: StandingRow; cell: RaceCell } => Boolean(item.cell));
  const winner = entries.find((item) => classified(item.cell) && item.cell.place === 1)?.row || null;
  const club = entries.filter((item) => item.cell.status !== "dns");
  club.sort((a, b) => Number(!classified(a.cell)) - Number(!classified(b.cell)) || (a.cell.place ?? Infinity) - (b.cell.place ?? Infinity));
  return { winner, bestClub: club[0] || null };
}

export type RoundRow = { key: string; code: string; place: string; country: string; countryName: string; state: string; tone: StateTone; when: string; winner: string; best: string; final: boolean };

/** Der Kalender als Zeilen: Kürzel, Ort, Land (Code für die Flagge, #1925), Stand und Tag; bei einem gewerteten
 * Rennen der Sieger (nur ein öffentlicher Vereinsfahrer) und sonst der beste öffentliche Vereinsfahrer mit Platz. */
export function roundRows(page: SeasonPage | null | undefined): RoundRow[] {
  const rows = page?.standings?.rows || [];
  const publicKeys = page?.racing?.club_drivers || [];
  return (page?.rounds || []).filter((round) => round?.id).map((round) => {
    const summary = page?.racing && round.state === "scored" ? raceSummary(rows, round.id, publicKeys) : null;
    const best = summary?.bestClub && summary.bestClub.row !== summary.winner ? summary.bestClub : null;
    const country = countryCode(round.country_code);
    return {
      key: round.id,
      code: roundLabel(round),
      // Ohne Titel und Ort steht der Landesname da - wie VenueWithFlag im Web.
      place: [[round.title, round.venue].filter(Boolean).join(" · ") || countryName(country), round.opponent ? `gegen ${round.opponent}` : ""].filter(Boolean).join(" · "),
      country,
      countryName: countryName(country),
      state: PUBLIC_STATE_LABELS[String(round.state)] || "",
      tone: STATE_TONES[String(round.state)] || "planned",
      when: roundWhen(round),
      winner: summary?.winner ? nameOf(summary.winner) : "",
      best: best ? `${nameOf(best.row)} · ${best.cell.place ? `P${best.cell.place}` : best.cell.text}` : "",
      final: round.kind === "final",
    };
  });
}

/** Am Handy: die ersten zehn und dazu jedes Vereinsmitglied weiter hinten - aufgeklappt alle. */
export function mobileRows<T extends { club_member?: boolean | null }>(rows: T[] | null | undefined, { expanded = false, top = MOBILE_TOP }: { expanded?: boolean; top?: number } = {}): T[] {
  const list = Array.isArray(rows) ? rows : [];
  if (expanded) return list;
  return list.filter((row, index) => index < top || row.club_member);
}

export type TableLine = { key: string; pos: string; name: string; team: string; points: string; club: boolean; hidden: boolean; club_member: boolean };

/** Fahrerwertung (bzw. Gesamtwertung) oder Teamwertung als Zeilen. */
export function racingTableRows(page: SeasonPage | null | undefined, scope: "drivers" | "teams"): TableLine[] {
  if (scope === "teams") {
    const club = new Set(page?.racing?.club_teams || []);
    return (page?.racing?.teams?.rows || []).map((row, index) => ({
      key: String(row.team || index), pos: row.rank ? String(row.rank) : "–", name: row.team || "", team: "",
      points: formatNumber(row.points), club: club.has(String(row.team)), hidden: false, club_member: club.has(String(row.team)),
    }));
  }
  const drivers = page?.racing?.drivers || {};
  return (page?.standings?.rows || []).map((row, index) => ({
    key: String(row.key || index), pos: row.rank ? String(row.rank) : "–", name: nameOf(row), team: drivers[String(row.key)]?.team || "",
    points: formatNumber(row.points), club: Boolean(row.club_member), hidden: Boolean(row.name_hidden || !row.name), club_member: Boolean(row.club_member),
  }));
}

/** Wer ein Fahrer-Detail bekommt: nur die Kennungen, die der Server nennt, und davon nur Vereinsmitglieder mit Namen. */
export function clubDrivers(rows: StandingRow[] | null | undefined, publicKeys: string[] | null | undefined = []): StandingRow[] {
  const allowed = new Set(publicKeys || []);
  return (rows || []).filter((row) => allowed.has(String(row.key)) && row.club_member && !row.name_hidden && row.name);
}

const count = (value: number, one: string, many: string) => (value ? `${value} ${value === 1 ? one : many}` : "");

/** Fahrer (Garage): je öffentlichem Vereinsfahrer Platz, Team, Punkte und seine Saison - nur Zahlen über null. */
export function driverCards(page: SeasonPage | null | undefined): Array<{ key: string; name: string; pos: string; meta: string; stats: string }> {
  const drivers = page?.racing?.drivers || {};
  return clubDrivers(page?.standings?.rows, page?.racing?.club_drivers).map((row) => {
    const cells = (row.results || []).map(raceCell).filter((cell): cell is RaceCell => Boolean(cell));
    const finished = cells.filter(classified).map((cell) => cell.place as number);
    const stats = [
      count(cells.filter((cell) => cell.status !== "dns").length, "Rennen", "Rennen"),
      count(finished.filter((place) => place === 1).length, "Sieg", "Siege"),
      count(finished.filter((place) => place <= 3).length, "Podium", "Podien"),
      count(cells.filter((cell) => cell.pole).length, "Pole", "Poles"),
      count(cells.filter((cell) => cell.fastest).length, "schnellste Runde", "schnellste Runden"),
      // Rennergebnis (#1927): wie im Fahrer-Detail des Webs.
      cells.some((cell) => cell.dotd) ? `${cells.filter((cell) => cell.dotd).length}× Fahrer des Tages` : "",
      cells.some((cell) => cell.gained !== null) ? gainedWords(cells.reduce((sum, cell) => sum + (cell.gained || 0), 0)) : "",
    ].filter(Boolean).join(" · ");
    return {
      key: String(row.key),
      name: nameOf(row),
      pos: row.rank ? `P${row.rank}` : "",
      meta: [drivers[String(row.key)]?.team, `${formatNumber(row.points)} ${number(row.points) === 1 ? "Punkt" : "Punkte"}`].filter(Boolean).join(" · "),
      stats,
    };
  });
}

// ---------------------------------------------------------------- Team-Liga

export const OUTCOMES: Record<string, { letter: string; word: string }> = {
  win: { letter: "S", word: "Sieg" },
  draw: { letter: "U", word: "Unentschieden" },
  loss: { letter: "N", word: "Niederlage" },
};

/** Spieltage ohne abgesagte, davon gespielt, und der nächste offene Termin. */
export function matchdayProgress(page: SeasonPage | null | undefined) {
  const list = page?.team_league?.matchdays || [];
  const live = list.filter((day) => day?.round?.state !== "cancelled");
  return { total: live.length, played: live.filter((day) => day?.match).length };
}

export type MatchdayRow = { key: string; code: string; when: string; opponent: string; side: string; score: string; outcome: string; outcomeKey: string; state: string; tone: StateTone; maps: string[] };

/** Die Spieltage der Team-Liga: Gegner, Heim/Auswärts und Ergebnis aus eigener Sicht - offen mit Stand. */
export function matchdayRows(page: SeasonPage | null | undefined): MatchdayRow[] {
  // Mehrere eigene Teams (#1926): vor dem Gegner steht, welches eigene Team gespielt hat.
  const showTeam = (page?.team_league?.own_teams || []).length > 1;
  return (page?.team_league?.matchdays || []).filter((day) => day?.round?.id).map(({ round, match }) => {
    const opponent = match?.opponent || round?.opponent || "";
    const team = showTeam && match?.team ? `${match.team} ` : "";
    return {
      key: String(round?.id),
      code: roundLabel(round),
      when: roundWhen(round),
      opponent: opponent ? `${team}gegen ${opponent}` : "",
      side: match ? (match.home ? "Heim" : "Auswärts") : "",
      score: match ? `${formatNumber(match.score_for)}:${formatNumber(match.score_against)}` : "",
      outcome: match ? OUTCOMES[String(match.outcome)]?.word || "" : "",
      outcomeKey: match ? String(match.outcome || "") : "",
      state: match ? "" : PUBLIC_STATE_LABELS[String(round?.state)] || "",
      tone: STATE_TONES[String(round?.state)] || "planned",
      maps: (match?.maps || []).map((map) => `${map.name || "Map"} ${formatNumber(map.score_for)}:${formatNumber(map.score_against)}`),
    };
  });
}

/** Die Tabelle der Team-Liga: Platz, Team, Spiele, Punkte - das eigene Team markiert. */
export function leagueTableRows(page: SeasonPage | null | undefined): Array<{ key: string; pos: string; name: string; played: string; points: string; own: boolean; club_member: boolean }> {
  return (page?.team_league?.table?.rows || []).map((row, index) => ({
    key: String(row.key || row.team || index),
    pos: row.rank ? String(row.rank) : "–",
    name: row.team || "",
    played: formatNumber(row.played),
    points: formatNumber(row.points),
    own: Boolean(row.own),
    club_member: Boolean(row.own),
  }));
}

// ---------------------------------------------------------------- Kopf

/** Kennzahlen im Kopf ohne Nullen: Fortschritt, bester Vereinsfahrer und bestes Vereinsteam bzw. Platz und Punkte. */
export function seasonFigures(page: SeasonPage | null | undefined): Array<{ key: string; value: string; label: string }> {
  const kind = seasonKind(page);
  const figures: Array<{ key: string; value: string; label: string } | null> = [];
  if (kind === "team_league") {
    const progress = matchdayProgress(page);
    const rows = page?.team_league?.table?.rows || [];
    const own = rows.find((row) => row.own);
    figures.push(progress.total ? { key: "progress", value: `${progress.played}/${progress.total}`, label: "Spieltage" } : null);
    figures.push(own?.rank ? { key: "rank", value: `${own.rank}.`, label: `von ${rows.length} Teams` } : null);
    figures.push(number(own?.points) > 0 ? { key: "points", value: formatNumber(own?.points), label: "Punkte" } : null);
  } else {
    const total = number(page?.progress?.total);
    const scored = Math.min(number(page?.progress?.scored), total);
    figures.push(total > 0 ? { key: "progress", value: `${scored}/${total}`, label: kind === "racing" ? "Runden" : "Turniere" } : null);
    const ranks = (page?.standings?.rows || []).filter((row) => row.club_member && row.rank).map((row) => Number(row.rank));
    figures.push(ranks.length ? { key: "driver", value: `P${Math.min(...ranks)}`, label: kind === "racing" ? "Bester Fahrer" : "Bester im Verein" } : null);
    if (kind === "racing") {
      const club = new Set(page?.racing?.club_teams || []);
      const teams = (page?.racing?.teams?.rows || []).filter((row) => club.has(String(row.team)) && row.rank).map((row) => Number(row.rank));
      figures.push(teams.length ? { key: "team", value: `P${Math.min(...teams)}`, label: "Bestes Team" } : null);
    }
  }
  return figures.filter((figure): figure is { key: string; value: string; label: string } => Boolean(figure));
}
