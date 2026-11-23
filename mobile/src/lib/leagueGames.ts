// Liga-Ergebnis je Map mit Aufstellung (docs/LIGA.md C.3, #1650; App #2173): was das Meldeformular rechnet - derselbe Weg wie
// frontend/src/components/tls/league/leagueGames.js (Teil für Captain und Vertreter, ohne Ergebnis-Fenster der Leitung). Der Server
// prüft alles noch einmal (services/league_games.py) - hier geht es darum, dass man gar nicht erst etwas Falsches eingibt.
import { mapRuleProblem, ruleFor, type ResultRule } from "./leagueResultRules";

export type LeaguePerson = { id: string; name?: string | null; avatar_url?: string | null; game_id_text?: string | null; lineup_blocked?: string | null };
export type PoolMap = { map_id: string; name?: string | null; image_url?: string | null };
export type PoolMode = { mode?: string | null; label?: string | null; icon_url?: string | null; maps?: PoolMap[] };
export type LeagueSide = { registration_id: string; name?: string | null };
export type PlannedGame = {
  position: number; mode?: string | null; mode_label?: string | null; map_id: string; map_name?: string | null; map_image_url?: string | null;
  role?: string | null; by_registration_id?: string | null;
};
/** Eine Map, wie der Server sie zeigt (`own_games`, `proposal_games`, `games`). */
export type ServerGame = {
  position: number; mode?: string | null; mode_label?: string | null; map_id?: string | null; map_name?: string | null;
  winner_registration_id?: string | null; scores?: Record<string, number | string | null> | null;
};

/** Der Block `league` der Matchseite - alle Felder optional, ältere Server schicken manche nicht. */
export type LeagueBlock = {
  lineup_mode?: string | null;
  lineup_min_players?: number | null;
  own_lineup?: Array<LeaguePerson | string> | null;
  best_of?: number | null;
  needed?: number | null;
  team_size?: number | null;
  mode_order?: string[] | null;
  pool?: { id?: string | null; modes?: PoolMode[] } | null;
  sides?: LeagueSide[];
  own_registration_id?: string | null;
  roster?: LeaguePerson[];
  planned_games?: PlannedGame[] | null;
  own_games?: ServerGame[] | null;
  proposal_games?: ServerGame[] | null;
  games?: ServerGame[] | null;
  map_repeat?: string | null;
  result_rules?: Record<string, ResultRule> | null;
  scores_required?: boolean | null;
  not_played?: number[] | null;
  lineups_missing?: string[] | null;
  [key: string]: unknown;
};

/** Eine Map im Formular. */
export type FormGame = {
  position: number;
  mode: string;
  map_id: string;
  winner: string;
  scores: Record<string, string>;
  lineup: string[];
  planned?: boolean;
};

/** Teilnehmerliste einmal je Spiel (#2204): Staffeln ohne Feld bleiben bei der Aufstellung je Map. */
export function isSeries(league?: LeagueBlock | null): boolean {
  return league?.lineup_mode === "series";
}

/** Was an der Teilnehmerliste fehlt - der Satz für die Seite, sonst `null`. Nach oben offen. */
export function participantsProblem(ids: string[] | null | undefined, league?: LeagueBlock | null): string | null {
  const minimum = league?.lineup_min_players || 1;
  return (ids || []).length < minimum ? `Bitte mindestens ${minimum} Personen ankreuzen, die gespielt haben.` : null;
}

/** Die Kennungen einer Liste aus Personen - für den Startstand eines Formulars. */
export function personIds(people?: Array<LeaguePerson | string> | null): string[] {
  return (people || []).map((person) => (typeof person === "string" ? person : person?.id)).filter((id): id is string => Boolean(id));
}

/** Die Seiten in der Reihenfolge der Plätze des Spiels (Heim zuerst, #2096) - auch bei einem älteren Stand des Servers. */
export function sidesInSlotOrder<T extends LeagueBlock | null | undefined>(league: T, match?: { slots?: Array<{ registration_id?: string | null } | null> } | null): T {
  if (!league?.sides?.length) return league;
  const slots = (match?.slots || []).map((slot) => slot?.registration_id).filter(Boolean) as string[];
  if (!slots.length) return league;
  const rank = (side: LeagueSide) => {
    const at = slots.indexOf(side.registration_id);
    return at < 0 ? slots.length : at;
  };
  const sides = [...league.sides].sort((a, b) => rank(a) - rank(b));
  return sides.every((side, index) => side === league.sides?.[index]) ? league : { ...league, sides };
}

/** Die Modi des Pools (ohne „Alle Maps“ eines Spiels ohne Modi). */
export function poolModes(pool?: LeagueBlock["pool"]): PoolMode[] {
  return (pool?.modes || []).filter((group) => group.mode);
}

