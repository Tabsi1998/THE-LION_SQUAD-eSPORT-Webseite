import { PUBLIC_STATE_LABELS, roundWhen, stateTone, type SeasonRound, type StateTone } from "./referenceSeason";
import { dayLabel, formatNumber, nameOf, roundLabel } from "./seriesFormat";

// Team-Liga in der App (#1931, #1616, #1974): Spieltag-Karten mit Gegner, Heim/Auswärts, Ergebnis aus eigener Sicht und
// den Maps (Bann, Wahl, Decider, „nicht gespielt“ - mit Bild als Veto-Karten), weiteren Spielen des Spieltags, mehreren
// eigenen Teams; der Kader mit Einsätzen; die Statistik je Map und der Map-Pool der Saison. Dieselben Regeln und Texte
// wie im Web (frontend/src/lib/teamLeague.js, teamLeagueMaps.js, mapPools.js, components/tls/series/TeamLeague.jsx).
// Gerechnet wird im Server. Jedes Feld kann fehlen - ein älterer Server zeigt, was er schickt, nie einen Absturz.

export type PlayedMap = { name?: string | null; score_for?: number | null; score_against?: number | null; outcome?: string | null; picked?: string | null; map_id?: string | null; image_url?: string | null };
export type Ban = { name?: string | null; by?: string | null; map_id?: string | null };
export type VetoStep = PlayedMap & { role?: string | null; by?: string | null; played?: boolean | null };
export type MatchView = {
  team?: string | null; opponent?: string | null; home?: boolean | null; outcome?: string | null; score_for?: number | null; score_against?: number | null; points?: number | null;
  maps?: PlayedMap[] | null; bans?: Ban[] | null; veto?: VetoStep[] | null; club_day?: string | null; time?: string | null; lineup_size?: number | null;
};
export type MatchDay = { round?: SeasonRound | null; match?: MatchView | null; matches?: MatchView[] | null; others?: Array<{ home?: string | null; away?: string | null; home_score?: number | null; away_score?: number | null }> | null };
export type Player = {
  key?: string | null; name?: string | null; name_hidden?: boolean | null; club_member?: boolean | null; guest?: boolean | null; profile_slug?: string | null;
  round_ids?: string[] | null; bench_round_ids?: string[] | null; appearances?: number | null; of?: number | null; all_seasons?: number | null; in_roster?: boolean | null; team?: string | null;
};
export type MapStat = { name?: string | null; image_url?: string | null; map_id?: string | null; [figure: string]: unknown };
export type MapPool = { id?: string | null; modes?: Array<{ mode?: string | null; label?: string | null; maps?: Array<{ map_id?: string | null; slug?: string | null; name?: string | null; image_url?: string | null }> | null }> | null } | null | undefined;
type LeagueTableRow = { key?: string | null; team?: string | null; rank?: number | null; points?: number | null; played?: number | null; won?: number | null; drawn?: number | null; lost?: number | null; own?: boolean | null };

export type TeamLeaguePart = {
  /** Die eigenen Teams der Saison (#1926) - bei mehreren steht vor dem Gegner, welches gespielt hat. */
  own_teams?: string[] | null;
  matchdays?: MatchDay[] | null;
  table?: { rows?: LeagueTableRow[] | null } | null;
  lineup?: { round_ids?: string[] | null; players?: Player[] | null } | null;
  map_stats?: MapStat[] | null;
} | null;

type PageLike = { team_league?: TeamLeaguePart; map_pool?: MapPool; rounds?: SeasonRound[] | null };

export const OUTCOMES: Record<string, { letter: string; word: string }> = {
  win: { letter: "S", word: "Sieg" },
  draw: { letter: "U", word: "Unentschieden" },
  loss: { letter: "N", word: "Niederlage" },
};
const RESULT_WORDS: Record<string, string> = { win: "gewonnen", draw: "unentschieden", loss: "verloren" };
export const PICK_LABELS: Record<string, string> = { own: "Unsere Wahl", opponent: "Wahl Gegner", decider: "Decider" };
const BAN_SIDES: Record<string, string> = { own: "wir", opponent: "Gegner" };

/** Anteil der eigenen Runden an einer Map - für den kleinen Balken (ohne Runden die Mitte). */
export function mapShare(map: Pick<PlayedMap, "score_for" | "score_against"> | null | undefined): number {
  const own = Number(map?.score_for) || 0;
  const total = own + (Number(map?.score_against) || 0);
  return total > 0 ? own / total : 0.5;
}

/** Banns in Worten: „Nebelwerk (wir) · Sturmdeck (Gegner)“. */
export function banText(bans: Ban[] | null | undefined): string {
  return (bans || []).filter((ban) => ban?.name).map((ban) => (BAN_SIDES[String(ban.by)] ? `${ban.name} (${BAN_SIDES[String(ban.by)]})` : String(ban.name))).join(" · ");
}

