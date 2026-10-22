import type { PersonalReferenceItem } from "../types";
import {
  appearancesText,
  displayTitle,
  entryPeople,
  fieldLabel,
  gameTitle,
  hasMember,
  linkedSeasons,
  memberEntryOf,
  pathSteps,
  placementNumber,
  referenceInstant,
  seasonTarget,
  yearOf,
  type ClubReference,
  type LineageItem,
  type PathTile,
  type SeasonTarget,
} from "./references";
import { asInstant, viennaDate } from "./vienna";

// Profil-Reiter „Referenzen“ in der App (#1945) - wie die Vereinsplatzierungen im Mitgliederprofil des Webs (#1944): eine
// Chronik je Jahr, Kopf ohne Nullen, ein kleiner Liga-Weg der Person. Zusammen stehen hier die Vereinsplatzierungen
// (externe Turniere und Ligen aus /api/references, in denen die Person in der Aufstellung steht) und die eigenen
// Turniere, Fast Laps und Jahreswertungen der Plattform (wie bisher im Reiter). Gerechnet wird nur Anzeige.

export type LineupName = { name: string; me: boolean };

export type ProfileRow = {
  id: string;
  /** „club“ für Vereinsplatzierungen, sonst die Art der Plattform-Referenz (tournament, fastlap, season). */
  source: string;
  placement: number | null;
  title: string;
  sub: string;
  /** Aufgeklappt: Team und Feldgröße („Lions · von 8 Teams“). */
  detail: string;
  field: string;
  /** Einsätze der Person in der Saison (#1931): „5 von 7 Spielen“ - leer ohne Angabe. */
  played: string;
  year: string;
  time: number;
  game: string;
  lineup: LineupName[];
  season: SeasonTarget | null;
  referenceId?: string;
  personal?: PersonalReferenceItem;
};

