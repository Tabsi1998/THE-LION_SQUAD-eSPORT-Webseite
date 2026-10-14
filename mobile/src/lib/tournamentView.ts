// Turnieransicht der App (#1563): Rundennamen in Alltagsworten, Baum oder Tabelle, Spielplan nach Spieltag oder Station
// („Nur meine“), Tabellen für Gruppen, Liga und Swiss, Check-in-Ende, Live-Uhr und die Freilos-Zeile. Reine Funktionen.
import { isByeSlot, isCancelled, isDone, isLive, isWalkover, matchFate, sectionGroup, soloAdvance, type BracketMatch } from "./bracketGraph";
import { formatStatus } from "./format";

// ---------------------------------------------------------------------------------------------------- Rundennamen
// Dieselbe Regel wie der Server (backend/services/round_labels.py): die Baum-Antwort bringt sie ab #1581 als
// `round_label` mit; ältere Server schicken sie nicht - dann rechnet die App sie selbst. Der Test prüft die App gegen die
// Namen, die der Server für die echten Bäume rechnet (docs/bracket-trees.json → round_labels).
const KO_FROM_END: Record<number, string> = { 0: "Finale", 1: "Halbfinale", 2: "Viertelfinale", 3: "Achtelfinale" };
const TABLE_STAGE_TYPES = new Set(["round_robin_groups", "round_robin", "league", "swiss", "ffa_league"]);
const HEAT_STAGE_TYPES = new Set(["ffa_single_elimination", "ffa_custom_bracket"]);
const TABLE_FORMATS = new Set(["round_robin", "league", "swiss", "groups"]);
const HEAT_FORMATS = new Set(["ffa", "battle_royale", "grand_prix", "time_trial", "ffa_custom_bracket"]);
const GENERIC_ROUND = /^(?:runde|round)\s*(\d+)$/i;
const SIDE_ROUND = /^(winner|loser)\s+(?:runde|round)\s*(\d+)$/i;
const LOSER_KEYS = new Set(["lb", "loser", "losers", "lower", "lower_bracket", "loser bracket", "looser"]);
const FINAL_KEYS = new Set(["gf", "grand_final", "grand final", "final"]);
const BRONZE_KEYS = new Set(["bronze", "br", "spiel um platz 3", "platz 3"]);

export type TreeKind = "table" | "heats" | "knockout";

function sectionKind(section?: string | null) {
  const key = String(section || "").trim().toLowerCase();
  if (BRONZE_KEYS.has(key)) return "bronze";
  if (FINAL_KEYS.has(key)) return "grand_final";
  if (LOSER_KEYS.has(key)) return "loser";
  if (key.startsWith("group_") || key === "round_robin") return "group";
  return "main";
}

/** Wie man eine Phase liest: „table“ (Bilanz), „heats“ (Plätze je Runde) oder „knockout“. */
export function stageKind(stageType?: string | null, format?: string | null, matchType?: string | null): TreeKind {
  if (TABLE_STAGE_TYPES.has(stageType || "")) return "table";
  if (HEAT_STAGE_TYPES.has(stageType || "") || matchType === "ffa") return "heats";
  if (!stageType && TABLE_FORMATS.has(format || "")) return "table";
  if (!stageType && HEAT_FORMATS.has(format || "")) return "heats";
  return "knockout";
}

/** Ganzes Turnier: Tabelle nur, wenn jede Phase eine Tabelle ist; Läufe, sobald eine Phase Läufe hat. */
export function treeKind(stages: Array<{ stage_type?: string | null; match_type?: string | null }> | null | undefined, format?: string | null, matches: BracketMatch[] = []): TreeKind {
  const kinds = (stages || []).map((stage) => stageKind(stage.stage_type, format, stage.match_type));
  if (!kinds.length) return stageKind(undefined, format, matches[0]?.match_type);
  if (kinds.every((kind) => kind === "table")) return "table";
  return kinds.includes("heats") ? "heats" : "knockout";
}

function serverRoundLabel(match: BracketMatch, lastRound: number, kind: TreeKind) {
  const name = String(match.round_name || "").trim();
  const number = Number(match.round) || 0;
  const section = sectionKind(match.section);
  if (section === "bronze") return "Spiel um Platz 3";
  if (section === "grand_final") return name.toLowerCase().includes("reset") ? "Grand Final Reset" : "Grand Final";
  if (kind === "table") {
    if (name && !GENERIC_ROUND.test(name)) return name;
    if (match.matchday_label) return String(match.matchday_label);
    return number ? `Spieltag ${number}` : "Spieltag";
  }
  const side = SIDE_ROUND.exec(name);
  if (side) {
    const label = side[1].toLowerCase() === "winner" ? "Winner" : "Loser";
    if (lastRound && Number(side[2]) === lastRound) return `${label} Final`;
    return `${label} Runde ${side[2]}`;
  }
  if (name && !GENERIC_ROUND.test(name)) return name.replace("Round ", "Runde ").replace("Bronze Match", "Spiel um Platz 3");
  if (section === "loser") return number ? `Loser Runde ${number}` : "Loser Bracket";
  if (lastRound && number) {
    const fromEnd = lastRound - number;
    if (kind === "heats") return fromEnd === 0 ? "Finale" : `Runde ${number}`;
    if (KO_FROM_END[fromEnd]) return KO_FROM_END[fromEnd];
  }
  return number ? `Runde ${number}` : "Runde";
}