/** Schild einer Veto-Karte: „Bann · wir“, „Unsere Wahl“, „Decider“, „Gespielt“ … */
export function vetoLabel(step: VetoStep | null | undefined): string {
  if (step?.role === "banned") return step.by === "own" ? "Bann · wir" : step.by === "opponent" ? "Bann · Gegner" : "Bann";
  if (step?.role === "picked") return step.by === "own" ? "Unsere Wahl" : step.by === "opponent" ? "Wahl Gegner" : "Wahl";
  if (step?.role === "decider") return "Decider";
  return "Gespielt";
}

/** Tag und Uhrzeit eines Spiels: das Spiel kann einen eigenen Tag bzw. eine eigene Uhrzeit im Spieltag haben. */
export function matchWhen(round: SeasonRound | null | undefined, match: MatchView | null | undefined): string {
  if (match?.club_day) return roundWhen({ id: "", club_day: match.club_day, time: match.time });
  if (match?.time && round?.club_day && !round.club_day_end) return roundWhen({ ...round, time: match.time });
  if (match?.time && round?.club_day_end) return `${dayWindow(round)} · ${match.time}`;
  return dayWindow(round);
}

/** Ein Spieltag über mehrere Tage: „Mi., 13.05. – So., 17.05.2026“, sonst wie ein Termin. */
function dayWindow(round: SeasonRound | null | undefined): string {
  if (round?.club_day && round.club_day_end && round.club_day_end !== round.club_day) {
    const start = dayLabel(round.club_day).replace(/\d{4}$/, "");
    return `${start} – ${dayLabel(round.club_day_end)}`;
  }
  return roundWhen(round);
}

export type VetoCard = { key: string; name: string; label: string; image: string; banned: boolean; played: boolean; score: string; result: string; outcome: string; tone: "own" | "decider" | "plain" };
export type MapLine = { key: string; name: string; pick: string; pickOwn: boolean; score: string; share: number; played: boolean; outcome: string };
export type MatchBlock = {
  key: string; team: string; opponent: string; side: string; score: string; outcomeKey: string; letter: string; label: string;
  /** Mit Bildern (#1616): Veto-Karten - sonst die Liste der gespielten Maps und der Banns. */
  veto: VetoCard[]; maps: MapLine[]; bans: string;
};
export type MatchdayCard = {
  key: string; code: string; when: string; moved: string; state: string; tone: StateTone; cancelled: boolean; today: boolean;
  /** Ohne Ergebnis: der Gegner aus dem Kalender. */
  opponent: string; side: string; team: string;
  matches: MatchBlock[];
  others: Array<{ key: string; home: string; away: string; score: string }>;
};

function opponentWords(name: string | null | undefined): string {
  const value = String(name || "").trim();
  return value ? `gegen ${value}` : "Gegner offen";
}

function sideWords(home: boolean | null | undefined): string {
  return home === true ? "Heim" : home === false ? "Auswärts" : "";
}

function vetoCards(match: MatchView): VetoCard[] {
  const steps = Array.isArray(match.veto) ? match.veto : [];
  // Veto-Karten nur, wenn eine Map ein Bild hat (wie im Web) - sonst die Liste.
  if (!steps.some((step) => step?.image_url)) return [];
  return steps.filter((step) => step?.name).map((step, index) => {
    const banned = step.role === "banned";
    const played = step.played !== false && !banned;
    return {
      key: `${index}-${step.map_id || step.name}`,
      name: String(step.name),
      label: vetoLabel(step),
      image: step.image_url || "",
      banned,
      played,
      score: played ? `${formatNumber(step.score_for)}:${formatNumber(step.score_against)}` : "",
      result: played ? RESULT_WORDS[String(step.outcome)] || "" : banned ? "" : "nicht gespielt",
      outcome: played ? String(step.outcome || "") : "",
      tone: !banned && (step.picked === "own" || (step.role === "picked" && step.by === "own")) ? "own" : !banned && (step.role === "decider" || step.picked === "decider") ? "decider" : "plain",
    };
  });
}

function mapLines(match: MatchView): MapLine[] {
  const steps = Array.isArray(match.veto) && match.veto.length ? match.veto.filter((step) => step?.role !== "banned") : match.maps || [];
  return steps.filter((map) => map?.name).map((map, index) => {
    const played = (map as VetoStep).played !== false;
    const pick = PICK_LABELS[String(map.picked)] || "";
    return {
      key: `${index}-${map.map_id || map.name}`,
      name: String(map.name),
      pick,
      pickOwn: map.picked === "own",
      score: played ? `${formatNumber(map.score_for)}:${formatNumber(map.score_against)}` : "",
      share: mapShare(map),
      played,
      outcome: played ? String(map.outcome || "") : "",
    };
  });
}

