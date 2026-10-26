import { countryCode, countryName } from "./countryFlags";
import { formatRaceTime } from "./raceTime";
import {
  averageGrid,
  averageGridLabel,
  chipLabel,
  groupWeekends,
  hasSessions,
  poleCount,
  qualiDuel,
  roundKind,
  sessionGridLines,
  sessionPointsLines,
  sessionTables,
  type QualifyingEntry,
  type WeekendRound,
  type WeekendSettings,
} from "./raceWeekend";
import { originalsOf, type OriginalItem, type OriginalsByRound } from "./referenceOriginals";
import { KIND_LABELS, type LineageInfo } from "./references";
import { dayRounds } from "./seriesDays";
import { HIDDEN_NAME, dayLabel, formatNumber, nameOf, number, roundLabel } from "./seriesFormat";
import type { DataSource } from "./seriesDataSource";
import { OPEN_ROUND, kindShows, kindWord, type KindProfile } from "./seriesKinds";
import type { SeasonPartners } from "./seriesPartners";
import type { MapPool, TeamLeaguePart } from "./teamLeague";
import {
  adjustmentDetail,
  adjustmentTeamText,
  adjustmentText,
  driverAdjustmentMarks,
  noScoreText,
  teamSinceLabel,
  type AdjustedRow,
  type DriverAdjustment,
  type DriverAdjustmentMark,
  type RuleChange,
  type Successor,
} from "./seriesSpecialRules";

// Saison einer Serie in der App (#1945, nur lesen): was der Screen aus /api/reference-series/public/<spur>/<saison>
// liest - dieselben Regeln wie die Serienseite im Web (frontend/src/lib/racingLeague.js, teamLeague.js,
// referenceCalendar.js, referenceSeriesTable.js). Der Server rechnet und speichert alles; hier wird nur beschriftet.
// Fremde Namen stehen nur in Tabellen. Außerhalb der Tabellen nennt die App nur öffentliche Vereinsfahrer
// (`racing.club_drivers` vom Server). Fehlt ein Teil (alter Server), bleibt der Abschnitt leer - nie ein Absturz.
// Mit #1949: Land je Termin (#1925), mehrere eigene Teams (#1926) und das Rennergebnis mit Startplatz, Zeit, Abstand,
// schnellster Runde und Fahrer des Tages (#1927) - jeweils nur, wenn der Server es schickt.
// Mit #1974 (alles optional, ein älterer Server sieht aus wie bisher): Runde mit Läufen (#1930) - Kalender je Runde mit
// Lauf-Chips, Wertung je Lauf, Poles, Ø Start und Quali-Duell; Sonderregeln (#1960) - Anpassungen, Abbruch mit
// Nachfolger, Termin ohne Wertung, Regeländerungen, Quelle und Modus der Teamwertung, „im Team seit“; Turnierserien
// (#1961) - Turniertage und Boni; Partner (#1934) - „Veranstaltet von“.