/** Der Modus einer Position: fest aus der Reihenfolge der Season, sonst der einzige Modus des Pools, sonst frei. */
export function modeFor(position: number, league?: LeagueBlock | null): string {
  const order = league?.mode_order || [];
  if (order.length) return order[(position - 1) % order.length];
  const modes = poolModes(league?.pool);
  return modes.length === 1 ? String(modes[0].mode) : "";
}

/** Die Maps, die der Pool für diesen Modus freigibt. */
export function mapsFor(pool: LeagueBlock["pool"], mode?: string | null): PoolMap[] {
  const groups = pool?.modes || [];
  const group = groups.find((row) => (row.mode || "") === (mode || "")) || (groups.length === 1 && !groups[0].mode ? groups[0] : null);
  return group?.maps || [];
}

export function modeLabel(pool: LeagueBlock["pool"], mode?: string | null): string {
  return (pool?.modes || []).find((row) => row.mode === mode)?.label || mode || "";
}

/** Das Symbol des Modus aus dem Pool (#2266) - leer ohne Symbol. */
export function modeIcon(pool: LeagueBlock["pool"], mode?: string | null): string {
  return (pool?.modes || []).find((row) => row.mode === mode)?.icon_url || "";
}

/** Die Map, die das Veto für diese Position festgelegt hat (#1618, D.3) - sonst `null`. */
export function plannedFor(position: number, league?: LeagueBlock | null): PlannedGame | null {
  return (league?.planned_games || []).find((row) => Number(row.position) === Number(position)) || null;
}

export function emptyGame(position: number, league?: LeagueBlock | null): FormGame {
  const plan = plannedFor(position, league);
  if (plan) return { position, mode: plan.mode || "", map_id: plan.map_id, winner: "", scores: {}, lineup: [], planned: true };
  return { position, mode: modeFor(position, league), map_id: "", winner: "", scores: {}, lineup: [] };
}

/** Gewonnene Maps je Seite. */
export function tally(games: Array<{ winner?: string }>, sides?: LeagueSide[]): Record<string, number> {
  const wins: Record<string, number> = Object.fromEntries((sides || []).map((side) => [side.registration_id, 0]));
  for (const game of games || []) {
    if (game.winner && game.winner in wins) wins[game.winner] += 1;
  }
  return wins;
}

/** Wer die Serie gewonnen hat - oder `null`, solange es noch offen ist. */
export function seriesWinner(games: Array<{ winner?: string }>, league?: LeagueBlock | null): string | null {
  const wins = tally(games, league?.sides);
  return Object.keys(wins).find((side) => wins[side] >= (league?.needed || 1)) || null;
}

/** Trägt die Map schon etwas (Map, Sieger, Punkte)? */
function hasEntries(game?: FormGame | null): boolean {
  return Boolean(game?.map_id || game?.winner || Object.values(game?.scores || {}).some((value) => String(value ?? "").trim()));
}

/** Das Gedächtnis des Formulars: je Position die zuletzt bearbeitete Map, auch wenn sie gerade ausgeblendet ist. */
export function rememberGames(memory: Record<number, FormGame> | null | undefined, games: FormGame[]): Record<number, FormGame> {
  const out = { ...(memory || {}) };
  for (const game of games || []) out[game.position] = game;
  return out;
}

/**
 * Nach einer Änderung: nur so viele Maps, wie gespielt wurden. Ist die Serie entschieden, fallen Maps danach weg; hat die letzte
 * Map einen Sieger und ist noch nichts entschieden, kommt die nächste dazu. Eine weggefallene Map kommt aus `memory` mit ihren
 * Angaben zurück, sobald die Serie wieder offen ist (#2334).
 */
export function settleGames(games: FormGame[], league?: LeagueBlock | null, memory: Record<number, FormGame> = {}): FormGame[] {
  const out: FormGame[] = [];
  for (const game of games) {
    out.push(game);
    if (seriesWinner(out, league)) return out;
  }
  const bestOf = league?.best_of || 1;
  while (out.length < bestOf) {
    const last = out[out.length - 1];
    if (last && !last.winner) break;
    const kept = memory?.[out.length + 1];
    if (hasEntries(kept)) {
      out.push(kept);
      if (seriesWinner(out, league)) break;
      continue;
    }
    out.push({ ...emptyGame(out.length + 1, league), lineup: [...(last?.lineup || [])] });
    break;
  }
  return out;
}

export function startGames(league?: LeagueBlock | null): FormGame[] {
  return settleGames([], league);
}

