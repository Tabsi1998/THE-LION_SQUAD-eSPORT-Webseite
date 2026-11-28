// Liga-Abzeichen (#1638) und laufende Ligen (#1630): reine Hilfen ohne React - Web, Tests und (als Vorlage) die App rechnen gleich.
// Der Server liefert je Eintrag `badge: {level, nickname, champion}` (services/league_current.badge). Die Stufe zeigt sich über die
// Form: Liga 1 mit Krone und zartem Glanz, Liga 2 mit doppeltem Rand, ab Liga 3 schlicht. Cyan ist die Markenfarbe, Gold gibt es nur
// für den Season-Meister.
import { formatWhen } from "@/lib/datetime";
import { EXIT_TEXTS, exitText } from "@/lib/leagueTable";

/** "top" (Liga 1), "mid" (Liga 2), "base" (ab Liga 3) - ohne gültige Liga N `null`. */
export function badgeTier(level) {
  const value = Number(level);
  if (!Number.isInteger(value) || value < 1) return null;
  if (value === 1) return "top";
  return value === 2 ? "mid" : "base";
}

export function badgeMetal(badge) {
  return badge?.champion ? "gold" : "cyan";
}

/** „Liga 1 · Elite“ bzw. „Liga 2“. */
export function badgeLabel(badge) {
  if (!badgeTier(badge?.level)) return "";
  const nickname = String(badge.nickname || "").trim();
  return nickname ? `Liga ${badge.level} · ${nickname}` : `Liga ${badge.level}`;
}

export function badgeAria(badge) {
  const label = badgeLabel(badge);
  return label && badge?.champion ? `${label}, Season-Meister` : label;
}

/** „Platz 3 von 8“ - einen Platz gibt es erst mit dem ersten gewerteten Spiel; auf der Warteliste bzw. vor der Zulassung der Stand. */
export function currentPlace(row) {
  if (row?.rank) return row.of ? `Platz ${row.rank} von ${row.of}` : `Platz ${row.rank}`;
  if (row?.status_note) return row.status_note;
  return row?.of ? `Noch ohne Ergebnis · ${row.of} Teams` : "Noch ohne Ergebnis";
}

/** „gegen Probe B · Mi., 25.11., 20:00“ - ohne Termin der Spieltag. */
export function nextMatchText(match) {
  if (!match) return "";
  const when = match.scheduled_at
    ? formatWhen(match.scheduled_at)
    : match.matchday ? `Spieltag ${match.matchday}` : "";
  return [match.opponent ? `gegen ${match.opponent}` : "", when].filter(Boolean).join(" · ");
}

/**
 * Wo eine Season auf der Leiter steht: Liga N als Stufe, der Platz darin als Anteil - 0 ist Liga 1 Platz 1, 1 ist Liga 2 Platz 1.
 * So steigt die Linie bei einem Aufstieg, auch wenn der Platz in der höheren Liga N schlechter ist. Ausgeschiedene: `null`.
 */
export function ladderValue(row) {
  const level = Number(row?.badge?.level);
  const rank = Number(row?.rank);
  if (row?.exit || !Number.isInteger(level) || level < 1 || !rank) return null;
  const of = Math.max(Number(row?.of) || rank, rank);
  return level - 1 + (rank - 1) / of;
}

function seasonKey(row) {
  return row.season_id || row.season_name || "";
}

/** Liga N eines Eintrags - ohne gültige Liga N `null`. */
function levelOf(row) {
  const level = Number(row?.badge?.level);
  return Number.isInteger(level) && level >= 1 ? level : null;
}

/** Ein Rückzug (`withdrawn`) bzw. Ausschluss (`disqualified`) - die Season steht trotzdem auf der Achse (Fabian 23.11.). */
const isExit = (row) => Boolean(row?.exit);

/** Was am grauen Punkt eines Rückzugs steht - der Text kommt aus lib/leagueTable (eine Quelle mit Tabelle und Season-Historie). */
export function exitLabel(kind) {
  return exitText(kind, EXIT_TEXTS.withdrawn);
}

/**
 * Beschriftung einer Season unter der Linie: nie gekürzt. Ein Name mit Leerzeichen und mehr als 8 Zeichen steht in zwei Zeilen, geteilt
 * am Leerzeichen, das der Mitte am nächsten liegt („Herbst“ / „2026/27“); sonst eine Zeile. Den Abstand der Seasons misst der Baustein
 * an der breitesten Zeile.
 */
export function seasonLabelLines(name) {
  const text = String(name || "").split(" ").filter(Boolean).join(" ");
  if (text.length <= 8 || !text.includes(" ")) return [text];
  let best = -1;
  for (let at = text.indexOf(" "); at !== -1; at = text.indexOf(" ", at + 1)) {
    if (best === -1 || Math.abs(at - text.length / 2) < Math.abs(best - text.length / 2)) best = at;
  }
  return [text.slice(0, best), text.slice(best + 1)];
}

/** Ist ein Eintrag besser als ein anderer derselben Season? Ein gewerteter schlägt einen Rückzug, sonst zählt der Wert auf der Leiter. */
function better(next, before) {
  if (!before) return true;
  if (before.exit !== next.exit) return !next.exit;
  return !next.exit && next.value < before.value;
}

