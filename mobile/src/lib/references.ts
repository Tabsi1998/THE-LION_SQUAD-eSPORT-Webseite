import { countryCode } from "./countryFlags";
import { KIND_LABELS } from "./seriesFormat";
import { hostBadge, type PartnerBadge } from "./seriesPartners";
import { asInstant, dayNoon, viennaDate, viennaDay } from "./vienna";

/** Ein Datum vom Server als Zeitpunkt - null ohne gültigen Wert. */
function referenceDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = asInstant(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Referenzen in der App (#1945): die Logik hinter Ehrentafel, „Läuft gerade“, Vitrine, Liga-Weg und Chronik - dieselbe wie
// im Web (frontend/src/lib/referencesOverview.js, lib/seriesTiers.js, components/tls/references/referenceParts.jsx),
// ohne Oberfläche, damit sie für sich getestet ist. Gerechnet wird nur Anzeige: Platzierungen, Medaillen, Stände und
// der Platz des Vereins kommen vom Server. Fehlende Felder (alter Server) ergeben leere Werte, nie einen Absturz.

// ---------------------------------------------------------------- Daten vom Server

export type LineupMember = { profile_id?: string | null; display_name?: string | null; avatar_url?: string | null; profile_url?: string | null };

/** Ein Eintrag einer Teilnahme (#409): Team oder Einzelstarter mit eigener Platzierung. */
export type ReferenceEntry = {
  id?: string;
  kind?: "team" | "solo" | string | null;
  team_name?: string | null;
  placement?: number | string | null;
  placement_label?: string | null;
  participant_count?: number | null;
  team_count?: number | null;
  lineup?: string[] | null;
  lineup_members?: LineupMember[] | null;
  member_profile_ids?: string[] | null;
  medal?: string | null;
};

type GameInfo = { id?: string; name?: string | null; display_name?: string | null; short_name?: string | null; logo_url?: string | null } | null;

/** Eine Teilnahme aus /api/references (Antwort: { items, summary, showcase }). */
export type ClubReference = {
  id: string;
  title?: string | null;
  display_title?: string | null;
  organizer?: string | null;
  league?: string | null;
  season?: string | null;
  format?: string | null;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  placement?: number | string | null;
  best_placement?: number | string | null;
  medal?: string | null;
  game_id?: string | null;
  game_name?: string | null;
  game?: GameInfo;
  team_name?: string | null;
  team_count?: number | null;
  participant_count?: number | null;
  member_profile_ids?: string[] | null;
  lineup_members?: LineupMember[] | null;
  entries?: ReferenceEntry[] | null;
  /** Einsätze der Person in der verknüpften Saison (#1931, nur im Mitgliederprofil) - ältere Server schicken es nicht. */
  appearances?: Appearances | null;
};

/** „5 von 7 Spielen“: gespielt, von wie vielen, und ob Spiele, Rennen oder Runden gezählt sind. */
export type Appearances = { played?: number | null; of?: number | null; unit?: "matches" | "races" | "rounds" | string | null; team?: string | null };

const APPEARANCE_UNITS: Record<string, [string, string]> = { matches: ["Spiel", "Spielen"], races: ["Rennen", "Rennen"], rounds: ["Runde", "Runden"] };

/** Einsätze als Text wie im Web (lib/teamLeagueEntry.js): „5 von 7 Spielen“, „1 von 1 Spiel“ - ohne Angabe leer. */
export function appearancesText(appearances: Appearances | null | undefined): string {
  const of = Number(appearances?.of) || 0;
  if (!of) return "";
  const [one, many] = APPEARANCE_UNITS[String(appearances?.unit)] || APPEARANCE_UNITS.matches;
  return `${Number(appearances?.played) || 0} von ${of} ${of === 1 ? one : many}`;
}

export type ReferenceSummaryData = { total?: number; gold?: number; silver?: number; bronze?: number; games?: number; podiums?: number } | null | undefined;
export type Showcase = { mode?: "auto" | "pinned" | string; reference_id?: string | null } | null | undefined;

export type LineageInfo = {
  title?: string | null; slug?: string | null; kind?: string | null; label?: string | null; organizer?: string | null; game_name?: string | null; tier_order?: string[] | null;
  /** Veranstalter der Spur (#1934, aus /lineages) - ältere Server schicken es nicht. */
  organizers?: PartnerBadge[] | null;
};
export type ClubPlace = { rank?: number | null; of?: number | null } | null;
export type LineageSeason = {
  season?: string | null;
  tier?: string | null;
  title?: string | null;
  season_slug?: string | null;
  status?: string | null;
  season_result?: string | null;
  club?: ClubPlace;
  reference_ids?: string[] | null;
  /** Veranstalter der Saison (#1934). */
  organizers?: PartnerBadge[] | null;
};
/** Eine Spur mit ihren Saisons aus /api/reference-series/public/lineages. */
export type LineageItem = { lineage: LineageInfo; game?: GameInfo; seasons?: LineageSeason[] | null };
/** Eine laufende Saison aus /api/reference-series/public/running. */
export type RunningItem = {
  lineage?: LineageInfo | null;
  game?: GameInfo;
  series?: { season?: string | null; tier?: string | null; title?: string | null; season_slug?: string | null } | null;
  progress?: { total?: number | null; scored?: number | null } | null;
  next?: NextRound | null;
  today?: boolean | null;
  club?: ClubPlace;
  /** Veranstalter der Saison (#1934) - ältere Server schicken es nicht. */
  organizers?: PartnerBadge[] | null;
};
export type NextRound = {
  code?: string | null; title?: string | null; club_day?: string | null; state?: string | null; time?: string | null; country_code?: string | null;
  /** Der nächste Lauf der Runde (#1930) und alle Läufe der Runde (nur bei mehreren). */
  session?: string | null;
  sessions?: Array<{ session?: string | null; club_day?: string | null; time?: string | null; state?: string | null; next?: boolean | null }> | null;
  /** Team-Liga (#1931): Gegner, Heim/Auswärts und ein Spieltag über mehrere Tage. */
  opponent?: string | null;
  at_home?: boolean | null;
  club_day_end?: string | null;
};

export type SeasonTarget = { lineage: string; season: string };
export type SeasonLink = { lineage: LineageInfo; season: LineageSeason };

export { KIND_LABELS };

// ---------------------------------------------------------------- Bausteine einer Teilnahme

export function entriesOf(item: Pick<ClubReference, "entries"> | null | undefined): ReferenceEntry[] {
  return Array.isArray(item?.entries) && item.entries.length ? item.entries : [];
}

export function displayTitle(item: Pick<ClubReference, "display_title" | "title">): string {
  return item.display_title || item.title || "Referenz";
}

export function gameTitle(item: Pick<ClubReference, "game" | "game_name">): string {
  return item.game?.display_name || item.game?.name || item.game_name || "Externes Turnier";
}

export function gameKey(item: Pick<ClubReference, "game" | "game_id" | "game_name">): string {
  return item.game?.id || item.game_id || gameTitle(item);
}

export function placementNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function bestPlacement(item: Pick<ClubReference, "best_placement" | "placement">): number | null {
  return placementNumber(item.best_placement || item.placement);
}

export function medalForPlacement(placement: number | null | undefined): "gold" | "silver" | "bronze" | null {
  return placement === 1 ? "gold" : placement === 2 ? "silver" : placement === 3 ? "bronze" : null;
}

/** Die Leute eines Eintrags: Mitglieder mit Profil, dann die freien Namen. */
export function entryPeople(entry: ReferenceEntry): string[] {
  const members = (entry.lineup_members || []).map((member) => member?.display_name || "").filter(Boolean);
  return [...members, ...(entry.lineup || []).filter(Boolean)];
}

/**
 * Der beste eigene Eintrag dieser Person (Profil-ID) in einer Teilnahme (#409, #859): ein Einzelstarter hat seine
 * Platzierung, ein Teammitglied die seines Teams. null, wenn sie in keinem Eintrag steht.
 */
export function memberEntryOf(item: Pick<ClubReference, "entries">, profileId: string): ReferenceEntry | null {
  const mine = entriesOf(item).filter((entry) => (entry.member_profile_ids || []).includes(profileId)
    || (entry.lineup_members || []).some((member) => member?.profile_id === profileId));
  if (!mine.length) return null;
  const rank = (entry: ReferenceEntry) => placementNumber(entry.placement) || 1e6;
  return mine.reduce((best, entry) => (rank(entry) < rank(best) ? entry : best));
}

/** Steht diese Person in der Teilnahme - an der Referenz oder in einem Eintrag? */
export function hasMember(item: ClubReference, profileId: string): boolean {
  if (!profileId) return true;
  return (item.member_profile_ids || []).includes(profileId) || Boolean(memberEntryOf(item, profileId));
}

/** Der Zeitpunkt einer Teilnahme: das erste gültige von Start- und Enddatum. null ohne gültiges Datum. */
export function referenceInstant(item: Pick<ClubReference, "start_date" | "end_date">): Date | null {
  for (const value of [item.start_date, item.end_date]) {
    const date = referenceDate(value);
    if (date) return date;
  }
  return null;
}

export function timeOf(item: Pick<ClubReference, "start_date" | "end_date">): number {
  return referenceInstant(item)?.getTime() || 0;
}

/** Das Jahr einer Teilnahme in Wiener Zeit; leer ohne gültiges Datum. */
export function yearOf(item: Pick<ClubReference, "start_date" | "end_date">): string {
  return viennaDay(referenceInstant(item)).slice(0, 4);
}

// ---------------------------------------------------------------- Stufe (#1898)

export const SEASON_RESULT_LABELS: Record<string, string> = { promoted: "Aufstieg", relegated: "Abstieg", stayed: "Klassenerhalt", champion: "Meister" };
const TIER_WORDS = new Set(["liga", "division", "div", "stufe", "tier", "league"]);

function tierTokens(text: unknown): string[] {
  const tokens: string[] = [];
  let current = "";
  for (const char of String(text || "")) {
    if (/[\p{L}\p{N}]/u.test(char)) {
      current += char;
      continue;
    }
    if (current) tokens.push(current);
    current = "";
    if (char === ".") tokens.push(".");
  }
  if (current) tokens.push(current);
  return tokens;
}

function tierNumber(token: string | undefined): number | null {
  if (!token || token.length > 3 || ![...token].every((char) => char >= "0" && char <= "9")) return null;
  const value = Number(token);
  return value > 0 ? value : null;
}

/** Rang einer Stufe aus ihrem Namen, kleiner ist höher („Division 2“ → 2, „1. Liga“ → 1); ohne Treffer Infinity. */
export function tierRankFromName(text: unknown): number {
  const tokens = tierTokens(text);
  const words = tokens.map((token) => token.toLowerCase());
  for (let index = 0; index < tokens.length; index += 1) {
    if (!TIER_WORDS.has(words[index])) continue;
    const next = tokens[index + 1] === "." ? tokens[index + 2] : tokens[index + 1];
    const after = tierNumber(next);
    if (after) return after;
  }
  for (let index = 2; index < tokens.length; index += 1) {
    if (!TIER_WORDS.has(words[index]) || tokens[index - 1] !== ".") continue;
    const before = tierNumber(tokens[index - 2]);
    if (before) return before;
  }
  return Infinity;
}

const tierKey = (value: unknown) => String(value || "").split(/\s+/).filter(Boolean).join(" ").toLowerCase();

/** Rang einer Stufe: mit eigener Reihenfolge der Spur der Platz darin, sonst die Zahl im Namen. */
export function tierRank(tier: unknown, tierOrder?: string[] | null): number {
  const order = Array.isArray(tierOrder) ? tierOrder : [];
  if (!order.length) return tierRankFromName(tier);
  const index = order.findIndex((item) => tierKey(item) === tierKey(tier));
  return index >= 0 ? index + 1 : Infinity;
}

/** Vermerk einer Saison: ihr „Ergebnis der Saison“, sonst der Vergleich ihrer Stufe mit der nächsten Saison. */
export function seasonNote(item: Pick<LineageSeason, "tier" | "season_result"> | null | undefined, next: Pick<LineageSeason, "tier"> | null | undefined, tierOrder?: string[] | null): string {
  const marked = SEASON_RESULT_LABELS[String(item?.season_result || "")];
  if (marked) return marked;
  if (!item || !next) return "";
  const from = tierRank(item.tier, tierOrder);
  const to = tierRank(next.tier, tierOrder);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return "";
  return to < from ? SEASON_RESULT_LABELS.promoted : SEASON_RESULT_LABELS.relegated;
}

/** Je Referenz die Saison und Spur, zu der sie gehört (aus dem Endpunkt „Serien und Ligen“). */
export function linkedSeasons(lineages: LineageItem[] | null | undefined): Map<string, SeasonLink> {
  const map = new Map<string, SeasonLink>();
  for (const item of lineages || []) {
    for (const season of item?.seasons || []) {
      for (const id of season?.reference_ids || []) if (!map.has(id)) map.set(id, { lineage: item.lineage || {}, season });
    }
  }
  return map;
}

/** Wohin eine verknüpfte Saison führt - nur mit Spur- und Saison-Adresse. */
export function seasonTarget(link: SeasonLink | null | undefined): SeasonTarget | null {
  const lineage = link?.lineage?.slug;
  const season = link?.season?.season_slug;
  return lineage && season ? { lineage, season } : null;
}

export function tierOf(item: ClubReference, linked?: Map<string, SeasonLink> | null): string {
  return linked?.get(item.id)?.season?.tier || item.league || "";
}

// ---------------------------------------------------------------- Liga-Weg

export type PathStep = LineageSeason & { note: string; current: boolean };

/**
 * Der Liga-Weg einer Spur aus ihren Saisons (in Reihenfolge): je Saison der Vermerk - „läuft“ für die laufende, sonst
 * das „Ergebnis der Saison“, sonst Auf- oder Abstieg aus der Stufe der nächsten Saison (nicht bei zwei Stufen in
 * einer Saison). Dazu die Zusammenfassung und die Saison für den Link (laufende, sonst neueste).
 */
export function leaguePath(seasons: LineageSeason[] | null | undefined, tierOrder?: string[] | null) {
  const list = seasons || [];
  const perSeason = new Map<unknown, number>();
  for (const item of list) perSeason.set(item.season, (perSeason.get(item.season) || 0) + 1);
  const steps: PathStep[] = list.map((item, index) => {
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

export type PathTone = "up" | "honor" | "current" | "plain";
export type PathTile = { key: string; season: string; tier: string; result: string; tone: PathTone; current: boolean; target: string | null };

const NOTE_TONES: Record<string, PathTone> = { Aufstieg: "up", Meister: "honor", läuft: "current" };

/**
 * Die Kacheln eines Liga-Wegs zum Wischen: Saison, Stufe und „5. · Aufstieg“, „4. Platz“ oder „läuft“. Der Platz ist
 * der des Vereins (`club.rank`) oder - im Profil - der der Person (`placeOf`). Ohne Platz „–“, nie „0.“.
 */
export function pathSteps(seasons: LineageSeason[] | null | undefined, tierOrder?: string[] | null, placeOf?: (season: LineageSeason) => number | null, kind?: string | null): PathTile[] {
  return leaguePath(seasons, tierOrder).steps.map((step, index) => {
    const place = placeOf ? placeOf(step) : placementNumber(step.club?.rank);
    const result = step.note ? (place ? `${place}. · ${step.note}` : step.note) : (place ? `${place}. Platz` : "–");
    return {
      key: step.season_slug || `${step.season || ""}-${step.tier || ""}-${index}`,
      season: step.season || step.title || "",
      tier: step.tier || (kind === "team_league" ? "Liga" : "Gesamt"),
      result,
      tone: NOTE_TONES[step.note] || "plain",
      current: step.current,
      target: step.season_slug || null,
    };
  });
}

// ---------------------------------------------------------------- Vitrine

/** Podestplätze für die Vitrine, die neuesten zuerst. */
export function podiumItems(items: ClubReference[] | null | undefined): ClubReference[] {
  return (items || []).filter((item) => (bestPlacement(item) || 99) <= 3).sort((a, b) => timeOf(b) - timeOf(a));
}

/**
 * Die Hauptkarte der Vitrine - dieselbe Regel wie im Web: fest gewählt (`showcase.mode === "pinned"`) die gewählte
 * Referenz, solange sie da ist; sonst der höchste Platz in der höchsten Stufe, bei Gleichstand der neueste.
 */
export function pickShowcase(items: ClubReference[] | null | undefined, showcase: Showcase, linked?: Map<string, SeasonLink> | null): ClubReference | null {
  const list = items || [];
  if (!list.length) return null;
  if (showcase?.mode === "pinned") {
    const pinned = list.find((item) => item.id === showcase.reference_id);
    if (pinned) return pinned;
  }
  const rank = (item: ClubReference) => [tierRank(tierOf(item, linked), linked?.get(item.id)?.lineage?.tier_order), bestPlacement(item) || 99, -timeOf(item)];
  return list.slice().sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
    }
    return 0;
  })[0];
}

function ownEntries(item: ClubReference, memberId: string): ReferenceEntry[] {
  if (!memberId) return entriesOf(item);
  const own = memberEntryOf(item, memberId);
  return own ? [own] : [];
}

/** Unsere Starter einer Teilnahme, jeder Name nur einmal: ein Team mit seinem Namen, Einzelstarter mit ihrem. */
export function startersOf(item: ClubReference, memberId = ""): string[] {
  const names: string[] = [];
  for (const entry of ownEntries(item, memberId)) {
    const teamName = entry.kind !== "solo" ? String(entry.team_name || "").trim() : "";
    names.push(...(teamName ? [teamName] : entryPeople(entry)));
  }
  return Array.from(new Set(names.map((name) => String(name || "").trim()).filter(Boolean)));
}

/** „von 12 Teams“ bzw. „von 40“ - die Feldgröße eines Eintrags, leer ohne Angabe. */
export function fieldLabel(entry: ReferenceEntry | null | undefined): string {
  if (entry?.team_count) return `von ${entry.team_count} Teams`;
  if (entry?.participant_count) return `von ${entry.participant_count}`;
  return "";
}

function monthYear(item: ClubReference, month: "long" | "short"): string {
  const instant = referenceInstant(item);
  return instant ? dayLabel(instant, { month, year: "numeric" }) : "";
}

/** Die Hauptkarte als Text: „1. Platz · Meister“, Titel, „Team · von 12 Teams · Februar 2026“ und das Ziel. */
export function showcaseView(item: ClubReference, link: SeasonLink | null | undefined) {
  const placement = bestPlacement(item);
  const entries = entriesOf(item);
  const best = entries.find((entry) => placementNumber(entry.placement) === placement) || entries[0] || null;
  return {
    placement,
    eyebrow: [placement ? `${placement}. Platz` : "", best?.placement_label || ""].filter(Boolean).join(" · "),
    title: displayTitle(item),
    detail: [startersOf(item).join(", "), fieldLabel(best), monthYear(item, "long")].filter(Boolean).join(" · "),
    season: seasonTarget(link),
  };
}

// ---------------------------------------------------------------- Medaillen

/** Die Platzierungen einer Teilnahme je Eintrag - mit Personen-Filter nur der eigene; ohne Einträge die beste. */
export function placementsOf(item: ClubReference, memberId = ""): number[] {
  const entries = ownEntries(item, memberId);
  if (!entries.length) return memberId ? [] : [bestPlacement(item)].filter((place): place is number => Boolean(place));
  return entries.map((entry) => placementNumber(entry.placement)).filter((place): place is number => Boolean(place));
}

export type MedalCounts = { gold: number; silver: number; bronze: number };

/** Gold, Silber, Bronze je Eintrag gezählt - wie die Bilanz des Servers. */
export function medalCounts(items: ClubReference[] | null | undefined, memberId = ""): MedalCounts {
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

// ---------------------------------------------------------------- Chronik

/** Chronik nach Jahr (#1748): neuestes Jahr zuerst, ohne Datum unter „Ohne Datum“ am Ende, innerhalb neu → alt. */
export function timelineGroups<T extends Pick<ClubReference, "start_date" | "end_date">>(items: T[] | null | undefined): Array<{ key: string; label: string; items: T[] }> {
  const groups = new Map<string, { key: string; label: string; items: T[] }>();
  (items || []).forEach((item) => {
    const key = yearOf(item);
    if (!groups.has(key)) groups.set(key, { key, label: key || "Ohne Datum", items: [] });
    groups.get(key)?.items.push(item);
  });
  return Array.from(groups.values())
    .map((group) => ({ ...group, items: group.items.slice().sort((a, b) => timeOf(b) - timeOf(a)) }))
    .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.key.localeCompare(a.key)));
}

/** Steht die Teilnahme auf dem Podest - mit Personen-Filter nach dem eigenen Eintrag. */
export function onPodium(item: ClubReference, memberId = ""): boolean {
  return placementsOf(item, memberId).some((place) => place <= 3);
}

/** Filter der Chronik: Spiel (`"all"` = alle), „Nur Podest“ und die Person. */
export function filterChronicle(items: ClubReference[] | null | undefined, { game = "all", podiumOnly = false, memberId = "" }: { game?: string; podiumOnly?: boolean; memberId?: string } = {}): ClubReference[] {
  return (items || []).filter((item) => {
    if (memberId && !hasMember(item, memberId)) return false;
    if (game !== "all" && gameKey(item) !== game) return false;
    if (podiumOnly && !onPodium(item, memberId)) return false;
    return true;
  });
}

/** Spiel-Chips: je Spiel einmal, das häufigste zuerst, gleich oft nach Namen. */
export function gameOptions(items: ClubReference[] | null | undefined): Array<{ key: string; title: string; count: number }> {
  const games = new Map<string, { key: string; title: string; count: number }>();
  for (const item of items || []) {
    const key = gameKey(item);
    if (!games.has(key)) games.set(key, { key, title: gameTitle(item), count: 0 });
    const entry = games.get(key);
    if (entry) entry.count += 1;
  }
  return Array.from(games.values()).sort((a, b) => (b.count - a.count) || a.title.localeCompare(b.title, "de-AT"));
}

const teilnahmen = (count: number) => `${count} ${count === 1 ? "Teilnahme" : "Teilnahmen"}`;

/** „12 Teilnahmen“ oder mit Filter „3 von 12 Teilnahmen“. */
export function chronicleCount(shown: number, total: number): string {
  return shown === total ? teilnahmen(total) : `${shown} von ${teilnahmen(total)}`;
}

export type ChronicleRow = { id: string; placement: number | null; title: string; sub: string; season: SeasonTarget | null; item: ClubReference };

/** Die Chronik des Vereins als Zeilen (App „Verein › Erfolge“): Platz, Titel, „Spiel · Monat“, neueste zuerst. */
export function clubChronicle(items: ClubReference[] | null | undefined, linked?: Map<string, SeasonLink> | null): ChronicleRow[] {
  return (items || []).slice().sort((a, b) => timeOf(b) - timeOf(a)).map((item) => ({
    id: item.id,
    placement: bestPlacement(item),
    title: displayTitle(item),
    sub: [gameTitle(item), monthYear(item, "short")].filter(Boolean).join(" · "),
    season: seasonTarget(linked?.get(item.id)),
    item,
  }));
}

// ---------------------------------------------------------------- Ehrentafel

export type HonorStats = { gold: number; silver: number; bronze: number; total: number; games: number; running: number; promotions: number; since: string };

/** Zahlen der Ehrentafel: Medaillen, Teilnahmen und Spiele aus der Bilanz, Saisons und Aufstiege aus den Spuren. */
export function honorStats({ summary, items = [], lineages = [] }: { summary?: ReferenceSummaryData; items?: ClubReference[]; lineages?: LineageItem[] }): HonorStats {
  const seasons = lineages.flatMap((item) => item.seasons || []);
  const years = [
    ...items.map(yearOf),
    ...seasons.map((item) => String(item.season || "")).filter((season) => /^\d{4}$/.test(season)),
  ].filter(Boolean).sort();
  return {
    gold: Number(summary?.gold) || 0,
    silver: Number(summary?.silver) || 0,
    bronze: Number(summary?.bronze) || 0,
    total: Number(summary?.total) || 0,
    games: Number(summary?.games) || 0,
    running: seasons.filter((item) => item.status === "active").length,
    promotions: lineages.reduce((sum, item) => sum + leaguePath(item.seasons, item.lineage?.tier_order).promotions, 0),
    since: years[0] || "",
  };
}

// ---------------------------------------------------------------- Läuft gerade

const UNITS: Record<string, [string, string, string]> = {
  racing: ["Rennen", "Rennen", "gewertet"],
  team_league: ["Spieltag", "Spieltagen", "gespielt"],
  series: ["Turnier", "Turnieren", "gewertet"],
};

/** „6 von 10 Rennen gewertet“ - in der Sprache der Art. */
export function progressText(kind: string | null | undefined, scored: number, total: number): string {
  const [one, many, verb] = UNITS[String(kind)] || ["Termin", "Terminen", "gewertet"];
  return `${scored} von ${total} ${total === 1 ? one : many} ${verb}`;
}

const NEXT_TITLES: Record<string, string> = { racing: "Nächstes Rennen", team_league: "Nächster Spieltag", series: "Nächstes Turnier" };

export function nextTitle(kind: string | null | undefined, next: NextRound | null | undefined): string {
  if (!next) return "Nächster Termin";
  if (next.state === "today") return "Heute";
  return NEXT_TITLES[String(kind)] || "Nächster Termin";
}

function dayLabel(value: Date, options: Intl.DateTimeFormatOptions): string {
  return viennaDate(value, options);
}

function shortDay(day: string | null | undefined): string {
  const noon = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? dayNoon(day) : null;
  return noon ? `${dayLabel(noon, { weekday: "short" }).replace(/\.$/, "")} ${dayLabel(noon, { day: "2-digit", month: "2-digit" })}` : "";
}

/** Gegner eines Spieltags (#1931): „vs X“ daheim, „@ X“ auswärts, sonst „gegen X“. */
export function opponentText(next: Pick<NextRound, "opponent" | "at_home"> | null | undefined): string {
  const name = String(next?.opponent || "").trim();
  if (!name) return "";
  if (next?.at_home === true) return `vs ${name}`;
  if (next?.at_home === false) return `@ ${name}`;
  return `gegen ${name}`;
}

/** Der nächste Termin wie im Web: heute „R3 · Sprint · 19:50“, sonst „Do 22.10. · 20:00 · R3 · Qualifying“ (Wiener
 * Tag), mit Gegner; ein Spieltag über mehrere Tage „Mi 21.10.–So 25.10.“ ohne Uhrzeit. */
export function nextValue(next: NextRound | null | undefined): string {
  if (!next) return "Kein Termin offen";
  const label = [next.code || next.title || "", next.session || ""].filter(Boolean).join(" · ");
  const opponent = opponentText(next);
  if (next.state === "today") return [label, next.time, opponent].filter(Boolean).join(" · ");
  const window = Boolean(next.club_day_end && next.club_day_end !== next.club_day);
  const day = window ? `${shortDay(next.club_day)}–${shortDay(next.club_day_end)}` : shortDay(next.club_day);
  return [day, window ? "" : next.time, label, opponent].filter(Boolean).join(" · ");
}

const PLACE_TITLES: Record<string, string> = { racing: "Bester Fahrer", team_league: "Tabelle", series: "Gesamtwertung" };

export function placeTitle(kind: string | null | undefined): string {
  return PLACE_TITLES[String(kind)] || "Unser Platz";
}

/** „Bester Vereinsfahrer: P4 von 20“, „Platz 3 von 8“ - ohne Stand „Platz noch offen“. */
function placeLine(kind: string | null | undefined, club: ClubPlace | undefined): string {
  const rank = placementNumber(club?.rank);
  if (!rank) return "Platz noch offen";
  const of = club?.of ? ` von ${club.of}` : "";
  return kind === "racing" ? `Bester Vereinsfahrer: P${rank}${of}` : `Platz ${rank}${of}`;
}

/** Eine laufende Saison als Karte (App „Läuft gerade“). Fehlt der Stand, bleibt der Balken weg. */
export function runningView(item: RunningItem) {
  const lineage = item.lineage || {};
  const series = item.series || {};
  const kind = lineage.kind || "";
  const total = Number(item.progress?.total) || 0;
  const scored = Math.min(Number(item.progress?.scored) || 0, total);
  const gameName = lineage.game_name || item.game?.name || "";
  return {
    key: `${lineage.slug || ""}/${series.season_slug || ""}`,
    kind: [KIND_LABELS[kind] || "Serie", gameName].filter(Boolean).join(" · "),
    title: series.title || [lineage.title, series.season, series.tier].filter(Boolean).join(" · "),
    today: Boolean(item.today),
    next: item.next ? [nextTitle(kind, item.next), nextValue(item.next)].filter(Boolean).join(" · ") : "",
    progress: total > 0 ? { scored, total, share: scored / total, text: progressText(kind, scored, total) } : null,
    place: placeLine(kind, item.club),
    // Land des nächsten Termins (#1925) - die Karte zeigt seine Flagge vor dem Termin.
    country: countryCode(item.next?.country_code),
    season: lineage.slug && series.season_slug ? { lineage: lineage.slug, season: series.season_slug } : null,
    // Die Läufe der nächsten Runde als Chips (#1930) - nur bei mehreren.
    sessions: (item.next?.sessions || []).length > 1
      ? (item.next?.sessions || []).map((run, index) => ({ id: `s${index}`, code: item.next?.code || null, session: run?.session ?? null, club_day: run?.club_day ?? null, time: run?.time ?? null, state: run?.state ?? null }))
      : [],
    // Veranstalter als kleines Partner-Abzeichen (#1934).
    host: hostBadge(item.organizers),
  };
}