function scoreValue(value: unknown): number | null | undefined {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/** Beide Punkte einer Map als Zahl - sonst `null` (fehlt eine Seite oder ist keine Zahl). */
function bothScores(game: { scores?: Record<string, unknown> | null }, league?: LeagueBlock | null) {
  const sides = (league?.sides || []).map((side) => side.registration_id);
  if (sides.length !== 2) return null;
  const values = sides.map((id) => scoreValue(game?.scores?.[id]));
  return values.every((value): value is number => typeof value === "number") ? { sides, values: values as number[] } : null;
}

/** Sieger einer Map aus den Punkten: Wer mehr hat, hat gewonnen. `null`, solange eine Seite fehlt oder beide gleich viel haben. */
export function scoreWinner(game: { scores?: Record<string, unknown> | null }, league?: LeagueBlock | null): string | null {
  const both = bothScores(game, league);
  if (!both || both.values[0] === both.values[1]) return null;
  return both.values[0] > both.values[1] ? both.sides[0] : both.sides[1];
}

/** Gleich viele Punkte auf beiden Seiten - dann muss jemand den Sieger antippen. */
export function scoresTied(game: { scores?: Record<string, unknown> | null }, league?: LeagueBlock | null): boolean {
  const both = bothScores(game, league);
  return Boolean(both) && both!.values[0] === both!.values[1];
}

/** Neue Punkte: Stehen beide da und sind verschieden, setzt das den Sieger; Gleichstand macht ihn offen. */
export function withScores(game: FormGame, scores: Record<string, string>, league?: LeagueBlock | null): FormGame {
  const next = { ...game, scores };
  const auto = scoreWinner(next, league);
  if (auto) return { ...next, winner: auto };
  if (scoresTied(next, league)) return { ...next, winner: "" };
  const before = scoreWinner(game, league);
  return { ...next, winner: before && game.winner === before ? "" : game.winner };
}

/**
 * Darf diese Map an dieser Position noch gewählt werden (Season-Vorgabe „Map-Wiederholung in einer Serie“, #2096)? Gibt die
 * frühere Map zurück, mit der sie sich beißt - sonst `null`.
 */
export function repeatedMap(games: FormGame[], position: number, mode: string, mapId: string, league?: LeagueBlock | null): FormGame | null {
  const rule = league?.map_repeat || "other_mode";
  if (rule === "always" || !mapId) return null;
  return (games || []).find((game) => game.position < position && game.map_id === mapId
    && (rule === "never" || (game.mode || "") === (mode || ""))) || null;
}

/** Was noch fehlt - der erste Satz für die Seite, sonst `null`. `withLineup`: die eigene Aufstellung ist Pflicht. */
export function gamesProblem(games: FormGame[], league: LeagueBlock, { withLineup = true, needMaps = true, skipRules = false } = {}): string | null {
  const sides = league.sides || [];
  for (const game of games) {
    const label = `Map ${game.position}`;
    if (needMaps) {
      if (poolModes(league.pool).length && !game.mode) return `${label}: bitte den Modus wählen.`;
      if (!game.map_id) return `${label}: bitte die Map wählen.`;
      const earlier = repeatedMap(games, game.position, game.mode, game.map_id, league);
      if (earlier) {
        return league.map_repeat === "never"
          ? `${label}: diese Map lief schon als Map ${earlier.position} – jede Map nur einmal je Serie.`
          : `${label}: diese Map lief schon als Map ${earlier.position} im selben Modus – bitte eine andere wählen.`;
      }
      for (const value of Object.values(game.scores || {})) {
        if (scoreValue(value) === undefined) return `${label}: Punkte bitte als Zahl ab 0.`;
      }
      if (!game.winner) {
        if (scoresTied(game, league)) {
          const rule = ruleFor(league, game.mode);
          if (rule && !rule.draw_allowed && !skipRules && sides[0]) return mapRuleProblem({ ...game, winner: sides[0].registration_id }, league);
          return `${label}: Gleichstand – bitte antippen, wer die Map gewonnen hat.`;
        }
        return league.scores_required && !skipRules
          ? `${label}: bitte die Punkte beider Seiten eintragen – daraus ergibt sich der Sieger.`
          : `${label}: bitte antippen, wer die Map gewonnen hat.`;
      }
      const ruleProblem = skipRules ? null : mapRuleProblem(game, league);
      if (ruleProblem) return ruleProblem;
    }
    if (withLineup && (game.lineup || []).length !== league.team_size) {
      return `${label}: bitte genau ${league.team_size} Spieler aufstellen.`;
    }
  }
  if (needMaps && !seriesWinner(games, league)) {
    const needed = league.needed || 1;
    return `Best of ${league.best_of}: eine Seite braucht ${needed} gewonnene ${needed === 1 ? "Map" : "Maps"}.`;
  }
  return null;
}

/** „Loewen · Rudel A gewinnt 2:1“ - der Satz vor dem Absenden. */
export function seriesSentence(games: FormGame[], league: LeagueBlock): string {
  const winner = seriesWinner(games, league);
  if (!winner) return "";
  const wins = tally(games, league.sides);
  const loser = Object.keys(wins).find((side) => side !== winner);
  const name = (league.sides || []).find((side) => side.registration_id === winner)?.name || "Sieger";
  return `${name} gewinnt ${wins[winner]}:${loser ? wins[loser] ?? 0 : 0}`;
}

export type ReportGame = {
  position: number; mode: string | null; map_id: string; winner_registration_id: string; scores?: Record<string, number>; lineup?: string[];
};
export type LeagueReportPayload = {
  results: Array<{ registration_id: string; rank: number; score: number }>;
  lineup?: string[];
  games: ReportGame[];
};

/** Was an den Server geht: Ergebnis (Plätze, gewonnene Maps) und je Map Modus, Map, Sieger, Punkte, eigene Aufstellung. */
export function reportPayload(games: FormGame[], league: LeagueBlock, lineup: string[] | null = null): LeagueReportPayload {
  const wins = tally(games, league.sides);
  const ordered = Object.keys(wins).sort((a, b) => wins[b] - wins[a]);
  const series = isSeries(league);
  return {
    results: ordered.map((side, index) => ({ registration_id: side, rank: index + 1, score: wins[side] })),
    ...(series ? { lineup: lineup || [] } : {}),
    games: games.map((game) => {
      const scores = Object.fromEntries(Object.entries(game.scores || {})
        .map(([side, value]) => [side, scoreValue(value)] as const)
        .filter((pair): pair is readonly [string, number] => pair[1] !== null && pair[1] !== undefined));
      return {
        position: game.position,
        mode: game.mode || null,
        map_id: game.map_id,
        winner_registration_id: game.winner,
        ...(Object.keys(scores).length ? { scores } : {}),
        ...(series ? {} : { lineup: game.lineup }),
      };
    }),
  };
}

/** Bestätigen: die Maps der Gegenseite übernehmen, je Map die eigene Aufstellung dazu (bzw. die Teilnehmerliste). */
export function confirmPayload(proposalGames: ServerGame[] | null | undefined, lineups: Record<number, string[]> | string[], league: LeagueBlock): LeagueReportPayload {
  const series = isSeries(league);
  const games: FormGame[] = (proposalGames || []).map((game) => ({
    position: game.position,
    mode: game.mode || "",
    map_id: String(game.map_id || ""),
    winner: String(game.winner_registration_id || ""),
    scores: {},
    lineup: series || Array.isArray(lineups) ? [] : lineups[game.position] || [],
  }));
  return reportPayload(games, league, series && Array.isArray(lineups) ? lineups : null);
}

/** Ein Spieler-Chip antippen: rein oder raus - nie mehr als die Teamgröße; ohne `size` nach oben offen (#2204). */
export function toggleLineup(lineup: string[], userId: string, size?: number | null): string[] {
  if (lineup.includes(userId)) return lineup.filter((id) => id !== userId);
  if (size != null && lineup.length >= size) return lineup;
  return [...lineup, userId];
}

function sameList(first: string[] = [], second: string[] = []): boolean {
  return first.length === second.length && first.every((item, index) => item === second[index]);
}

/** Eine Aufstellung ändern: spätere Maps mit bisher derselben (oder keiner) Aufstellung ziehen mit. */
export function followLineups(lineups: Record<number, string[]>, position: number, lineup: string[]): Record<number, string[]> {
  const before = lineups[position] || [];
  const next = { ...lineups, [position]: lineup };
  for (const [key, value] of Object.entries(lineups)) {
    if (Number(key) > position && sameList(value || [], before)) next[Number(key)] = lineup;
  }
  return next;
}

/** Dasselbe für die Maps des Meldeformulars. */
export function changeGame(games: FormGame[], position: number, game: FormGame): FormGame[] {
  const lineups = followLineups(Object.fromEntries(games.map((row) => [row.position, row.lineup || []])), position, game.lineup || []);
  return games.map((row) => (row.position === position ? game : { ...row, lineup: lineups[row.position] }));
}

/** Wer ohne gültige Spiel-ID bzw. nach den Regeln nicht aufgestellt werden kann (#2108, #2204) - mit Grund. */
export function blockedPlayers(roster: LeaguePerson[] = []): Array<{ id: string; name: string; reason: string }> {
  return roster.filter((person) => person?.lineup_blocked).map((person) => ({ id: person.id, name: person.name || "Spieler", reason: String(person.lineup_blocked) }));
}