/**
 * Saisonverlauf aus der Season-Historie: `{seasons: [{key, name}], levels: [1, 2], series: [{name, squadId, points: [{index, value,
 * rank, of, level, champion, zone, season, exit}]}]}` - Seasons nach Abschlusszeit. `byTeam`: je Co-Team eine Linie (Teamseite); sonst
 * eine Linie für die Person, je Season der beste Eintrag. Ein Rückzug (`exit`) steht als Punkt ohne Platz (`value: null`) auf der Achse,
 * in seiner Liga N. `limit`: höchstens so viele Linien, die besten zuerst; `hidden` zählt den Rest. `playing`: Co-Teams, die gerade in
 * einer laufenden Staffel spielen (Kennung `squad_id` oder Name) - sie kommen zuerst. Seasons und Liga-Bänder kommen nur aus den
 * gezeigten Linien. Unter zwei Seasons oder ohne einen gewerteten Platz gibt es keine Linie (`null`).
 */
export function seasonLine(rows, { byTeam = false, limit = 0, playing = [] } = {}) {
  const usable = (rows || []).filter((row) => ladderValue(row) !== null || isExit(row));
  const order = new Map();
  [...usable].sort((a, b) => String(a.closed_at || "").localeCompare(String(b.closed_at || ""))).forEach((row) => {
    if (!order.has(seasonKey(row))) order.set(seasonKey(row), { key: seasonKey(row), name: row.season_name || "Season" });
  });
  const seasons = [...order.values()];
  if (seasons.length < 2) return null;
  const index = new Map(seasons.map((season, at) => [season.key, at]));
  const groups = new Map();
  for (const row of usable) {
    const name = byTeam ? row.display_name || "Team" : "";
    if (!groups.has(name)) groups.set(name, { squadId: null, points: new Map() });
    const group = groups.get(name);
    if (row.squad_id && !group.squadId) group.squadId = row.squad_id;
    const key = seasonKey(row);
    const exit = isExit(row) ? String(row.exit) : null;
    const point = {
      index: index.get(key), value: exit ? null : ladderValue(row), rank: exit ? null : Number(row.rank), of: Number(row.of) || null,
      level: levelOf(row), champion: !exit && Boolean(row.champion), zone: exit ? null : row.zone || null, season: order.get(key).name,
      team: row.display_name || "", exit,
    };
    if (better(point, group.points.get(key))) group.points.set(key, point);
  }
  const lineOf = ([name, group]) => {
    const sorted = [...group.points.values()].sort((a, b) => a.index - b.index);
    // Ein Rückzug ohne Liga N (alter Endstand) steht in der Liga N davor bzw. danach - ohne beide fällt er weg.
    const points = sorted.map((point, at) => {
      if (point.level) return point;
      const near = [...sorted.slice(0, at).reverse(), ...sorted.slice(at + 1)].find((other) => other.level);
      return near ? { ...point, level: near.level } : null;
    }).filter(Boolean);
    return { name, squadId: group.squadId, points };
  };
  // Die besten zuerst (Fabian 23.11., Review #1638): zuerst Co-Teams, die gerade spielen, dann die Liga N der letzten Season, dann der
  // Platz darin (ein Rückzug zählt wie der letzte Platz) - bei Gleichstand die jüngere Season, dann der Name. Die Teamseite zeigt davon
  // die ersten vier.
  const now = new Set((playing || []).filter(Boolean));
  const isPlaying = (row) => (now.has(row.squadId) || now.has(row.name) ? 0 : 1);
  const latest = (row) => row.points[row.points.length - 1];
  const standing = (row) => (latest(row).exit ? latest(row).level : latest(row).value);
  const series = [...groups.entries()].map(lineOf).filter((row) => row.points.length)
    .sort((a, b) => isPlaying(a) - isPlaying(b) || latest(a).level - latest(b).level || standing(a) - standing(b)
      || latest(b).index - latest(a).index || a.name.localeCompare(b.name));
  const shown = limit > 0 ? series.slice(0, limit) : series;
  const used = [...new Set(shown.flatMap((row) => row.points.map((point) => point.index)))].sort((a, b) => a - b);
  if (used.length < 2 || !shown.some((row) => row.points.some((point) => !point.exit))) return null;
  const remap = new Map(used.map((old, at) => [old, at]));
  const visible = shown.map((row) => ({ ...row, points: row.points.map((point) => ({ ...point, index: remap.get(point.index) })) }));
  const levels = [...new Set(visible.flatMap((row) => row.points.map((point) => point.level)))].sort((a, b) => a - b);
  return { seasons: used.map((at) => seasons[at]), levels, series: visible, hidden: series.length - shown.length };
}

/** Die Linie einer Reihe in Stücken: Ein Rückzug unterbricht sie, die Punkte davor und danach stehen je für sich. */
export function lineRuns(points) {
  const runs = [];
  let run = [];
  for (const point of points || []) {
    if (point.exit) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(point);
    }
  }
  if (run.length) runs.push(run);
  return runs;
}
