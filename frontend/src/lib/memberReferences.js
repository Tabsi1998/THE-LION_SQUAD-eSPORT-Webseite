import { displayTitle, entriesOf, platformLabel, referenceInstant, shortTitle, timeOf } from "@/components/tls/references/referenceParts";
import { leaguePath, yearOf } from "@/lib/referencesOverview";
import { seriesAddress } from "@/lib/referenceSeries";
import { viennaDate } from "@/lib/vienna";

// Vereinsplatzierungen im Mitgliederprofil (#1944): die Logik hinter Kopf, Liga-Weg und Chronik der Person - ohne
// Oberfläche, damit sie für sich getestet ist. Platzierungen und Medaillen kommen vom Server (#859); hier wird nur
// ausgewählt und beschriftet. Der Kopf zeigt nur Werte über null (#1268).

const MEDALS = [[1, "gold", "Gold"], [2, "silver", "Silber"], [3, "bronze", "Bronze"]];
const MODE_TAGS = { offline: "Vor Ort", hybrid: "Hybrid" };

/** Der eigene Eintrag dieser Person (#409): vom Server als `member_entry`, sonst der erste Eintrag. */
export function ownEntry(item) {
  return item?.member_entry || entriesOf(item || {})[0] || null;
}

function ownPlacement(item) {
  return Number(ownEntry(item)?.placement) || null;
}

/** Medaillen der Bilanz, nur die über null - Gold, Silber, Bronze in dieser Reihenfolge. */
export function profileMedals(stats) {
  return MEDALS
    .map(([placement, key, label]) => ({ placement, key, label, count: Number(stats?.[key]) || 0 }))
    .filter((medal) => medal.count > 0);
}

/** Das beste Ergebnis: der kleinste eigene Platz, bei Gleichstand der neueste. null, wenn nirgends ein Platz steht. */
export function bestResult(references) {
  let best = null;
  for (const item of references || []) {
    const placement = ownPlacement(item);
    if (!placement) continue;
    if (!best || placement < best.placement || (placement === best.placement && timeOf(item) > timeOf(best.item))) {
      best = { item, entry: ownEntry(item), placement };
    }
  }
  return best;
}

/** Teilnahmen, Spiele und „seit“ dem ersten Jahr - nur Werte über null. */
export function profileFacts(references) {
  const list = references || [];
  const games = new Set(list.map((item) => item.game?.id || item.game_id || item.game_name).filter(Boolean)).size;
  const years = list.map(yearOf).filter(Boolean).sort();
  return [
    { key: "total", value: list.length, label: list.length === 1 ? "Teilnahme" : "Teilnahmen" },
    { key: "games", value: games, label: games === 1 ? "Spiel" : "Spiele" },
    { key: "since", value: years.length ? `seit ${years[0]}` : 0, label: "für den Verein" },
  ].filter((fact) => fact.value);
}

/** Monat und Jahr der Teilnahme in Wiener Zeit: „Mai 2025“. */
export function monthOf(item) {
  const instant = referenceInstant(item || {});
  return instant ? viennaDate(instant, { month: "long", year: "numeric" }) : "";
}

/** Wie groß das Feld war: „von 8 Teams“, bei Einzelstartern „von 20 Teilnehmern“. */
export function fieldSize(entry) {
  if (!entry) return "";
  if (entry.team_count && entry.kind !== "solo") return `von ${entry.team_count} Teams`;
  if (entry.participant_count) return `von ${entry.participant_count} Teilnehmern`;
  if (entry.team_count) return `von ${entry.team_count} Teams`;
  return "";
}

/** Format-Marken der Details: Format, Plattformen und der Modus, wenn nicht online. Liga und Saison stehen im Titel. */
export function formatTags(item) {
  const tags = [
    item.format,
    ...(item.platforms || []).map((key) => platformLabel(item, key)),
    MODE_TAGS[item.mode],
  ].map((tag) => String(tag || "").trim()).filter(Boolean);
  return Array.from(new Set(tags));
}

/** Die Aufstellung des eigenen Eintrags: jede Person einmal, die Person selbst markiert, Profil-Links bleiben. */
export function lineupOf(entry, profileId) {
  if (!entry) return [];
  const people = [];
  const seen = new Set();
  const add = (key, name, url, self) => {
    const label = String(name || "").trim();
    if (!label || seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    people.push({ key: key || label, name: label, url: url || null, self });
  };
  for (const person of entry.lineup_members || []) {
    add(person?.profile_id, person?.display_name, person?.profile_url, Boolean(profileId) && person?.profile_id === profileId);
  }
  for (const name of entry.lineup || []) add("", name, null, false);
  return people;
}

/** „Beim Veranstalter“: die Turnierseite, sonst das Ergebnis, sonst das Bracket. */
export function organizerUrl(item) {
  return item.external_url || item.result_url || item.bracket_url || "";
}

/**
 * Was die aufgeklappte Zeile zeigt: den langen Titel (nur wenn er vom kurzen abweicht), Format-Marken, die Aufstellung
 * (nur im Team) und die Links - „Saison ansehen“ (nur mit Saison), „Details“ zur Referenz (immer: Bericht, Partner und
 * Ort stehen dort) und „Beim Veranstalter“.
 */
export function detailsOf(item, profileId, link = null) {
  const entry = ownEntry(item);
  const full = displayTitle(item);
  return {
    fullTitle: full !== shortTitle(item, link) ? full : "",
    tags: formatTags(item),
    lineup: entry && entry.kind !== "solo" ? lineupOf(entry, profileId) : [],
    seasonUrl: link?.lineage?.slug && link?.season?.season_slug ? seriesAddress(link.lineage, link.season) : "",
    detailUrl: `/references/${item.id}`,
    organizerUrl: organizerUrl(item),
  };
}

/**
 * Der Liga-Weg der Person (#1944): je Spur, in der sie in mindestens einer Saison stand, nur diese Saisons - mit ihrem
 * eigenen Platz (sonst dem des Vereins) und dem Vermerk der Saison aus dem ganzen Weg der Spur (Aufstieg, läuft …).
 * „Zur Serie“ führt wie auf der Übersicht zur laufenden, sonst neuesten Saison der Spur.
 */
export function memberPaths(lineages, references) {
  const own = new Map((references || []).map((item) => [item.id, item]));
  const paths = [];
  for (const item of lineages || []) {
    if (!item?.lineage) continue;
    const full = leaguePath(item.seasons, item.lineage.tier_order);
    const steps = full.steps
      .map((step) => ({ step, ref: (step.reference_ids || []).map((id) => own.get(id)).find(Boolean) }))
      .filter(({ ref }) => ref)
      .map(({ step, ref }) => ({ ...step, place: ownPlacement(ref) || Number(step.club?.rank) || null }));
    if (!steps.length) continue;
    paths.push({
      lineage: item.lineage,
      steps,
      target: full.target,
      address: full.target?.season_slug && item.lineage.slug ? seriesAddress(item.lineage, full.target) : "",
    });
  }
  return paths;
}
