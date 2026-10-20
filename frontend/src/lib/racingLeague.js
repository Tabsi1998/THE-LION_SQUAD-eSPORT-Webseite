// Rennliga (#1746): was die Seite einer Rennliga aus /api/reference-series/public/<spur>/<saison> liest. Der Server
// rechnet und speichert alles (Punkte, Rang, Teamwertung, Team je Rennen); hier wird nur beschriftet und gezählt, was
// im Stand schon steht: Zellen des Rennrasters, Abstand zur Spitze, Sieger und bester Vereinsfahrer je Rennen,
// Fahrer-Detail, Teamduell und Vereins-Garage. Wer ein Fahrer-Detail bekommt und außerhalb der Tabellen mit Namen
// steht, sagt der Server (`racing.club_drivers`: öffentlich sichtbare Vereinsmitglieder); alle anderen heißen außerhalb
// der Tabellen „Gastfahrer“ - fremde Namen stehen nur in den Tabellen. Punkte fürs Team kommen aus der gespeicherten
// Teamwertung (`driver_points`), nie aus einer eigenen Rechnung.
import { formatDiff, formatNumber } from "@/lib/standingsTable";
import { resultIn, roundColumns } from "@/lib/referenceSeriesTable";

const MEDALS = { 1: "gold", 2: "silver", 3: "bronze" };
const STATUS_TEXT = { dnf: "DNF", dns: "DNS", dsq: "DSQ" };
const STATUS_WORDS = { dnf: "ausgefallen", dns: "nicht gestartet", dsq: "disqualifiziert" };

