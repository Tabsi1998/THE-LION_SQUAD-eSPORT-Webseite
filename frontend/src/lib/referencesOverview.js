import { bestPlacement, entriesOf, entryPeople, gameKey, gameTitle, hasMember, memberEntryOf, referenceInstant, timeOf } from "@/components/tls/references/referenceParts";
import { dayNoon, viennaDate, viennaDay } from "@/lib/vienna";
import { seasonNote, tierRank } from "@/lib/seriesTiers";

// Referenzen-Übersicht (#1878): die Logik hinter Ehrentafel, Vitrine, Liga-Weg und Chronik - ohne Oberfläche, damit
// sie für sich getestet ist. Gerechnet wird nur Anzeige: Platzierungen, Medaillen und Stände kommen vom Server.

export const KIND_LABELS = { series: "Turnierserie", racing: "Rennliga", team_league: "Team-Liga" };

// ---------------------------------------------------------------- Stufe

// Rang einer Stufe (kleiner ist höher) und Vermerk einer Saison kommen aus lib/seriesTiers (#1898): zuerst das „Ergebnis
// der Saison“ und die Reihenfolge der Stufen der Spur, erst dann die Zahl im Stufennamen.
export { tierRank };

/** Je Referenz die Saison und Spur, zu der sie gehört (aus dem Endpunkt „Serien und Ligen“). */
export function linkedSeasons(lineages) {
  const map = new Map();
  for (const item of lineages || []) {
    for (const season of item.seasons || []) {
      for (const id of season.reference_ids || []) if (!map.has(id)) map.set(id, { lineage: item.lineage, season });
    }
  }
  return map;
}

/** Die Stufe einer Teilnahme: die ihrer Saison, sonst das Liga-Feld der Referenz. */
export function tierOf(item, linked) {
  return linked?.get(item.id)?.season?.tier || item.league || "";
}

// ---------------------------------------------------------------- Vitrine

/** Podestplätze für die Vitrine, die neuesten zuerst. */
export function podiumItems(items) {
  return (items || []).filter((item) => (bestPlacement(item) || 99) <= 3).sort((a, b) => timeOf(b) - timeOf(a));
}

/**
 * Die Hauptkarte der Vitrine. Fest gewählt (`showcase.mode === "pinned"`) gilt die gewählte Referenz, solange sie in der
 * Vitrine steht; sonst die Vorgabe: der höchste Platz in der höchsten Stufe, bei Gleichstand der neueste.
 */
export function pickShowcase(items, showcase, linked = null) {
  const list = items || [];
  if (!list.length) return null;
  if (showcase?.mode === "pinned") {
    const pinned = list.find((item) => item.id === showcase.reference_id);
    if (pinned) return pinned;
  }
  const rank = (item) => [tierRank(tierOf(item, linked), linked?.get(item.id)?.lineage?.tier_order), bestPlacement(item) || 99, -timeOf(item)];
  return list.slice().sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return 0;
  })[0];
}

// ---------------------------------------------------------------- Starter und Medaillen

function ownEntries(item, memberId) {
  if (!memberId) return entriesOf(item);
  const own = memberEntryOf(item, memberId);
  return own ? [own] : [];
}

/** Unsere Starter einer Teilnahme, jeder Name nur einmal: ein Team mit seinem Namen, Einzelstarter mit ihrem. */
export function startersOf(item, memberId = "") {
  const names = [];
  for (const entry of ownEntries(item, memberId)) {
    const team = entry.kind !== "solo" ? String(entry.team_name || "").trim() : "";
    names.push(...(team ? [team] : entryPeople(entry)));
  }
  return Array.from(new Set(names.map((name) => String(name || "").trim()).filter(Boolean)));
}

/** Die Platzierungen einer Teilnahme je Eintrag - mit Personen-Filter nur der eigene; ohne Einträge die beste. */
export function placementsOf(item, memberId = "") {
  const entries = ownEntries(item, memberId);
  if (!entries.length) return memberId ? [] : [bestPlacement(item)].filter(Boolean);
  return entries.map((entry) => Number(entry.placement) || null).filter(Boolean);
}

