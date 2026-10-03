import type { AchievementGroup, AchievementTier, IoniconName, StatusFilter } from "../../lib/achievements";
import { tierStatus } from "../../lib/achievements";

// Der Erfolge-Reiter im Profil (E13, #623) - dieselben Regeln wie im Web (#619): Vitrinen je Kategorie, Filter nach
// Status, Material und Kategorie, bis zu sechs Angeheftete, Zahlen, Prestige-Frist. Ohne React, damit es sich testen
// lässt.

export const MAX_PINS = 6;

export type CategoryMeta = { label: string; icon: IoniconName; accent: string; order: number };

/** Wie `CATEGORY_META` im Web; die Ionicons sind die nächstliegenden zu den Lucide-Symbolen dort. */
export const CATEGORY_META: Record<string, CategoryMeta> = {
  match: { label: "Spielen", icon: "game-controller", accent: "#29B6E8", order: 1 },
  tournament: { label: "Turnier", icon: "trophy", accent: "#FFD700", order: 2 },
  fastlap: { label: "Fast Lap", icon: "flag", accent: "#A855F7", order: 3 },
  season: { label: "Saison", icon: "calendar", accent: "#29B6E8", order: 3.5 },
  team: { label: "Team", icon: "people", accent: "#00FF88", order: 4 },
  community: { label: "Community", icon: "chatbubbles", accent: "#29B6E8", order: 5 },
  content: { label: "Streaming & Creator", icon: "radio", accent: "#9146FF", order: 6 },
  creator: { label: "Streaming & Creator", icon: "radio", accent: "#9146FF", order: 6 },
  progression: { label: "Profil & Konto", icon: "person", accent: "#00FF88", order: 7 },
  profile: { label: "Profil & Konto", icon: "person", accent: "#00FF88", order: 7 },
  club: { label: "Verein", icon: "shield", accent: "#FFD700", order: 8 },
  special: { label: "Besonders", icon: "sparkles", accent: "#FF3B30", order: 9 },
  hidden: { label: "Geheim", icon: "eye-off", accent: "#A855F7", order: 9.5 },
  negative: { label: "Geheim / Fun", icon: "warning", accent: "#FF3B30", order: 10 },
};

export const MATERIAL_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "wood", label: "Holz" },
  { key: "iron", label: "Eisen" },
  { key: "bronze", label: "Bronze" },
  { key: "silver", label: "Silber" },
  { key: "gold", label: "Gold" },
  { key: "platinum", label: "Platin" },
  { key: "diamond", label: "Diamant" },
  { key: "legendary", label: "Legendär" },
  { key: "hidden", label: "Geheim" },
];

export type CategoryRow = CategoryMeta & { key: string; earned: number; total: number; groups: number };

/** Kategorien als Vitrinen: „Spielen 41 von 104“ - negative Gruppen zählen nicht mit. */
export function categoryProgress(groups: AchievementGroup[] = []): CategoryRow[] {
  const rows: Record<string, CategoryRow> = {};
  for (const group of groups) {
    if (group.is_negative) continue;
    const key = group.category || "special";
    const meta = CATEGORY_META[key] || CATEGORY_META.special;
    const row = (rows[key] ||= { key, ...meta, earned: 0, total: 0, groups: 0 });
    row.groups += 1;
    for (const tier of group.tiers || []) {
      row.total += 1;
      if (tier.earned) row.earned += 1;
    }
  }
  return Object.values(rows).sort((a, b) => a.order - b.order);
}

export type TierFilters = { status: StatusFilter; material: string; category: string | null };
export const NO_FILTERS: TierFilters = { status: "all", material: "", category: null };

export function hasFilters(filters: TierFilters): boolean {
  return filters.status !== "all" || Boolean(filters.material) || Boolean(filters.category);
}

/**
 * Nur die Stufen, die zu Status und Material passen, und nur Gruppen der gewählten Kategorie; Gruppen ohne passende
 * Stufe fallen weg. Gefilterte Gruppen behalten alle Stufen in `all_tiers` - der Fortschritt rechnet immer mit allen.
 */