/** Je Spiel der Rundenname: `round_label` aus der Baum-Antwort, sonst dieselbe Regel wie der Server. */
export function roundLabels(matches: BracketMatch[] = [], stages: Array<{ id?: string; stage_type?: string | null }> = [], format?: string | null) {
  const stageTypes = new Map((stages || []).map((stage) => [stage.id, stage.stage_type]));
  const lastRounds = new Map<string, number>();
  const key = (match: BracketMatch) => `${match.stage_id || ""}::${sectionKind(match.section)}`;
  for (const match of matches) lastRounds.set(key(match), Math.max(lastRounds.get(key(match)) || 0, Number(match.round) || 0));
  const out = new Map<string, string>();
  for (const match of matches) {
    const given = typeof match.round_label === "string" ? match.round_label.trim() : "";
    const kind = stageKind(stageTypes.get(match.stage_id || "") || (match.stage_type as string | undefined), format, match.match_type);
    out.set(match.id, given || serverRoundLabel(match, lastRounds.get(key(match)) || 0, kind));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------------- Spielplan
const GROUP_ORDER = { main: 0, loser: 1, final: 2, bronze: 3 } as const;
export const dayOrder = (a: BracketMatch, b: BracketMatch) =>
  GROUP_ORDER[sectionGroup(a.section)] - GROUP_ORDER[sectionGroup(b.section)]
  || (Number(a.round) || 0) - (Number(b.round) || 0)
  || String(a.section || "").localeCompare(String(b.section || ""))
  || (Number(a.order) || 0) - (Number(b.order) || 0);

function statusRank(match: BracketMatch) {
  if (isLive(match)) return 0;
  if (isCancelled(match)) return 4;
  if (isDone(match)) return 3;
  return ["ready", "scheduled", "waiting_result"].includes(String(match.status || "")) ? 1 : 2;
}

export const hasPlayer = (match: BracketMatch, registrationId?: string | null) =>
  Boolean(registrationId) && (match.slots || []).some((slot) => slot.registration_id === registrationId);

export type ScheduleSection = { key: string; title: string; live: boolean; items: BracketMatch[] };

/**
 * Der Spielplan in Abschnitten: nach Spieltag/Runde (in der Reihenfolge des Baums) oder nach Station (laufende zuerst,
 * dann nach Name, „Ohne Station“ am Ende; darin Laufendes, Bereites, Offenes, Fertiges). `mine`: nur eigene Spiele.
 */
export function scheduleSections(matches: BracketMatch[], { by, mine, labels }: { by: "day" | "station"; mine?: string | null; labels: Map<string, string> }): ScheduleSection[] {
  const list = [...(matches || [])].filter((match) => !mine || hasPlayer(match, mine)).sort(dayOrder);
  const sections = new Map<string, ScheduleSection>();
  for (const match of list) {
    const title = by === "day" ? labels.get(match.id) || "Runde" : String(match.station_text || "").trim() || "Ohne Station";
    if (!sections.has(title)) sections.set(title, { key: `${by}:${title}`, title, live: false, items: [] });
    const section = sections.get(title) as ScheduleSection;
    section.items.push(match);
    if (isLive(match)) section.live = true;
  }
  const out = [...sections.values()];
  if (by === "station") {
    for (const section of out) section.items.sort((a, b) => statusRank(a) - statusRank(b) || dayOrder(a, b));
    out.sort((a, b) => Number(b.live) - Number(a.live)
      || Number(a.title === "Ohne Station") - Number(b.title === "Ohne Station")
      || a.title.localeCompare(b.title, "de", { numeric: true }));
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------- Tabellen
const OUT_LABELS: Record<string, string> = { withdrawn: "Ausgetreten", disqualified: "Disqualifiziert" };
export type TableRow = { id: string; rank: number; name: string; cells: string[]; mine: boolean; out: string };
export type StandingsTable = { key: string; title: string; columns: string[]; rows: TableRow[] };

const num = (value: unknown) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return String(Math.round(parsed * 10) / 10).replace(".", ",");
};
const signed = (value: number) => (value > 0 ? `+${num(value)}` : num(value));

/**
 * Gruppen, Liga und Swiss als Tabelle (#1563): Gruppen kommen als `[{group, standings}]`, sonst eine Liste. Spalten:
 * Spiele, Siege, Unentschieden, Niederlagen, Tordifferenz (Swiss: Buchholz), Punkte.
 */
export function standingsTables(standings: any[] | null | undefined, format: string | null | undefined, mine: string | null | undefined, statusById: Map<string, string> = new Map()): StandingsTable[] {
  const list = Array.isArray(standings) ? standings : [];
  if (!list.length) return [];
  const swiss = format === "swiss";
  const columns = swiss ? ["Sp", "S", "U", "N", "BH", "Pkt"] : ["Sp", "S", "U", "N", "Diff", "Pkt"];
  const rowOf = (row: any, index: number): TableRow => {
    const id = String(row?.registration_id || row?.id || index);
    const rank = Number(row?.rank) > 0 ? Number(row.rank) : index + 1;
    const extra = swiss ? num(row?.buchholz) : signed((Number(row?.score_for) || 0) - (Number(row?.score_against) || 0));
    return {
      id,
      rank,
      name: row?.display_name || row?.name || row?.team_name || "Teilnehmer",
      cells: [num(row?.played), num(row?.won ?? row?.wins), num(row?.drawn), num(row?.lost ?? row?.losses), extra, num(row?.points)],
      mine: Boolean(mine) && id === mine,
      out: OUT_LABELS[String(statusById.get(id) || "")] || "",
    };
  };
  const grouped = list.every((entry) => entry && typeof entry === "object" && Array.isArray(entry.standings));
  if (grouped) {
    return list.map((entry, index) => ({
      key: String(entry.group?.id || entry.group?.group_key || index),
      title: entry.group?.name || (entry.group?.group_key ? `Gruppe ${entry.group.group_key}` : `Gruppe ${index + 1}`),
      columns,
      rows: (entry.standings || []).map(rowOf).sort((a: TableRow, b: TableRow) => a.rank - b.rank),
    }));
  }
  return [{ key: "all", title: "", columns, rows: list.map(rowOf).sort((a, b) => a.rank - b.rank) }];
}

// ------------------------------------------------------------------------------------------------------- Check-in
type CheckInFields = { status?: string | null; check_in_until?: string | null; check_in_closed_at?: string | null };

/**
 * Check-in offen oder vorbei (#1551, #1574) - wie der Server (`_check_in_over`): vorbei, sobald der Check-in
 * geschlossen ist (`check_in_closed_at`) oder „Check-in endet“ um ist, auch bevor der Job den Baum gebaut hat.
 */
export function checkInState(tournament: CheckInFields | null | undefined, now: Date = new Date()) {
  const inCheckIn = tournament?.status === "check_in";
  const until = tournament?.check_in_until ? Date.parse(tournament.check_in_until) : NaN;
  const over = Boolean(tournament?.check_in_closed_at) || (inCheckIn && Number.isFinite(until) && now.getTime() > until);
  return { open: Boolean(inCheckIn && !over), over };
}

// ------------------------------------------------------------------------------------------------------ Kleinigkeiten
/** Spielzeit seit dem Start: „07:41“ (Minuten laufen über 59 weiter). */
export function liveClockText(startedAt: string | null | undefined, now: number) {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) return "";
  const seconds = Math.max(0, Math.floor((now - start) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const REMOVED = new Set(["disqualified", "withdrawn"]);

/**
 * Ein Freilos-Duell als eine Zeile (#1259): „Freilos · NeonFalke kommt weiter“. Kam der freie Platz von einer
 * Disqualifikation oder einem Austritt (#1553, `source_result.reason`), heißt es „kampflos“.
 */
export function byeLine(match: BracketMatch, nameOf: (id: string) => string) {
  const solo = soloAdvance(match);
  if (!solo) return null;
  const bye = (match.slots || []).find(isByeSlot);
  const tag = REMOVED.has(String(bye?.source_result?.reason || "")) ? "kampflos" : "Freilos";
  const registrationId = solo.slot.registration_id || null;
  const name = registrationId ? nameOf(registrationId) : "";
  return { tag, text: `${name || "noch offen"} kommt weiter`, registrationId };
}

/** Der Status eines Spiels in Worten (#1563): „entfällt · nicht nötig“, „zusammengelegt in B“, „kampflos“, sonst wie überall. */
export function matchStatusText(match: BracketMatch) {
  const fate = matchFate(match);
  if (fate) return fate.label;
  if (isWalkover(match)) return "kampflos";
  return formatStatus(match.status);
}