function shortDate(value: Date | null): string {
  return value ? viennaDate(value, { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

function instantOf(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = asInstant(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clubRow(item: ClubReference, memberId: string, link: ReturnType<ReturnType<typeof linkedSeasons>["get"]>): ProfileRow {
  const entry = memberEntryOf(item, memberId);
  const instant = referenceInstant(item);
  const game = gameTitle(item);
  const knownGame = item.game?.display_name || item.game?.name || item.game_name || "";
  const team = entry ? (entry.kind === "solo" ? "Einzelstart" : entry.team_name || "") : "";
  const field = fieldLabel(entry);
  const lineup: LineupName[] = entry ? [
    ...(entry.lineup_members || []).filter((member) => member?.display_name).map((member) => ({ name: String(member.display_name), me: member.profile_id === memberId })),
    ...(entry.lineup || []).filter(Boolean).map((name) => ({ name, me: false })),
  ] : [];
  return {
    id: `club:${item.id}`,
    source: "club",
    placement: entry ? placementNumber(entry.placement) : null,
    title: displayTitle(item),
    sub: [game, shortDate(instant)].filter(Boolean).join(" · "),
    detail: [team, field].filter(Boolean).join(" · "),
    field,
    played: appearancesText(item.appearances),
    year: yearOf(item),
    time: instant?.getTime() || 0,
    game: knownGame,
    lineup: lineup.length ? lineup : (entry ? entryPeople(entry).map((name) => ({ name, me: false })) : []),
    season: seasonTarget(link),
    referenceId: item.id,
  };
}

function personalRow(item: PersonalReferenceItem): ProfileRow {
  const instant = instantOf(item.date);
  const field = item.participant_count ? `von ${item.participant_count}` : "";
  return {
    id: `personal:${item.id}`,
    source: item.kind || "tournament",
    placement: placementNumber(item.rank),
    title: item.title || "Referenz",
    sub: [item.subtitle, item.kind === "fastlap" ? item.time_str : "", shortDate(instant)].filter(Boolean).join(" · "),
    detail: field,
    field,
    played: "",
    year: instant ? shortDate(instant).slice(-4) : "",
    time: instant?.getTime() || 0,
    game: "",
    lineup: [],
    season: null,
    personal: item,
  };
}

/** Alle Zeilen des Reiters, neueste zuerst: Vereinsplatzierungen der Person und ihre Plattform-Referenzen. */
export function profileRows({ personal = [], club = [], memberId = "", lineages = [] }: {
  personal?: PersonalReferenceItem[] | null;
  club?: ClubReference[] | null;
  memberId?: string;
  lineages?: LineageItem[] | null;
}): ProfileRow[] {
  const linked = linkedSeasons(lineages);
  const own = memberId ? (club || []).filter((item) => item?.id && hasMember(item, memberId)) : [];
  return [
    ...own.map((item) => clubRow(item, memberId, linked.get(item.id))),
    ...(personal || []).filter((item) => item?.id).map(personalRow),
  ].sort((a, b) => b.time - a.time);
}

const teilnahmen = (count: number) => `${count} ${count === 1 ? "Teilnahme" : "Teilnahmen"}`;

/** Die Chronik je Jahr: neuestes Jahr zuerst, ohne Datum am Ende. */
export function profileGroups(rows: ProfileRow[]): Array<{ key: string; label: string; count: string; rows: ProfileRow[] }> {
  const groups = new Map<string, ProfileRow[]>();
  for (const row of rows) groups.set(row.year, [...(groups.get(row.year) || []), row]);
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : b.localeCompare(a)))
    .map(([key, list]) => ({ key, label: key || "Ohne Datum", count: teilnahmen(list.length), rows: list.slice().sort((x, y) => y.time - x.time) }));
}

const MEDALS: Array<[number, "gold" | "silver" | "bronze", string]> = [[1, "gold", "Gold"], [2, "silver", "Silber"], [3, "bronze", "Bronze"]];

/**
 * Kopf des Reiters ohne Nullen (#1268, #1944): mit Podest nur die vorhandenen Medaillen, sonst das beste Ergebnis
 * (bester Platz, bei Gleichstand das neueste) - dazu Teilnahmen, Spiele und „dabei seit“, jeweils nur mit Wert.
 */
export function profileHead(rows: ProfileRow[]) {
  const medals = MEDALS.map(([place, key, label]) => ({ key, label, count: rows.filter((row) => row.placement === place).length })).filter((medal) => medal.count > 0);
  const placed = rows.filter((row) => row.placement).sort((a, b) => (a.placement || 0) - (b.placement || 0) || b.time - a.time);
  const top = medals.length ? null : placed[0] || null;
  const games = new Set(rows.map((row) => row.game).filter(Boolean)).size;
  const years = rows.map((row) => row.year).filter(Boolean).sort();
  const facts = [
    rows.length ? { key: "total", value: String(rows.length), label: rows.length === 1 ? "Teilnahme" : "Teilnahmen" } : null,
    games ? { key: "games", value: String(games), label: games === 1 ? "Spiel" : "Spiele" } : null,
    years.length ? { key: "since", value: years[0], label: "dabei seit" } : null,
  ].filter((fact): fact is { key: string; value: string; label: string } => Boolean(fact));
  return {
    medals,
    best: top ? {
      placement: top.placement as number,
      title: top.title,
      sub: [top.time ? viennaDate(top.time, { month: "long", year: "numeric" }) : "", top.field].filter(Boolean).join(" · "),
    } : null,
    facts,
  };
}

/**
 * Der Liga-Weg der Person (#1944): je Spur die Saisons, in denen sie gespielt hat - ab zwei Saisons -, mit ihrem eigenen
 * Platz. Der Vermerk (Aufstieg, Meister, läuft) kommt aus dem ganzen Weg der Spur.
 */
export function memberPaths(lineages: LineageItem[] | null | undefined, items: ClubReference[] | null | undefined, memberId: string): Array<{ key: string; lineage: string; title: string; tiles: PathTile[] }> {
  if (!memberId) return [];
  const own = new Map((items || []).filter((item) => item?.id && hasMember(item, memberId)).map((item) => [item.id, item]));
  const paths = [];
  for (const item of lineages || []) {
    const seasons = item?.seasons || [];
    const placeOf = (season: { reference_ids?: string[] | null }) => {
      const places = (season.reference_ids || []).map((id) => own.get(id)).filter(Boolean)
        .map((ref) => placementNumber(memberEntryOf(ref as ClubReference, memberId)?.placement)).filter((place): place is number => Boolean(place));
      return places.length ? Math.min(...places) : null;
    };
    const tiles = pathSteps(seasons, item.lineage?.tier_order, placeOf, item.lineage?.kind)
      .filter((_tile, index) => (seasons[index]?.reference_ids || []).some((id) => own.has(id)));
    if (tiles.length >= 2 && item.lineage?.slug) {
      paths.push({ key: item.lineage.slug, lineage: item.lineage.slug, title: item.lineage.title || "", tiles });
    }
  }
  return paths;
}