/** Gold, Silber, Bronze je Eintrag gezählt - wie die Bilanz des Servers. */
export function medalCounts(items, memberId = "") {
  const counts = { gold: 0, silver: 0, bronze: 0 };
  for (const item of items || []) {
    for (const place of placementsOf(item, memberId)) {
      if (place === 1) counts.gold += 1;
      else if (place === 2) counts.silver += 1;
      else if (place === 3) counts.bronze += 1;
    }
  }
  return counts;
}

/** „2× Gold · 1× Bronze“ - leer ohne Medaille. */
export function medalLine(counts) {
  return [[counts.gold, "Gold"], [counts.silver, "Silber"], [counts.bronze, "Bronze"]]
    .filter(([count]) => count).map(([count, label]) => `${count}× ${label}`).join(" · ");
}

// ---------------------------------------------------------------- Chronik

/** Das Jahr einer Teilnahme in Wiener Zeit; leer ohne gültiges Datum. */
export function yearOf(item) {
  return viennaDay(referenceInstant(item)).slice(0, 4);
}

/**
 * Chronik nach Jahr (#1748) statt nach Freitext-Saison: sonst landeten gleiche Season-Nummern verschiedener Spiele und
 * Jahre in einer Gruppe. Neuestes Jahr zuerst, Teilnahmen ohne Datum unter „Ohne Datum“ am Ende, innerhalb neu → alt.
 */
export function timelineGroups(items) {
  const groups = new Map();
  (items || []).forEach((item) => {
    const key = yearOf(item);
    if (!groups.has(key)) groups.set(key, { key, label: key || "Ohne Datum", items: [] });
    groups.get(key).items.push(item);
  });
  return Array.from(groups.values())
    .map((group) => ({ ...group, items: group.items.slice().sort((a, b) => timeOf(b) - timeOf(a)) }))
    .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.key.localeCompare(a.key)));
}

/** Die Format-Marke: bei einer Saison Art und Bezeichnung der Spur, sonst das Format-Feld, sonst Einzel oder Team. */
export function formatLabel(item, link = null) {
  if (link?.lineage) return [KIND_LABELS[link.lineage.kind], link.lineage.label].filter(Boolean).join(" ");
  if (item.format) return item.format;
  const entries = entriesOf(item);
  if (!entries.length) return "";
  return entries.every((entry) => entry.kind === "solo") ? "Einzel" : "Team";
}

/** Steht die Teilnahme auf dem Podest - mit Personen-Filter nach dem eigenen Eintrag dieser Person. */
export function onPodium(item, memberId = "") {
  return placementsOf(item, memberId).some((place) => place <= 3);
}

/** Filter der Chronik: Spiel (`"all"` = alle), „Nur Podest“ und die Person aus dem Profil (#859). */
export function filterChronicle(items, { game = "all", podiumOnly = false, memberId = "" } = {}) {
  return (items || []).filter((item) => {
    if (memberId && !hasMember(item, memberId)) return false;
    if (game !== "all" && gameKey(item) !== game) return false;
    if (podiumOnly && !onPodium(item, memberId)) return false;
    return true;
  });
}

/** Spiel-Chips: je Spiel einmal, das häufigste zuerst, gleich oft nach Namen. */
export function gameOptions(items) {
  const games = new Map();
  for (const item of items || []) {
    const key = gameKey(item);
    if (!games.has(key)) games.set(key, { key, title: gameTitle(item), count: 0 });
    games.get(key).count += 1;
  }
  return Array.from(games.values()).sort((a, b) => (b.count - a.count) || a.title.localeCompare(b.title, "de-AT"));
}

const teilnahmen = (count) => `${count} ${count === 1 ? "Teilnahme" : "Teilnahmen"}`;

/** „12 Teilnahmen“ oder mit Filter „3 von 12 Teilnahmen“. */
export function chronicleCount(shown, total) {
  return shown === total ? teilnahmen(total) : `${shown} von ${teilnahmen(total)}`;
}

// ---------------------------------------------------------------- Liga-Weg

/**
 * Der Liga-Weg einer Spur aus ihren Saisons (in Reihenfolge): je Saison der Vermerk - „läuft“ für die laufende, sonst
 * das „Ergebnis der Saison“ aus der Verwaltung (Aufstieg, Abstieg, Klassenerhalt, Meister; #1898). Ohne Vermerk
 * „Aufstieg“ oder „Abstieg“, wenn die nächste Saison eine vergleichbare höhere bzw. tiefere Stufe hat - nach der
 * Reihenfolge der Stufen der Spur (`tierOrder`), sonst nach der Zahl im Namen. Gibt es in einer Saison mehrere Stufen,
 * bleibt dieser abgeleitete Übergang ohne Vermerk. Dazu die Zusammenfassung und die Saison für den Link.
 */