/** Die Spieltage als Karten: je Spiel Gegner, Heim/Auswärts, Ergebnis aus eigener Sicht und die Maps; ohne Ergebnis der
 * Stand und der Gegner aus dem Kalender. Mehrere eigene Teams (#1926): vor dem Gegner steht das eigene Team. */
export function matchdayCards(page: PageLike | null | undefined): MatchdayCard[] {
  const showTeam = (page?.team_league?.own_teams || []).length > 1;
  return (page?.team_league?.matchdays || []).filter((day) => day?.round?.id).map((day) => {
    const round = day.round as SeasonRound;
    const list = (day.matches || []).length ? (day.matches || []) : day.match ? [day.match] : [];
    const matches: MatchBlock[] = list.filter(Boolean).map((match, index) => {
      const outcome = OUTCOMES[String(match.outcome)];
      const score = `${formatNumber(match.score_for)}:${formatNumber(match.score_against)}`;
      const points = match.points !== null && match.points !== undefined ? `, ${formatNumber(match.points)} ${Number(match.points) === 1 ? "Punkt" : "Punkte"}` : "";
      return {
        key: `${round.id}-${index}`,
        team: showTeam && match.team ? String(match.team) : "",
        opponent: opponentWords(match.opponent || round.opponent),
        side: sideWords(match.home),
        score,
        outcomeKey: String(match.outcome || ""),
        letter: outcome?.letter || "",
        label: `${outcome?.word || "Ergebnis"} ${score}${points}`,
        veto: vetoCards(match),
        maps: mapLines(match),
        bans: Array.isArray(match.veto) && match.veto.some((step) => step?.image_url) ? "" : banText(match.bans),
      };
    });
    return {
      key: round.id,
      code: roundLabel(round),
      when: matchWhen(round, list[0]),
      moved: round.original_club_day && round.original_club_day !== round.club_day ? `ursprünglich ${dayLabel(round.original_club_day)}` : "",
      state: matches.length ? "" : PUBLIC_STATE_LABELS[String(round.state)] || "",
      tone: stateTone(round.state),
      cancelled: round.state === "cancelled",
      today: round.state === "today",
      opponent: matches.length ? "" : opponentWords(round.opponent),
      side: matches.length ? "" : sideWords(round.at_home),
      team: "",
      matches,
      others: (day.others || []).filter((other) => other?.home || other?.away).map((other, index) => ({
        key: `${round.id}-other-${index}`, home: String(other.home || ""), away: String(other.away || ""),
        score: `${formatNumber(other.home_score)}:${formatNumber(other.away_score)}`,
      })),
    };
  });
}

