// Ergebnis je Map mit Aufstellung (docs/LIGA.md, #1650): was das Melde-Formular der Liga rechnet. Der Server prüft
// alles noch einmal (services/league_games.py) - hier geht es darum, dass man gar nicht erst etwas Falsches eingibt.
import { viennaDay, viennaTime } from "@/lib/vienna";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/**
 * Der Standardtermin der Spielwoche als Satz (#2096): „So 15.11., 20:00“ in Wiener Zeit - oder leer ohne Wert.
 */
export function defaultTimeText(value) {
  const day = value ? viennaDay(value) : "";
  if (!day) return "";
  const [year, month, date] = day.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, date, 12)).getUTCDay()];
  return `${weekday} ${date}.${month}., ${viennaTime(value, { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Die Seiten in der Reihenfolge der Plätze des Spiels (Heim links, wie Überschrift und Spielplan, #2096). Der Server
 * liefert sie schon so - das hier hält Sieger-Knöpfe, Punkte und Aufstellungen auch bei einem älteren Stand richtig.
 */
export function sidesInSlotOrder(league, match) {
  if (!league?.sides?.length) return league;
  const slots = (match?.slots || []).map((slot) => slot?.registration_id).filter(Boolean);
  if (!slots.length) return league;
  const rank = (side) => {
    const at = slots.indexOf(side.registration_id);
    return at < 0 ? slots.length : at;
  };
  const sides = [...league.sides].sort((a, b) => rank(a) - rank(b));
  return sides.every((side, index) => side === league.sides[index]) ? league : { ...league, sides };
}

/** Die Modi des Pools (ohne „Alle Maps“ eines Spiels ohne Modi). */
export function poolModes(pool) {
  return (pool?.modes || []).filter((group) => group.mode);
}

/** Der Modus einer Position: fest aus der Reihenfolge der Season, sonst der einzige Modus des Pools, sonst frei. */
export function modeFor(position, league) {
  const order = league?.mode_order || [];
  if (order.length) return order[(position - 1) % order.length];
  const modes = poolModes(league?.pool);
  return modes.length === 1 ? modes[0].mode : "";
}

/** Die Maps, die der Pool für diesen Modus freigibt. */
export function mapsFor(pool, mode) {
  const groups = pool?.modes || [];
  const group = groups.find((row) => (row.mode || "") === (mode || "")) || (groups.length === 1 && !groups[0].mode ? groups[0] : null);
  return group?.maps || [];
}

export function modeLabel(pool, mode) {
  return (pool?.modes || []).find((row) => row.mode === mode)?.label || mode || "";
}

export function emptyGame(position, league) {
  return { position, mode: modeFor(position, league), map_id: "", winner: "", scores: {}, lineup: [] };
}

/** Gewonnene Maps je Seite. */
export function tally(games, sides) {
  const wins = Object.fromEntries((sides || []).map((side) => [side.registration_id, 0]));
  for (const game of games || []) {
    if (game.winner && game.winner in wins) wins[game.winner] += 1;
  }
  return wins;
}

/** Wer die Serie gewonnen hat - oder `null`, solange es noch offen ist. */
export function seriesWinner(games, league) {
  const wins = tally(games, league?.sides);
  return Object.keys(wins).find((side) => wins[side] >= (league?.needed || 1)) || null;
}

/**
 * Nach einer Änderung: nur so viele Maps, wie gespielt wurden. Ist die Serie entschieden, fallen Maps danach weg;
 * hat die letzte Map einen Sieger und ist noch nichts entschieden, kommt die nächste dazu.
 */
export function settleGames(games, league) {
  const out = [];
  for (const game of games) {
    out.push(game);
    if (seriesWinner(out, league)) return out;
  }
  const last = out[out.length - 1];
  if ((!last || last.winner) && out.length < (league?.best_of || 1)) {
    const previous = last?.lineup || [];
    return [...out, { ...emptyGame(out.length + 1, league), lineup: [...previous] }];
  }
  return out;
}

export function startGames(league) {
  return settleGames([], league);
}

function scoreValue(value) {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

/**
 * Darf diese Map an dieser Position noch gewählt werden (Season-Vorgabe „Map-Wiederholung in einer Serie“, #2096)?
 * Gibt die frühere Map zurück, mit der sie sich beißt - sonst `null`. „other_mode“ (Vorgabe): dieselbe Map nur in
 * einem anderen Modus; „never“: jede Map einmal; „always“: frei.
 */
export function repeatedMap(games, position, mode, mapId, league) {
  const rule = league?.map_repeat || "other_mode";
  if (rule === "always" || !mapId) return null;
  return (games || []).find((game) => game.position < position && game.map_id === mapId
    && (rule === "never" || (game.mode || "") === (mode || ""))) || null;
}

/** Was noch fehlt - der erste Satz für die Seite, sonst `null`. `withLineup`: die eigene Aufstellung ist Pflicht. */
export function gamesProblem(games, league, { withLineup = true, needMaps = true } = {}) {
  for (const game of games) {
    const label = `Map ${game.position}`;
    if (needMaps) {
      if (poolModes(league?.pool).length && !game.mode) return `${label}: bitte den Modus wählen.`;
      if (!game.map_id) return `${label}: bitte die Map wählen.`;
      const earlier = repeatedMap(games, game.position, game.mode, game.map_id, league);
      if (earlier) {
        return league?.map_repeat === "never"
          ? `${label}: diese Map lief schon als Map ${earlier.position} – jede Map nur einmal je Serie.`
          : `${label}: diese Map lief schon als Map ${earlier.position} im selben Modus – bitte eine andere wählen.`;
      }
      if (!game.winner) return `${label}: bitte antippen, wer die Map gewonnen hat.`;
      for (const value of Object.values(game.scores || {})) {
        if (scoreValue(value) === undefined) return `${label}: Punkte bitte als Zahl ab 0.`;
      }
    }
    if (withLineup && (game.lineup || []).length !== league.team_size) {
      return `${label}: bitte genau ${league.team_size} Spieler aufstellen.`;
    }
  }
  if (needMaps && !seriesWinner(games, league)) {
    return `Best of ${league.best_of}: eine Seite braucht ${league.needed} gewonnene ${league.needed === 1 ? "Map" : "Maps"}.`;
  }
  return null;
}

/** „Loewen · Rudel A gewinnt 2:1“ - der Satz vor dem Absenden. */
export function seriesSentence(games, league) {
  const winner = seriesWinner(games, league);
  if (!winner) return "";
  const wins = tally(games, league.sides);
  const loser = Object.keys(wins).find((side) => side !== winner);
  const name = league.sides.find((side) => side.registration_id === winner)?.name || "Sieger";
  return `${name} gewinnt ${wins[winner]}:${wins[loser] ?? 0}`;
}

/** Was an den Server geht: Ergebnis (Plätze, gewonnene Maps) und je Map Modus, Map, Sieger, Punkte, eigene Aufstellung. */
export function reportPayload(games, league) {
  const wins = tally(games, league.sides);
  const ordered = Object.keys(wins).sort((a, b) => wins[b] - wins[a]);
  return {
    results: ordered.map((side, index) => ({ registration_id: side, rank: index + 1, score: wins[side] })),
    games: games.map((game) => {
      const scores = Object.fromEntries(Object.entries(game.scores || {})
        .map(([side, value]) => [side, scoreValue(value)])
        .filter(([, value]) => value !== null && value !== undefined));
      return {
        position: game.position,
        mode: game.mode || null,
        map_id: game.map_id,
        winner_registration_id: game.winner,
        ...(Object.keys(scores).length ? { scores } : {}),
        lineup: game.lineup,
      };
    }),
  };
}

/** Bestätigen: die Maps der Gegenseite übernehmen, je Map die eigene Aufstellung dazu. */
export function confirmPayload(proposalGames, lineups, league) {
  const games = (proposalGames || []).map((game) => ({
    position: game.position,
    mode: game.mode || "",
    map_id: game.map_id,
    winner: game.winner_registration_id,
    scores: {},
    lineup: lineups[game.position] || [],
  }));
  return reportPayload(games, league);
}

/** Ein Spieler-Chip antippen: rein oder raus - nie mehr als die Teamgröße. */
export function toggleLineup(lineup, userId, size) {
  if (lineup.includes(userId)) return lineup.filter((id) => id !== userId);
  if (lineup.length >= size) return lineup;
  return [...lineup, userId];
}

function sameList(first = [], second = []) {
  return first.length === second.length && first.every((item, index) => item === second[index]);
}

/**
 * Eine Aufstellung ändern: spätere Maps, die bisher dieselbe Aufstellung hatten (oder noch keine), ziehen mit - wer
 * Map 1 aufstellt, muss Map 2 und 3 nur ändern, wenn sich dort etwas ändert. `lineups`: Position → Kennungen.
 */
export function followLineups(lineups, position, lineup) {
  const before = lineups[position] || [];
  const next = { ...lineups, [position]: lineup };
  for (const [key, value] of Object.entries(lineups)) {
    if (Number(key) > position && sameList(value || [], before)) next[key] = lineup;
  }
  return next;
}

/** Dasselbe für die Maps des Melde-Formulars. */
export function changeGame(games, position, game) {
  const lineups = followLineups(Object.fromEntries(games.map((row) => [row.position, row.lineup || []])), position, game.lineup || []);
  return games.map((row) => (row.position === position ? game : { ...row, lineup: lineups[row.position] }));
}
// ---------------------------------------------------------------- Turnierleitung (Ergebnis-Fenster)

function lineupIds(people) {
  return (people || []).map((person) => (typeof person === "string" ? person : person.id)).filter(Boolean);
}

/** Startstand des Ergebnis-Fensters: die geltenden Maps, sonst die Meldung einer Seite, sonst leer. */
export function staffStart(league) {
  const source = (league?.games?.length ? league.games : league?.proposal_games) || [];
  if (!source.length) return settleStaffGames([], league);
  return source.map((game) => ({
    position: game.position,
    mode: game.mode || "",
    map_id: game.map_id,
    winner: game.winner_registration_id,
    scores: Object.fromEntries(Object.entries(game.scores || {}).map(([side, value]) => [side, String(value)])),
    lineup: [],
    lineups: Object.fromEntries(Object.entries(game.lineups || {}).map(([side, people]) => [side, lineupIds(people)])),
  }));
}

/** Wie `settleGames` - eine neue Map übernimmt die Aufstellungen beider Seiten aus der Map davor. */
export function settleStaffGames(games, league) {
  const settled = settleGames(games, league);
  return settled.map((game, index) => (game.lineups ? game : { ...game, lineups: { ...(settled[index - 1]?.lineups || {}) } }));
}

/** Was fehlt: wie beim Melden, Aufstellungen je Seite aber freiwillig - wenn, dann vollständig. */
export function staffProblem(games, league) {
  const problem = gamesProblem(games, league, { withLineup: false });
  if (problem) return problem;
  for (const game of games) {
    for (const side of league.sides) {
      const count = (game.lineups?.[side.registration_id] || []).length;
      if (count && count !== league.team_size) {
        return `Map ${game.position}: Aufstellung ${side.name} – genau ${league.team_size} Spieler oder keine.`;
      }
    }
  }
  return null;
}

/** Ergebnis und Maps für POST /matches/{id}/result - mit den vollständigen Aufstellungen beider Seiten. */
export function staffPayload(games, league) {
  const payload = reportPayload(games, league);
  return {
    results: payload.results,
    games: payload.games.map(({ lineup: _ignored, ...game }, index) => {
      const lineups = Object.fromEntries(Object.entries(games[index].lineups || {})
        .filter(([, ids]) => (ids || []).length === league.team_size));
      return Object.keys(lineups).length ? { ...game, lineups } : game;
    }),
  };
}
/** Wie `changeGame` für die Turnierleitung: je Seite ziehen spätere Maps mit gleicher (oder leerer) Aufstellung mit. */
export function changeStaffGame(games, position, game) {
  let rows = games.map((row) => (row.position === position ? { ...game, lineups: row.lineups || {} } : row));
  for (const [side, lineup] of Object.entries(game.lineups || {})) {
    const followed = followLineups(Object.fromEntries(rows.map((row) => [row.position, row.lineups?.[side] || []])), position, lineup);
    rows = rows.map((row) => ({ ...row, lineups: { ...(row.lineups || {}), [side]: followed[row.position] } }));
  }
  return rows.map((row) => (row.position === position ? { ...game, lineups: { ...row.lineups } } : row));
}