export type SeasonRound = WeekendRound & {
  opponent?: string | null;
  original_club_day?: string | null;
  /** Land des Termins (ISO 3166-1 alpha-2) - kommt mit #1925; ältere Server schicken es nicht. */
  country_code?: string | null;
  /** Team-Liga (#1931): Heimspiel, und bis wann ein Spieltag läuft. */
  at_home?: boolean | null;
  club_day_end?: string | null;
  /** Termin ohne Wertung (#1960). */
  no_score_reason?: string | null;
  no_score_note?: string | null;
};
export type RoundResult = {
  round_id?: string; place?: number | null; points?: number | null; marks?: string[] | null; counted?: boolean; dropped?: boolean;
  // Rennergebnis (#1927), nur wo eingetragen.
  start_number?: string | null; grid?: number | null; time?: string | null; gap?: string | null; fastest_lap_time?: string | null; driver_of_the_day?: boolean | null;
  // Turniertag (#1961), nur wo eingetragen.
  day_rounds?: Array<{ points?: number | null; place?: number | null; lobby?: string | null } | null> | null;
  day_points?: number | null;
  bonus?: number | null;
  bonus_keys?: string[] | null;
  partner?: { name?: string | null; name_hidden?: boolean | null; club_member?: boolean | null } | null;
};
export type StandingRow = AdjustedRow & {
  key?: string | null;
  rank?: number | null;
  points?: number | null;
  name?: string | null;
  name_hidden?: boolean | null;
  club_member?: boolean | null;
  profile_slug?: string | null;
  results?: RoundResult[] | null;
  /** Sonderboni (#1961) - schon in den Punkten. */
  bonus_points?: number | null;
};
type TeamStandingRow = AdjustedRow & {
  team?: string | null; rank?: number | null; points?: number | null; official_points?: number | null; computed_points?: number | null; deviation?: number | null;
  /** #2000: Fahrer-Anpassungen, die fürs Team zählen - Summe und Liste mit dem Fahrer als Kennung. */
  driver_adjustment_points?: number | null;
  driver_adjustments?: DriverAdjustment[] | null;
};

/** Die Antwort der Serienseite - jedes Feld kann fehlen. */
export type SeasonPage = {
  lineage?: LineageInfo | null;
  series?: {
    season?: string | null; tier?: string | null; title?: string | null; season_slug?: string | null; status?: string | null;
    /** Abgebrochen (#1960). */
    cancelled_on?: string | null; cancel_reason?: string | null;
    /** Ablauf je Runde (#1930): Läufe, Punkte und Startaufstellung je Format. */
    weekend?: WeekendSettings;
  } | null;
  /** Veranstalter und Mitwirkende (#1934). */
  partners?: SeasonPartners;
  /** Nachfolger einer abgebrochenen Saison (#1960). */
  successor?: Successor;
  rule_changes?: RuleChange[] | null;
  rules?: {
    day_rounds?: { count?: number | null; points_by_place?: number[] | null } | null;
    custom_bonuses?: Array<{ key?: string | null; label?: string | null; points?: number | null }> | null;
    tiebreak_top_n?: number | null;
  } | null;
  progress?: { total?: number | null; scored?: number | null; cancelled?: number | null } | null;
  rounds?: SeasonRound[] | null;
  standings?: { rows?: StandingRow[] | null } | null;
  /** Team-Liga (#1931, #1616): Spieltage mit Spielen, Maps und Veto, Tabelle, Kader, Statistik je Map. */
  team_league?: TeamLeaguePart;
  /** Map-Pool der Saison (#1616). */
  map_pool?: MapPool;
  /** Original-Bilder des Veranstalters je Termin (#1933): Kennung des Termins → öffentliche Bilder. */
  originals?: OriginalsByRound;
  /** „Daten von …“ (#1964): Plattform des Partners, von der die Saison ihre Turniertage holt. */
  data_source?: DataSource;
  /** Art-Profil (#2024): Felder (Ort, Land …) und Begriffe der Art („Turniertag“) - ältere Server schicken es nicht. */
  profile?: KindProfile;
  racing?: {
    club_drivers?: string[] | null;
    club_teams?: string[] | null;
    /** `team_since` (#1960): ab welchem Lauf im aktuellen Team - nur nach einem Wechsel. */
    drivers?: Record<string, { team?: string | null; guest?: boolean | null; team_since?: string | null } | undefined> | null;
    teams?: { rows?: TeamStandingRow[] | null; source?: string | null; round_id?: string | null } | null;
    /** Teamwertung (#1960): wie viele zählen, Gäste, Modus. */
    team_scoring?: { enabled?: boolean | null; counting_drivers?: number | null; guests_count?: boolean | null; mode?: string | null } | null;
    /** Je Qualifying die Plätze und die Pole (#1930) - für Poles und das Quali-Duell. */
    qualifying?: QualifyingEntry[] | null;
  } | null;
};

export { HIDDEN_NAME, dayLabel, formatNumber, nameOf, roundLabel };
export const MOBILE_TOP = 10;

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