function points(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function pointsWord(value) {
  return `${formatNumber(value)} ${points(value) === 1 ? "Punkt" : "Punkte"}`;
}

/** Zelle im Rennraster: Platz (Podium in Gold, Silber, Bronze) oder DNF/DNS/DSQ, dazu schnellste Runde und Pole. */
export function raceCell(result) {
  if (!result) return null;
  const marks = new Set(result.marks || []);
  const status = ["dsq", "dns", "dnf"].find((mark) => marks.has(mark)) || "finished";
  const place = Number.isInteger(result.place) && result.place > 0 ? result.place : null;
  return {
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

/** Die Zelle für Screenreader und Tooltip: „R1: Platz 1, 26 Punkte, schnellste Runde“. */
export function raceCellLabel(cell, roundName) {
  if (!cell) return `${roundName}: nicht dabei`;
  const parts = [STATUS_WORDS[cell.status] || (cell.place ? `Platz ${cell.place}` : "ohne Platz"), pointsWord(cell.points)];
  if (cell.fastest) parts.push("schnellste Runde");
  if (cell.pole) parts.push("Pole");
  if (cell.dropped) parts.push("gestrichen");
  return `${roundName}: ${parts.join(", ")}`;
}

/** Abstand zur Spitze in Punkten („−7“); wer vorn liegt (auch punktgleich), hat keinen. */
export function gapLabel(row, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return "";
  const lead = Math.max(...list.map((item) => points(item.points)));
  const gap = points(row?.points) - lead;
  return gap < 0 ? formatDiff(gap) : "";
}

function classified(cell) {
  return cell && cell.status === "finished" && cell.place;
}

export const GUEST_DRIVER = "Gastfahrer";

/** Ein Rennen auf einen Blick, nur mit öffentlichen Vereinsfahrern (`publicKeys` vom Server): der Sieger, wenn er
 * einer von ihnen ist, und der beste von ihnen mit Platz (ein Ausfall nur, wenn keiner ins Ziel kam; ein Nichtstart
 * nie). Ein fremder Sieger bleibt außerhalb der Tabelle ohne Namen. */
export function raceSummary(rows, roundId, publicKeys = []) {
  const allowed = new Set(publicKeys || []);
  const entries = (rows || []).filter((row) => allowed.has(row.key))
    .map((row) => ({ row, cell: raceCell(resultIn(row, roundId)) })).filter((item) => item.cell);
  const winner = entries.find((item) => classified(item.cell) && item.cell.place === 1)?.row || null;
  const club = entries.filter((item) => item.cell.status !== "dns");
  club.sort((a, b) => Number(!classified(a.cell)) - Number(!classified(b.cell))
    || (a.cell.place ?? Infinity) - (b.cell.place ?? Infinity));
  return { winner, bestClub: club[0] || null };
}

/** Die Saison eines Fahrers: Rennen (ohne Nichtstart), Siege, Podien, schnellste Runden, Pole, Ausfälle, bester Platz
 * und je Wertungsrunde die Zelle mit Punkten. */
export function driverSeason(row, rounds) {
  const cells = (row?.results || []).map(raceCell).filter(Boolean);
  const finished = cells.filter(classified).map((cell) => cell.place);
  const perRace = roundColumns(rounds).map((round) => {
    const cell = raceCell(resultIn(row, round.id));
    return { round, cell, points: cell ? points(cell.points) : null };
  });
  return {
    races: cells.filter((cell) => cell.status !== "dns").length,
    wins: finished.filter((place) => place === 1).length,
    podiums: finished.filter((place) => place <= 3).length,
    fastestLaps: cells.filter((cell) => cell.fastest).length,
    poles: cells.filter((cell) => cell.pole).length,
    dnfs: cells.filter((cell) => cell.status === "dnf").length,
    bestPlace: finished.length ? Math.min(...finished) : null,
    perRace,
    maxPoints: Math.max(0, ...perRace.map((item) => item.points || 0)),
  };
}

function forTeam(row, team, drivers) {
  const teams = drivers?.[row?.key]?.round_teams || {};
  return (row?.results || []).filter((item) => teams[item.round_id] === team);
}

/** Teamduell zweier Fahrer eines Teams: in wie vielen gemeinsamen Rennen fürs Team wer vor dem anderen ins Ziel kam
 * (ein Ausfall verliert gegen jeden im Ziel; ohne Nichtstart, beide ausgefallen zählt nicht). Die Punkte fürs Team
 * kommen aus der gespeicherten Teamwertung (`standing.driver_points`, mit gezählten Fahrern und Gast-Regel) - ohne
 * Teamwertung (oder ohne diese Angabe) `null`. */
export function teamDuel(a, b, team, drivers, standing) {
  const mine = forTeam(a, team, drivers);
  const theirs = new Map(forTeam(b, team, drivers).map((item) => [item.round_id, raceCell(item)]));
  let races = 0;
  let aheadA = 0;
  let aheadB = 0;
  for (const item of mine) {
    const own = raceCell(item);
    const other = theirs.get(item.round_id);
    if (!other || own.status === "dns" || other.status === "dns") continue;
    const ownIn = classified(own);
    const otherIn = classified(other);
    if (!ownIn && !otherIn) continue;
    races += 1;
    if (ownIn && (!otherIn || own.place < other.place)) aheadA += 1;
    else aheadB += 1;
  }
  const forTeamPoints = (row) => (standing?.driver_points ? points(standing.driver_points[row.key]) : null);
  return {
    races,
    a: { key: a.key, ahead: aheadA, points: forTeamPoints(a) },
    b: { key: b.key, ahead: aheadB, points: forTeamPoints(b) },
  };
}

/** Vereins-Garage: je Vereinsteam die Fahrer (aktuelles Team) in Tabellen-Reihenfolge, der Platz in der Teamwertung
 * und das Duell der beiden Fahrer mit den meisten Rennen fürs Team. */
export function garageTeams(clubTeams, rows, drivers, teamRows) {
  return (clubTeams || []).map((team) => {
    const members = (rows || []).filter((row) => drivers?.[row.key]?.team === team);
    const started = (row) => forTeam(row, team, drivers).filter((item) => raceCell(item).status !== "dns").length;
    const pair = members.map((row, index) => ({ row, index, races: started(row) }))
      .sort((x, y) => y.races - x.races || x.index - y.index)
      .slice(0, 2);
    const standing = (teamRows || []).find((row) => row.team === team) || null;
    return {
      team,
      standing,
      drivers: members,
      duel: pair.length === 2 ? teamDuel(pair[0].row, pair[1].row, team, drivers, standing) : null,
    };
  });
}

/** Wer ein Fahrer-Detail bekommt: nur die Kennungen, die der Server nennt (`club_drivers`: öffentlich sichtbare
 * Vereinsmitglieder), und davon nur Vereinsmitglieder mit Namen - in Tabellen-Reihenfolge. */
export function clubDrivers(rows, publicKeys = []) {
  const allowed = new Set(publicKeys || []);
  return (rows || []).filter((row) => allowed.has(row.key) && row.club_member && !row.name_hidden && row.name);
}

/** Name in Garage und Teamduell (keine Tabelle): öffentliche Vereinsfahrer mit Namen, Mitglieder ohne öffentliches
 * Profil als „Vereinsfahrer“, alle anderen (Gäste, Fremde) als „Gastfahrer“ - ohne Namen. */
export function garageName(row, publicKeys = []) {
  if (row?.name && !row.name_hidden && row.club_member && (publicKeys || []).includes(row.key)) {
    return { name: row.name, named: true };
  }
  return { name: row?.club_member ? "Vereinsfahrer" : GUEST_DRIVER, named: false };
}

/** Die Teamwertung in der Form der Tabelle: Teamname als Name, Vereinsteams wie Vereinsspieler markiert. */
export function teamTableRows(teamRows, clubTeams) {
  const club = new Set(clubTeams || []);
  return (teamRows || []).map((row) => ({ ...row, name: row.team, name_hidden: false, club_member: club.has(row.team) }));
}

const BONUS_WORDS = { fastest_lap: "die schnellste Runde", pole: "die Pole" };

/** Boni der Saison in Worten: „+1 Punkt für die schnellste Runde (bis Platz 10)“ - leer ohne Bonus. */
export function bonusLabel(rules) {
  return Object.entries(BONUS_WORDS).map(([mark, words]) => {
    const bonus = rules?.bonuses?.[mark];
    if (!bonus || !(points(bonus.points) > 0)) return "";
    const limit = bonus.max_place ? ` (bis Platz ${bonus.max_place})` : "";
    return `+${pointsWord(bonus.points)} für ${words}${limit}`;
  }).filter(Boolean).join(", ");
}

/** Teamwertung in Worten: wie viele Fahrer je Rennen zählen und ob Gäste mitzählen - leer ohne Teamwertung. */
export function teamRuleLabel(scoring) {
  if (!scoring?.enabled) return "";
  const n = Number(scoring.counting_drivers) || 0;
  const counting = n === 1 ? "zählt der beste Fahrer" : n > 1 ? `zählen die besten ${n} Fahrer` : "zählen alle Fahrer";
  return `Je Rennen ${counting} eines Teams. Gäste zählen ${scoring.guests_count ? "" : "nicht "}fürs Team.`;
}

/** Anteil eines Balkens an der Spitze, zwischen 0 und 1. */
export function barShare(value, max) {
  const top = points(max);
  if (top <= 0) return 0;
  return Math.min(1, Math.max(0, points(value) / top));
}
