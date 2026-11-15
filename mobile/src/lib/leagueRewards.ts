import type { Award } from "./awards";

// Belohnungen der Liga in der App (#2173, Web: frontend/src/lib/leagueRewards.js, components/tls/rewards, docs/LIGA.md F.4): Vorlage,
// Titel neben dem Namen und die Zeremonie bei neuen Belohnungen. Die Sammlung an Profil und Team steht seit #2425 in der Vitrine
// „Trophäen“ (lib/trophies.ts). Dieselben Regeln wie im Web.

export type RewardArtInfo = { league?: string | null; season?: string | null; division?: string | null; place?: string | null; metal?: string | null };
export type Reward = { kind?: "medal" | "banner" | "emblem" | "title" | string; kind_label?: string; name?: string; place_label?: string; image_url?: string | null; art?: RewardArtInfo | null };
export type RewardAward = Award & {
  reward?: Reward | null;
  league?: { season_id?: string | null; division_label?: string | null; staffel?: string | null; title?: string | null } | null;
  updated_at?: string | null;
};

export const METAL_COLORS: Record<string, string> = { gold: "#FFD700", silver: "#C9CED6", bronze: "#D08A4E", lion: "#29B6E8" };
export const metalColor = (metal?: string | null) => METAL_COLORS[String(metal)] || METAL_COLORS.lion;

/** Beschriftung der Vorlage: Season, Liga N, Platz. */
export function artLines(art?: RewardArtInfo | null): string[] {
  return [art?.season, art?.division, art?.place].filter(Boolean) as string[];
}

/** Je Staffel ein Paket: Belohnungen aus demselben Abschluss feiern zusammen (wie RewardWatcher im Web). */
export function rewardPackages(rewards: RewardAward[] | null | undefined): RewardAward[][] {
  const groups = new Map<string, RewardAward[]>();
  for (const award of rewards || []) {
    const key = award.tournament?.id || award.id;
    if (!groups.has(key)) groups.set(key, []);
    (groups.get(key) as RewardAward[]).push(award);
  }
  return [...groups.values()];
}

/** Die Überschrift der Zeremonie: „Neue Belohnung“ bzw. „3 neue Belohnungen“, darunter Liga und Season. */
export function momentTitle(rewards: RewardAward[]): string {
  return rewards.length === 1 ? "Neue Belohnung" : `${rewards.length} neue Belohnungen`;
}

export function momentSubtitle(rewards: RewardAward[]): string {
  const art = rewards[0]?.reward?.art;
  return [art?.league, art?.season].filter(Boolean).join(" · ") || rewards[0]?.tournament?.title || "";
}