export type SeasonTabKey = "calendar" | "table" | "drivers" | "statistics" | "matchdays" | "squad" | "maps" | "days";

/** Reiter je Art: Rennliga Kalender, Tabelle, Fahrer, Statistik (#1950); Team-Liga Spieltage, Tabelle; Turnierserie
 * Termine, Tabelle. */
export function seasonTabs(page: SeasonPage | null | undefined): Array<{ key: SeasonTabKey; label: string }> {
  const kind = seasonKind(page);
  if (kind === "racing") return [{ key: "calendar", label: "Kalender" }, { key: "table", label: "Tabelle" }, { key: "drivers", label: "Fahrer" }, { key: "statistics", label: "Statistik" }];
  if (kind === "team_league") {
    // Kader und Maps (#1931, #1616) nur, wenn der Server sie schickt.
    const squad = (page?.team_league?.lineup?.players || []).length > 0;
    const maps = (page?.team_league?.map_stats || []).length > 0 || (page?.map_pool?.modes || []).some((group) => (group?.maps || []).length);
    return [
      { key: "matchdays", label: "Spieltage" },
      { key: "table", label: "Tabelle" },
      ...(squad ? [{ key: "squad" as const, label: "Kader" }] : []),
      ...(maps ? [{ key: "maps" as const, label: "Maps" }] : []),
    ];
  }
  // Turniertage (#1961) nur mit Tagesdaten vom Server.
  return [{ key: "calendar", label: "Termine" }, { key: "table", label: "Tabelle" }, ...(dayRounds(page).length ? [{ key: "days" as const, label: "Turniertage" }] : [])];
}

// ---------------------------------------------------------------- Kalender

export const PUBLIC_STATE_LABELS: Record<string, string> = {
  planned: "Geplant", today: "Heute", missing: "Ergebnis folgt", cancelled: "Abgesagt", postponed: "Verschoben", scored: "Gewertet",
};
export type StateTone = "done" | "today" | "missing" | "cancelled" | "postponed" | "planned";
const STATE_TONES: Record<string, StateTone> = { scored: "done", today: "today", missing: "missing", cancelled: "cancelled", postponed: "postponed", planned: "planned" };

/** Farbe eines Stands (Chip, Lauf-Chip). */
export function stateTone(state: string | null | undefined): StateTone {
  return STATE_TONES[String(state)] || "planned";
}

/** Tag und Uhrzeit eines Termins; heute „Heute · 20:00“, ohne Tag „Termin folgt“ (#2024, wie öffentlich im Web) mit
 * einer gemerkten Uhrzeit dahinter. */