export function leaguePath(seasons, tierOrder = null) {
  const list = seasons || [];
  const perSeason = new Map();
  for (const item of list) perSeason.set(item.season, (perSeason.get(item.season) || 0) + 1);
  const steps = list.map((item, index) => {
    const current = item.status === "active";
    const next = list[index + 1];
    let note = "";
    if (current) note = "läuft";
    else if (item.season_result) note = seasonNote(item, next, tierOrder);
    else if (next && next.season !== item.season && perSeason.get(item.season) === 1 && perSeason.get(next.season) === 1) {
      note = seasonNote(item, next, tierOrder);
    }
    return { ...item, note, current };
  });
  const promotions = steps.filter((step) => step.note === "Aufstieg").length;
  const count = `${list.length} ${list.length === 1 ? "Saison" : "Saisons"}`;
  return {
    steps,
    promotions,
    target: list.find((item) => item.status === "active") || list[list.length - 1] || null,
    summary: promotions ? `${count} · ${promotions} ${promotions === 1 ? "Aufstieg" : "Aufstiege"}` : count,
  };
}

// ---------------------------------------------------------------- Ehrentafel

/** Zahlen der Ehrentafel: Medaillen, Teilnahmen und Spiele aus der Bilanz, Saisons und Aufstiege aus den Spuren. */
export function honorStats({ summary = {}, items = [], lineages = [] }) {
  const seasons = lineages.flatMap((item) => item.seasons || []);
  const years = [
    ...items.map(yearOf),
    ...seasons.map((item) => String(item.season || "")).filter((season) => /^\d{4}$/.test(season)),
  ].filter(Boolean).sort();
  return {
    gold: summary.gold || 0,
    silver: summary.silver || 0,
    bronze: summary.bronze || 0,
    total: summary.total || 0,
    games: summary.games || 0,
    running: seasons.filter((item) => item.status === "active").length,
    promotions: lineages.reduce((sum, item) => sum + leaguePath(item.seasons, item.lineage?.tier_order).promotions, 0),
    since: years[0] || "",
  };
}

// ---------------------------------------------------------------- Läuft gerade

const UNITS = {
  racing: ["Rennen", "Rennen", "gewertet"],
  team_league: ["Spieltag", "Spieltagen", "gespielt"],
  series: ["Turnier", "Turnieren", "gewertet"],
};

/** „6 von 10 Rennen gewertet“ - in der Sprache der Art. */
export function progressText(kind, scored, total) {
  const [one, many, verb] = UNITS[kind] || ["Termin", "Terminen", "gewertet"];
  return `${scored} von ${total} ${total === 1 ? one : many} ${verb}`;
}

const NEXT_TITLES = { racing: "Nächstes Rennen", team_league: "Nächster Spieltag", series: "Nächstes Turnier" };

export function nextTitle(kind, next) {
  if (!next) return "Nächster Termin";
  if (next.state === "today") return "Heute";
  return NEXT_TITLES[kind] || "Nächster Termin";
}

/** Der nächste Termin: heute „R7 · 20:30“, sonst „Do 22.10. · 20:00 · ST4“ (Wiener Tag) - mit Lauf (#1930) „R3 ·
 * Qualifying · 20:00“. */
export function nextValue(next) {
  if (!next) return "Kein Termin offen";
  const label = [next.code || next.title || "", next.session || ""].filter(Boolean).join(" · ");
  if (next.state === "today") return [label, next.time].filter(Boolean).join(" · ");
  const noon = next.club_day ? dayNoon(next.club_day) : null;
  const day = noon ? `${viennaDate(noon, { weekday: "short" }).replace(/\.$/, "")} ${viennaDate(noon, { day: "2-digit", month: "2-digit" })}` : "";
  return [day, next.time, label].filter(Boolean).join(" · ");
}

const PLACE_TITLES = { racing: "Bester Fahrer", team_league: "Tabelle", series: "Gesamtwertung" };

export function placeTitle(kind) {
  return PLACE_TITLES[kind] || "Unser Platz";
}