export function applyTierFilters(groups: AchievementGroup[], filters: TierFilters): AchievementGroup[] {
  const byCategory = filters.category ? groups.filter((group) => group.category === filters.category) : groups;
  const status = filters.status !== "all" ? filters.status : "";
  if (!status && !filters.material) return byCategory;
  return byCategory
    .map((group) => ({
      ...group,
      all_tiers: group.all_tiers || group.tiers || [],
      tiers: (group.tiers || []).filter((tier) => (!filters.material || tier.material === filters.material) && (!status || tierStatus(tier, group) === status)),
    }))
    .filter((group) => (group.tiers || []).length > 0);
}

/** Anheften oder lösen. Mehr als sechs gehen nicht - dann bleibt alles, wie es ist, und `full` ist gesetzt. */
export function togglePin(codes: string[], code: string, max = MAX_PINS): { codes: string[]; full: boolean } {
  if (codes.includes(code)) return { codes: codes.filter((item) => item !== code), full: false };
  if (codes.length >= max) return { codes, full: true };
  return { codes: [...codes, code], full: false };
}

/** Eine Angeheftete einen Platz nach vorn (-1) oder hinten (+1) - die Reihenfolge ist die im öffentlichen Profil. */
export function movePin(codes: string[], code: string, delta: -1 | 1): string[] {
  const index = codes.indexOf(code);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= codes.length) return codes;
  const next = [...codes];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export type AchievementLevel = {
  level?: number;
  xp?: number;
  points?: number;
  next_level_xp?: number;
  next_level_points?: number;
  current_level_xp?: number;
  progress?: number;
  title?: string;
  next_title_at?: number | null;
  prestige?: number;
  max_level?: number;
  prestige_available?: boolean;
  prestige_undo_until?: string | null;
};

export type PinnedAward = AchievementTier & { award_id?: string; group_name?: string; material_color?: string | null; level_color?: string | null; group_icon?: string | null };

export type NextUpItem = AchievementTier & {
  group_code?: string;
  group_name?: string;
  group_accent?: string | null;
  group_icon?: string | null;
  missing?: number;
  link?: string | null;
  member_only?: boolean;
  material_color?: string | null;
};

export type AchievementsMe = {
  groups?: AchievementGroup[];
  awards?: Array<{ code: string; award_id?: string; points?: number; is_negative?: boolean; member_only?: boolean }>;
  next_up?: NextUpItem[];
  hidden?: { total?: number; earned?: number } | null;
  pinned?: PinnedAward[];
  pinned_codes?: string[];
  privacy_achievements_public?: boolean;
  level?: AchievementLevel | null;
};

/** Zahlen wie im Web: freigeschaltet von allen, Punkte aus den Vergaben, Anteil in Prozent. */
export function achievementStats(data?: AchievementsMe | null) {
  const tiers = (data?.groups || []).flatMap((group) => group.tiers || []);
  const earned = tiers.filter((tier) => tier.earned).length;
  const points = (data?.awards || []).reduce((sum, award) => sum + Number(award.points || 0), 0);
  return { earned, total: tiers.length, points, earnedPercent: tiers.length ? Math.round((earned / tiers.length) * 100) : 0 };
}

/** Vergabe-Kennung je erreichter Stufe zum Teilen - ohne Negatives und ohne Vereins-Stufen (die sind nicht öffentlich). */
export function shareIdsByCode(data?: AchievementsMe | null): Record<string, string> {
  const ids: Record<string, string> = {};
  for (const award of data?.awards || []) {
    if (award.award_id && !award.is_negative && !award.member_only) ids[award.code] = award.award_id;
  }
  return ids;
}

/** Bis wann sich ein Prestige zurücknehmen lässt - oder null, wenn es keines gibt oder die Frist vorbei ist. */
export function prestigeUndoUntil(level?: AchievementLevel | null, now = Date.now()): Date | null {
  const until = level?.prestige_undo_until ? new Date(level.prestige_undo_until) : null;
  return until && !Number.isNaN(+until) && +until > now ? until : null;
}
