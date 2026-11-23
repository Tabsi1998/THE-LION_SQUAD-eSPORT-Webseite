// Liga-Abzeichen (#1638) und laufende Ligen (#1630): reine Hilfen ohne React - Web, Tests und (als Vorlage) die App rechnen gleich.
// Der Server liefert je Eintrag `badge: {level, nickname, champion}` (services/league_current.badge). Die Stufe zeigt sich über die
// Form: Liga 1 mit Krone und zartem Glanz, Liga 2 mit doppeltem Rand, ab Liga 3 schlicht. Cyan ist die Markenfarbe, Gold gibt es nur
// für den Season-Meister.
import { viennaDateTime } from "@/lib/vienna";

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
    ? viennaDateTime(match.scheduled_at, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
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

/**
 * Saisonverlauf aus der Season-Historie: `{seasons: [{key, name}], levels: [1, 2], series: [{name, points: [{index, value, rank, of,
 * level, champion, zone, season}]}]}` - Seasons nach Abschlusszeit. `byTeam`: je Co-Team eine Linie (Teamseite); sonst eine Linie für
 * die Person, je Season der beste Eintrag. `limit`: höchstens so viele Linien, die besten zuerst; `hidden` zählt den Rest. Seasons und
 * Liga-Bänder kommen nur aus den gezeigten Linien. Unter zwei Seasons gibt es keine Linie (`null`).
 */
export function seasonLine(rows, { byTeam = false, limit = 0 } = {}) {
  const usable = (rows || []).filter((row) => ladderValue(row) !== null);
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
    if (!groups.has(name)) groups.set(name, new Map());
    const points = groups.get(name);
    const key = seasonKey(row);
    const value = ladderValue(row);
    if (points.has(key) && points.get(key).value <= value) continue;
    points.set(key, {
      index: index.get(key), value, rank: Number(row.rank), of: Number(row.of) || null, level: Number(row.badge.level),
      champion: Boolean(row.champion), zone: row.zone || null, season: order.get(key).name, team: row.display_name || "",
    });
  }
  // Die besten zuerst (Fabian 23.11.): höchste aktuelle Liga N, dann bester Platz - beides aus der letzten Season des Co-Teams; bei
  // Gleichstand die jüngere Season, dann der Name. Die Teamseite zeigt davon die ersten vier.
  const latest = (row) => row.points[row.points.length - 1];
  const series = [...groups.entries()]
    .map(([name, points]) => ({ name, points: [...points.values()].sort((a, b) => a.index - b.index) }))
    .sort((a, b) => latest(a).value - latest(b).value || latest(b).index - latest(a).index || a.name.localeCompare(b.name));
  const shown = limit > 0 ? series.slice(0, limit) : series;
  const used = [...new Set(shown.flatMap((row) => row.points.map((point) => point.index)))].sort((a, b) => a - b);
  if (used.length < 2) return null;
  const remap = new Map(used.map((old, at) => [old, at]));
  const visible = shown.map((row) => ({ ...row, points: row.points.map((point) => ({ ...point, index: remap.get(point.index) })) }));
  const levels = [...new Set(visible.flatMap((row) => row.points.map((point) => point.level)))].sort((a, b) => a - b);
  return { seasons: used.map((at) => seasons[at]), levels, series: visible, hidden: series.length - shown.length };
}