export function roundWhen(round: SeasonRound | null | undefined, profile: KindProfile = null): string {
  if (round?.state === "today") return ["Heute", round.time].filter(Boolean).join(" · ");
  const day = dayLabel(round?.club_day);
  if (!day) return [kindWord(profile, "open_round", OPEN_ROUND), round?.time].filter(Boolean).join(" · ");
  return round?.time ? `${day} · ${round.time}` : day;
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

export type RoundLine = { key: string; kind: "winner" | "best"; label: string; text: string };

export type RoundRow = {
  key: string; code: string; place: string; country: string; countryName: string; state: string; tone: StateTone; when: string; final: boolean;
  /** Sieger (nur ein öffentlicher Vereinsfahrer) und bester öffentlicher Vereinsfahrer je gewertetem Rennen der Runde. */
  results: RoundLine[];
  /** Die Läufe der Runde für die Chips (#1930) - leer bei einem einzelnen Rennen ohne Lauf. */
  sessions: SeasonRound[];
  /** „Ohne Wertung · …“ je Lauf (#1960). */
  notes: string[];
  /** „ursprünglich Do., 05.11.2026“ bei einem verschobenen Termin. */
  moved: string;
  /** Nummer der Runde für ihre Ergebnisseite (#1950) - nur Rennliga und nur, wenn der Server sie schickt. */
  number: number | null;
  /** Original-Bilder des Veranstalters aller Läufe der Runde (#1933), bei mehreren Läufen mit Lauf beschriftet. */
  originals: OriginalItem[];
  /** Überschrift im Vollbild: „R3 · Baku City Circuit“. */
  originalsTitle: string;
};

/** Der Kalender als Zeilen - je Runde eine (#1930): Kürzel, Ort, Land (Code für die Flagge, #1925), Stand der Runde und
 * Tag (bei mehreren Läufen ohne Uhrzeit, die steht an den Chips); je gewertetem Rennen der Runde der Sieger (nur ein
 * öffentlicher Vereinsfahrer) und sonst der beste öffentliche Vereinsfahrer mit Platz. */
export function roundRows(page: SeasonPage | null | undefined): RoundRow[] {
  const rows = page?.standings?.rows || [];
  const publicKeys = page?.racing?.club_drivers || [];
  const racing = Boolean(page?.racing);
  // Art-Profil (#2024): Ort und Flagge nur, wo die Art sie führt - eine Turnierserie hat keine. Ohne Profil wie bisher.
  const profile = page?.profile;
  const places = kindShows(profile, "venue");
  const flags = kindShows(profile, "country");
  const roundWord = kindWord(profile, "round_one");
  return groupWeekends(page?.rounds || []).map((group) => {
    const lead = group.lead;
    // Wie im Web: je gewertetem, zählendem Lauf außer dem Qualifying.
    const races = group.rounds.filter((round) => roundKind(round) !== "qualifying" && round.counts !== false);
    const multiRace = races.length > 1;
    const results: RoundLine[] = [];
    if (racing) {
      for (const round of races.filter((item) => item.state === "scored")) {
        const summary = raceSummary(rows, round.id, publicKeys);
        const suffix = multiRace ? ` · ${chipLabel(round)}` : "";
        if (summary.winner) results.push({ key: `${round.id}-winner`, kind: "winner", label: `Sieg${suffix}`, text: nameOf(summary.winner) });
        const best = summary.bestClub && summary.bestClub.row !== summary.winner ? summary.bestClub : null;
        if (best) results.push({ key: `${round.id}-best`, kind: "best", label: `Bester Vereinsfahrer${suffix}`, text: `${nameOf(best.row)} · ${best.cell.place ? `P${best.cell.place}` : best.cell.text}` });
      }
    }
    const country = flags ? countryCode(group.country_code) : "";
    const venue = places ? group.venue : null;
    const state = group.state;
    // Ohne Ort (Turnierserie): der Titel, sonst „Turniertag T4“ statt des Kürzels allein.
    const named = [group.title, venue].filter(Boolean).join(" · ") || (places ? countryName(country) : roundWord && `${roundWord} ${roundLabel(lead)}`);
    return {
      key: lead.id,
      code: roundLabel(lead),
      // Ohne Titel und Ort steht der Landesname da - wie VenueWithFlag im Web.
      place: [named, lead.opponent ? `gegen ${lead.opponent}` : ""].filter(Boolean).join(" · "),
      country,
      countryName: countryName(country),
      state: PUBLIC_STATE_LABELS[state] || "",
      tone: STATE_TONES[state] || "planned",
      when: roundWhen({ ...lead, state, time: group.multi ? null : lead.time }, profile),
      final: group.kind === "final",
      results,
      sessions: group.multi ? group.rounds : [],
      notes: group.rounds.map((round) => {
        const text = noScoreText(round, profile);
        return text && group.multi ? `${chipLabel(round)}: ${text}` : text;
      }).filter(Boolean),
      moved: lead.original_club_day && lead.original_club_day !== lead.club_day ? `ursprünglich ${dayLabel(lead.original_club_day)}` : "",
      number: racing ? group.number : null,
      originals: originalsOf(page?.originals, group.rounds, { withSession: group.multi }),
      originalsTitle: [roundLabel(lead), venue || group.title].filter(Boolean).join(" · "),
    };
  });
}

/** Am Handy: die ersten zehn und dazu jedes Vereinsmitglied weiter hinten - aufgeklappt alle. */
export function mobileRows<T extends { club_member?: boolean | null }>(rows: T[] | null | undefined, { expanded = false, top = MOBILE_TOP }: { expanded?: boolean; top?: number } = {}): T[] {
  const list = Array.isArray(rows) ? rows : [];
  if (expanded) return list;
  return list.filter((row, index) => index < top || row.club_member);
}

export type TableLine = {
  key: string; pos: string; name: string; team: string; points: string; club: boolean; hidden: boolean; club_member: boolean;
  /** Anpassungen der Zeile (#1960) für die Marke „−5“ an den Punkten. */
  adjust: AdjustedRow | null;
  /** Sonderboni (#1961): „+3“ - schon in den Punkten. */
  bonus: string;
  /** Teamwertung (#2000): Fahrer-Anpassungen, die fürs Team zählen - „−5 (Anna Probe)“ unter der Teamsumme. */
  driverMarks: DriverAdjustmentMark[];
};

/** Wertung je Lauf (#1930): „Gesamt“ und je Art mit zählenden Läufen „Rennen“, „Sprint“, „Quali“ - erst ab zwei Arten. */
export function tableKinds(page: SeasonPage | null | undefined): Array<{ key: string; label: string }> {
  const tables = sessionTables(page?.standings?.rows || [], page?.rounds || []);
  return tables.length ? [{ key: "all", label: "Gesamt" }, ...tables.map((table) => ({ key: table.kind, label: table.label }))] : [];
}

/** Fahrerwertung (bzw. Gesamtwertung, je Lauf mit `kind`) oder Teamwertung als Zeilen. */
export function racingTableRows(page: SeasonPage | null | undefined, scope: "drivers" | "teams", kind = "all"): TableLine[] {
  if (scope === "teams") {
    const club = new Set(page?.racing?.club_teams || []);
    return (page?.racing?.teams?.rows || []).map((row, index) => ({
      key: String(row.team || index), pos: row.rank ? String(row.rank) : "–", name: row.team || "", team: "",
      points: formatNumber(row.points), club: club.has(String(row.team)), hidden: false, club_member: club.has(String(row.team)),
      adjust: row, bonus: "",
      driverMarks: driverAdjustmentMarks(row, page?.standings?.rows, page?.rounds),
    }));
  }
  const drivers = page?.racing?.drivers || {};
  const table = kind !== "all" ? sessionTables(page?.standings?.rows || [], page?.rounds || []).find((item) => item.kind === kind) : null;
  const bonuses = (page?.rules?.custom_bonuses || []).length > 0;
  return (table ? table.rows : page?.standings?.rows || []).map((row, index) => ({
    key: String(row.key || index), pos: row.rank ? String(row.rank) : "–", name: nameOf(row), team: drivers[String(row.key)]?.team || "",
    points: formatNumber(row.points), club: Boolean(row.club_member), hidden: Boolean(row.name_hidden || !row.name), club_member: Boolean(row.club_member),
    adjust: table ? null : row,
    bonus: bonuses && number(row.bonus_points) > 0 ? `+${formatNumber(row.bonus_points)}` : "",
    driverMarks: [],
  }));
}

/** Die Anpassungen der Tabelle als Liste (#1960) - am Handy statt eines Tooltips: „−5“ und „Name · Grund · R4 · Tag“.
 * Bei den Teams dazu die Fahrer-Anpassungen, die fürs Team zählen (#2000): „Team · Fahrer (Fahrer) · Grund · …“ - der
 * Name nach den Regeln des Servers aus der Fahrerwertung. */
export function adjustmentLines(page: SeasonPage | null | undefined, scope: "drivers" | "teams"): Array<{ key: string; points: string; negative: boolean; text: string }> {
  const rows: Array<AdjustedRow & { key?: string | null; team?: string | null; name?: string | null; name_hidden?: boolean | null; driver_adjustments?: DriverAdjustment[] | null }> = scope === "teams" ? page?.racing?.teams?.rows || [] : page?.standings?.rows || [];
  const rounds = page?.rounds || [];
  const drivers = page?.standings?.rows || [];
  return rows.flatMap((row, rowIndex) => [
    ...(row.adjustments || []).map((item, index) => ({
      key: `${row.key || row.team || rowIndex}-${index}`,
      points: adjustmentText(item?.points),
      negative: number(item?.points) < 0,
      text: [scope === "teams" ? row.team || "" : nameOf(row), adjustmentDetail(item, rounds)].filter(Boolean).join(" · "),
    })),
    ...(scope === "teams" ? (row.driver_adjustments || []).filter(Boolean) : []).map((item, index) => ({
      key: `${row.key || row.team || rowIndex}-driver-${index}`,
      points: adjustmentText(item.points),
      negative: number(item.points) < 0,
      text: [row.team || "", `${nameOf(drivers.find((entry) => entry.key && entry.key === item.driver))} (Fahrer)`, adjustmentDetail(item, rounds)].filter(Boolean).join(" · "),
    })),
  ]);
}

/** Ablauf je Runde in Worten über der Fahrerwertung (#1930, #1960): Punkte je Lauf und umgekehrte Startaufstellung. */
export function racingRuleLines(page: SeasonPage | null | undefined): Array<{ key: string; label: string; text: string }> {
  const weekend = page?.series?.weekend;
  return [
    { key: "points", label: "Punkte je Lauf", text: sessionPointsLines(weekend).join("; ") },
    { key: "grid", label: "Startaufstellung", text: sessionGridLines(weekend).join("; ") },
  ].filter((line) => line.text);
}

/** Teamwertung in Worten: wie viele Fahrer je Rennen zählen und ob Gäste mitzählen - leer ohne Teamwertung. */
export function teamRuleLabel(scoring: { enabled?: boolean | null; counting_drivers?: number | null; guests_count?: boolean | null } | null | undefined): string {
  if (!scoring?.enabled) return "";
  const n = Number(scoring.counting_drivers) || 0;
  const counting = n === 1 ? "zählt der beste Fahrer" : n > 1 ? `zählen die besten ${n} Fahrer` : "zählen alle Fahrer";
  return `Je Rennen ${counting} eines Teams. Gäste zählen ${scoring.guests_count ? "" : "nicht "}fürs Team.`;
}

/** Wer ein Fahrer-Detail bekommt: nur die Kennungen, die der Server nennt, und davon nur Vereinsmitglieder mit Namen. */
export function clubDrivers(rows: StandingRow[] | null | undefined, publicKeys: string[] | null | undefined = []): StandingRow[] {
  const allowed = new Set(publicKeys || []);
  return (rows || []).filter((row) => allowed.has(String(row.key)) && row.club_member && !row.name_hidden && row.name);
}

const count = (value: number, one: string, many: string) => (value ? `${value} ${value === 1 ? one : many}` : "");

/** Name eines Teamkollegen außerhalb der Tabelle: ein öffentlicher Vereinsfahrer mit Namen, sonst „Vereinsfahrer“ bzw.
 * „Gastfahrer“ (wie garageName im Web). */
function mateName(row: StandingRow, publicKeys: string[]): string {
  if (row.name && !row.name_hidden && row.club_member && publicKeys.includes(String(row.key))) return row.name;
  return row.club_member ? "Vereinsfahrer" : "Gastfahrer";
}

export type DriverCard = {
  key: string; name: string; pos: string; meta: string; stats: string;
  /** `team` (#2000): „zählt auch fürs Team · Team Adler“ bzw. warum für keines - leer ohne Haken. */
  adjustments: Array<{ key: string; points: string; negative: boolean; text: string; team: string }>;
};

/** Fahrer (Garage): je öffentlichem Vereinsfahrer Platz, Team („im Team seit R2“, #1960), Punkte und seine Saison - nur
 * Zahlen über null; mit Läufen (#1930) Poles je Runde, Ø Start und das Quali-Duell gegen den Teamkollegen mit den
 * meisten gemeinsamen Qualifyings; dazu seine Anpassungen (#1960). */
export function driverCards(page: SeasonPage | null | undefined): DriverCard[] {
  const drivers = page?.racing?.drivers || {};
  const rows = page?.standings?.rows || [];
  const rounds = page?.rounds || [];
  const publicKeys = page?.racing?.club_drivers || [];
  const qualifying = page?.racing?.qualifying || [];
  const weekends = hasSessions(rounds);
  return clubDrivers(rows, publicKeys).map((row) => {
    const key = String(row.key);
    const cells = (row.results || []).map(raceCell).filter((cell): cell is RaceCell => Boolean(cell));
    const finished = cells.filter(classified).map((cell) => cell.place as number);
    const team = drivers[key]?.team || "";
    const mates = team ? rows.filter((other) => String(other.key) !== key && drivers[String(other.key)]?.team === team) : [];
    const duel = qualifying.length ? mates.map((mate) => ({ mate, ...qualiDuel(key, String(mate.key), qualifying) })).sort((a, b) => b.sessions - a.sessions)[0] : null;
    const grid = weekends ? averageGrid(row.results) : null;
    const stats = [
      count(cells.filter((cell) => cell.status !== "dns").length, "Rennen", "Rennen"),
      count(finished.filter((place) => place === 1).length, "Sieg", "Siege"),
      count(finished.filter((place) => place <= 3).length, "Podium", "Podien"),
      count(poleCount(row, rounds, qualifying), "Pole", "Poles"),
      count(cells.filter((cell) => cell.fastest).length, "schnellste Runde", "schnellste Runden"),
      count(cells.filter((cell) => cell.status === "dnf").length, "Ausfall", "Ausfälle"),
      // Rennergebnis (#1927): wie im Fahrer-Detail des Webs.
      cells.some((cell) => cell.dotd) ? `${cells.filter((cell) => cell.dotd).length}× Fahrer des Tages` : "",
      cells.some((cell) => cell.gained !== null) ? gainedWords(cells.reduce((sum, cell) => sum + (cell.gained || 0), 0)) : "",
      averageGridLabel(grid),
      duel?.sessions ? `Quali-Duell ${duel.a}:${duel.b} gegen ${mateName(duel.mate, publicKeys)}` : "",
    ].filter(Boolean).join(" · ");
    return {
      key,
      name: nameOf(row),
      pos: row.rank ? `P${row.rank}` : "",
      meta: [team, team ? teamSinceLabel(drivers[key], rounds) : "", `${formatNumber(row.points)} ${number(row.points) === 1 ? "Punkt" : "Punkte"}`].filter(Boolean).join(" · "),
      stats,
      adjustments: (row.adjustments || []).map((item, index) => ({
        key: `${key}-${index}`, points: adjustmentText(item?.points), negative: number(item?.points) < 0, text: adjustmentDetail(item, rounds),
        team: adjustmentTeamText(item),
      })),
    };
  });
}

// ---------------------------------------------------------------- Team-Liga

/** Spieltage ohne abgesagte, davon gespielt (Spieltag-Karten und Tabelle: lib/teamLeague.ts). */
export function matchdayProgress(page: SeasonPage | null | undefined) {
  const list = page?.team_league?.matchdays || [];
  const live = list.filter((day) => day?.round?.state !== "cancelled");
  return { total: live.length, played: live.filter((day) => day?.match || (day?.matches || []).length).length };
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
    // Turnierserie mit Art-Profil (#2024): „Turniertage“; die Rennliga zählt Runden (mit allen Läufen), wie bisher.
    const unit = kind === "racing" ? "Runden" : kindWord(page?.profile, "round_many", "Turniere");
    figures.push(total > 0 ? { key: "progress", value: `${scored}/${total}`, label: unit } : null);
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
