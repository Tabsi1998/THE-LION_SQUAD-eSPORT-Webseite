import type { AchievementGroup } from "../../lib/achievements";

// Der Schaukasten in der App (E13, #623) - dieselben Regeln wie die Seite /achievements im Web (#619): Seltenheit je
// Gruppe und Stufe, „die seltensten zuerst“, Zeiträume der Rangliste, nur Erreichtes im öffentlichen Profil. Ohne
// React, damit es sich testen lässt.

export type PublicUser = { id?: string; user_id?: string; username?: string | null; display_name?: string | null; avatar_url?: string | null };

export type RarityTop = { percent?: number; material?: string | null; material_name?: string | null };
export type GroupRarity = { holders?: number; top?: RarityTop | null };
export type Rarity = { base?: number; members_base?: number; groups?: Record<string, GroupRarity>; tiers?: Record<string, number> };

export type CategoryOverview = {
  key: string;
  label: string;
  icon?: string | null;
  accent: string;
  order?: number;
  member_only?: boolean;
  hidden?: boolean;
  groups: number;
  tiers: number;
  awards?: number;
  holders: number;
  community_percent: number;
  link?: string | null;
};

export type ShowcaseAward = {
  award_id?: string | null;
  tier_code?: string;
  code?: string;
  name?: string;
  group_name?: string;
  icon?: string | null;
  art?: string | null;
  rank?: number;
  level?: number | null;
  material?: string | null;
  material_name?: string | null;
  material_color?: string | null;
  points?: number;
  percent?: number;
  holders?: number;
  earned_at?: string | null;
  user?: PublicUser | null;
};

export type Week = { week_key?: string; award?: ShowcaseAward | null };

export type Overview = {
  categories?: CategoryOverview[];
  rarity?: Rarity | null;
  hidden?: { total?: number; earned?: number } | null;
  week?: Week | null;
  recent?: ShowcaseAward[];
};

export type LeaderEntry = PublicUser & { user_id: string; rank: number; points?: number; count?: number; level?: number; xp?: number; prestige?: number; title?: string | null };

export type BoardBy = "points" | "level";
export type BoardPeriod = "all" | "year" | "season" | "month";
export type Board = { by: BoardBy; category: string; period: BoardPeriod };

export const PERIODS: Array<{ key: BoardPeriod; label: string }> = [
  { key: "all", label: "Gesamt" },
  { key: "year", label: "Dieses Jahr" },
  { key: "season", label: "Diese Saison" },
  { key: "month", label: "Dieser Monat" },
];

/** „12,5 %“, sehr kleine Werte als „< 0,1 %“ - wie im Web. */
export function formatPercent(value?: number | null): string {
  const n = Number(value || 0);
  if (n > 0 && n < 0.1) return "< 0,1 %";
  return `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
}

/** Die Parameter der Rangliste: Kategorie und Zeitraum gelten nur für Erfolgspunkte. */
export function boardParams(board: Board, limit = 24): Record<string, string | number> {
  const params: Record<string, string | number> = { limit, by: board.by };
  if (board.by === "points") {
    if (board.category) params.category = board.category;
    if (board.period !== "all") params.period = board.period;
  }
  return params;
}

/** Die seltensten zuerst: kleinster Anteil an der höchsten Stufe, dann wenigste Personen, dann der Name. */
export function sortGroupsByRarity(groups: AchievementGroup[], rarity?: Rarity | null): AchievementGroup[] {
  const of = (group: AchievementGroup) => rarity?.groups?.[group.code] || null;
  return [...groups].sort((a, b) => {
    const ra = of(a);
    const rb = of(b);
    const pa = ra ? Number(ra.top?.percent ?? 0) : 101;
    const pb = rb ? Number(rb.top?.percent ?? 0) : 101;
    if (pa !== pb) return pa - pb;
    const ha = ra ? Number(ra.holders || 0) : Infinity;
    const hb = rb ? Number(rb.holders || 0) : Infinity;
    if (ha !== hb) return ha - hb;
    return String(a.name || "").localeCompare(String(b.name || ""), "de");
  });
}

/**
 * Nur erreichte Stufen (öffentliches Profil): Gruppen ohne erreichte Stufe fallen weg. `all_tiers` behält alle Stufen,
 * damit „4 von 7 Stufen“ stimmt.
 */
export function earnedOnlyGroups(groups: AchievementGroup[]): AchievementGroup[] {
  return groups
    .map((group) => ({ ...group, all_tiers: group.tiers || [], tiers: (group.tiers || []).filter((tier) => tier.earned) }))
    .filter((group) => (group.tiers || []).length > 0);
}

/** „1 Erfolg“, „3 Erfolge“. */
export function erfolge(count?: number | null): string {
  const n = Number(count || 0);
  return `${n} ${n === 1 ? "Erfolg" : "Erfolge"}`;
}

/** Erreichtes je Kategorie aus der Sicht des Katalogs - für den Kopf des Schaukastens. */
export function catalogStats(groups: AchievementGroup[]) {
  let tierCount = 0;
  let pointsTotal = 0;
  const categories = new Set<string>();
  for (const group of groups) {
    if (group.is_negative) continue;
    categories.add(String(group.category || "special"));
    for (const tier of group.tiers || []) {
      tierCount += 1;
      pointsTotal += Number(tier.points || 0);
    }
  }
  return { tierCount, pointsTotal, categoryCount: categories.size };
}

/** Eigene Zahlen (angemeldet): erreichte Stufen und ihre Punkte ohne Negatives. */
export function myStats(groups?: AchievementGroup[] | null) {
  if (!groups) return null;
  let count = 0;
  let points = 0;
  for (const group of groups) {
    if (group.is_negative) continue;
    for (const tier of group.tiers || []) {
      if (tier.earned) {
        count += 1;
        points += Number(tier.points || 0);
      }
    }
  }
  return { count, points };
}

/** „Kalenderwoche 40“ aus „2026-W40“. */
export function weekNumber(weekKey?: string | null): string | null {
  const part = String(weekKey || "").split("-W")[1];
  return part ? String(Number(part)) : null;
}

/** Sterne für Prestige (höchstens fünf), wie in den Ranglisten im Web. */
export function prestigeStars(prestige?: number | null): string {
  return "★".repeat(Math.max(0, Math.min(5, Number(prestige || 0))));
}