/** Die Tabelle der Team-Liga: Platz, Team, Spiele, Punkte - das eigene Team markiert. */
export function leagueTableRows(page: PageLike | null | undefined): Array<{ key: string; pos: string; name: string; played: string; points: string; own: boolean; club_member: boolean }> {
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

// ---------------------------------------------------------------- Kader

export type SquadLine = {
  key: string; name: string; hidden: boolean; member: boolean; appearances: string; total: string;
  cells: Array<{ key: string; code: string; state: "played" | "bench" | "" }>;
};

/** „5 von 7“ - gespielt von den Spielen des Teams mit Aufstellung. */
export function appearanceText(player: Pick<Player, "appearances" | "of"> | null | undefined): string {
  const played = Number(player?.appearances) || 0;
  return Number(player?.of) > 0 ? `${played} von ${player?.of}` : String(played);
}

/** Der Kader in Gruppen: bei mehreren eigenen Teams je Team, dann „Ohne Team“, zuletzt „Gäste“. Je Spieler die
 * Einsätze, über alle Saisons (nur Vereinsmitglieder) und je Spieltag gespielt, Ersatz oder nicht dabei. */
export function squadGroups(page: PageLike | null | undefined): Array<{ key: string; label: string; players: SquadLine[] }> {
  const league = page?.team_league;
  const players = (league?.lineup?.players || []).filter(Boolean);
  const ownTeams = (league?.own_teams || []).filter(Boolean);
  const roundIds = league?.lineup?.round_ids || [];
  const rounds = new Map((page?.rounds || []).map((round) => [round.id, round]));
  for (const day of league?.matchdays || []) if (day?.round?.id && !rounds.has(day.round.id)) rounds.set(day.round.id, day.round);
  const line = (player: Player, index: number): SquadLine => ({
    key: String(player.key || `p${index}`),
    name: nameOf(player),
    hidden: Boolean(player.name_hidden || !player.name),
    member: Boolean(player.club_member),
    appearances: appearanceText(player),
    total: player.club_member && player.all_seasons !== null && player.all_seasons !== undefined ? String(player.all_seasons) : "",
    cells: roundIds.map((id) => ({
      key: id,
      code: roundLabel(rounds.get(id)),
      state: (player.round_ids || []).includes(id) ? "played" : (player.bench_round_ids || []).includes(id) ? "bench" : "",
    })),
  });
  const members = players.filter((player) => !player.guest);
  const guests = players.filter((player) => player.guest);
  const groups: Array<{ key: string; label: string; players: SquadLine[] }> = [];
  if (ownTeams.length > 1) {
    const teams = [...ownTeams, ...new Set(members.map((player) => player.team).filter((team): team is string => Boolean(team) && !ownTeams.includes(String(team))))];
    for (const team of teams) {
      const list = members.filter((player) => player.team === team);
      if (list.length) groups.push({ key: `team-${team}`, label: team, players: list.map(line) });
    }
    const rest = members.filter((player) => !teams.includes(String(player.team)));
    if (rest.length) groups.push({ key: "members", label: "Ohne Team", players: rest.map(line) });
  } else if (members.length) {
    groups.push({ key: "members", label: "", players: members.map(line) });
  }
  if (guests.length) groups.push({ key: "guests", label: "Gäste", players: guests.map(line) });
  return groups;
}

// ---------------------------------------------------------------- Maps

const FIGURES: Array<[string, string]> = [
  ["played", "Gespielt"], ["won", "Siege"], ["drawn", "Unentschieden"], ["lost", "Niederlagen"],
  ["picked_own", "Unsere Wahl"], ["picked_opponent", "Wahl Gegner"], ["picked", "Gewählt"], ["decider", "Decider"],
  ["banned_own", "Unser Bann"], ["banned_opponent", "Bann Gegner"], ["banned", "Gebannt"],
];

/** Statistik einer Map: nur Werte über null - „Gespielt 3 · Siege 2 · Unsere Wahl 2“. */
export function statFigures(stat: MapStat | null | undefined): Array<{ key: string; label: string; value: number }> {
  return FIGURES.filter(([key]) => Number(stat?.[key]) > 0).map(([key, label]) => ({ key, label, value: Number(stat?.[key]) }));
}

export function mapStatCards(page: PageLike | null | undefined): Array<{ key: string; name: string; image: string; figures: Array<{ key: string; label: string; value: number }> }> {
  return (page?.team_league?.map_stats || []).filter((stat) => stat?.name).map((stat, index) => ({
    key: String(stat.map_id || `${stat.name}-${index}`),
    name: String(stat.name),
    image: stat.image_url || "",
    figures: statFigures(stat),
  }));
}

export type PoolGroup = { key: string; heading: string; count: string; maps: Array<{ key: string; name: string; image: string }> };

/** Ein Map-Pool je Modus: Gruppen ohne Maps fallen weg; Überschriften nur bei mehreren Gruppen oder einem Modus. */
export function poolGroups(pool: MapPool): PoolGroup[] {
  const groups = (pool?.modes || []).filter((group) => (group?.maps || []).some((map) => map?.name));
  const headed = groups.length > 1 || Boolean(groups[0]?.mode);
  return groups.map((group, index) => {
    const maps = (group.maps || []).filter((map) => map?.name).map((map, position) => ({ key: String(map.map_id || map.slug || `${map.name}-${position}`), name: String(map.name), image: map.image_url || "" }));
    return {
      key: String(group.mode || `alle-${index}`),
      heading: headed ? String(group.label || group.mode || "") : "",
      count: maps.length === 1 ? "1 Map" : `${maps.length} Maps`,
      maps,
    };
  });
}

/** Map-Pools eines Turniers (#1616): der des Turniers und je Phase mit eigenem Pool „Map-Pool · Phase“. */
export function tournamentPoolSections(overview: { tournament?: MapPool | null; stages?: Array<{ stage_id?: string | null; name?: string | null; pool?: (MapPool & { origin?: string | null }) | null }> | null } | null | undefined): Array<{ key: string; title: string; groups: PoolGroup[] }> {
  if (!overview || typeof overview !== "object") return [];
  const sections: Array<{ key: string; title: string; groups: PoolGroup[] }> = [];
  if (overview.tournament) sections.push({ key: "tournament", title: "Map-Pool", groups: poolGroups(overview.tournament) });
  for (const stage of overview.stages || []) {
    if (stage?.pool?.origin === "stage") sections.push({ key: String(stage.stage_id || stage.name), title: `Map-Pool · ${stage.name || "Phase"}`, groups: poolGroups(stage.pool) });
  }
  return sections.filter((section) => section.groups.length);
}
