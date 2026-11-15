import type { Award } from "./awards";

// Belohnungen der Liga in der App (#2173, Web: frontend/src/lib/leagueRewards.js, components/tls/rewards, docs/LIGA.md F.4): Sammlung
// je Season an Profil und Team, Titel neben dem Namen und die Zeremonie bei neuen Belohnungen. Dieselben Regeln wie im Web.

export type RewardArtInfo = { league?: string | null; season?: string | null; division?: string | null; place?: string | null; metal?: string | null };
export type Reward = { kind?: "medal" | "banner" | "emblem" | "title" | string; kind_label?: string; name?: string; place_label?: string; image_url?: string | null; art?: RewardArtInfo | null };
export type RewardAward = Award & {
  reward?: Reward | null;
  league?: { season_id?: string | null; division_label?: string | null; staffel?: string | null; title?: string | null } | null;
  updated_at?: string | null;
};

export const METAL_COLORS: Record<string, string> = { gold: "#FFD700", silver: "#C9CED6", bronze: "#D08A4E", lion: "#29B6E8" };
export const metalColor = (metal?: string | null) => METAL_COLORS[String(metal)] || METAL_COLORS.lion;

/** Die Belohnungen einer Sammlung - Auszeichnungen mit `reward`. */
export function rewardsOf<T extends RewardAward>(awards: T[] | null | undefined): T[] {
  return (Array.isArray(awards) ? awards : []).filter((award) => award?.reward);
}

/** Alles andere (Pokale, Banner aus Turnieren) - bleibt als Auszeichnung wie bisher. */
export function withoutRewards<T extends RewardAward>(awards: T[] | null | undefined): T[] {
  return (Array.isArray(awards) ? awards : []).filter((award) => award && !award.reward);
}

export type RewardGroup = { key: string; season: string; league: string; items: RewardAward[]; latest: string };

/** Nach Season gruppiert, die neueste zuerst; je Season Platz 1 vorn. */
export function groupBySeason(awards: RewardAward[] | null | undefined): RewardGroup[] {
  const groups = new Map<string, RewardGroup>();
  for (const award of rewardsOf(awards)) {
    const key = award.league?.season_id || award.season?.id || award.reward?.art?.season || "season";
    if (!groups.has(key)) {
      groups.set(key, { key, season: award.reward?.art?.season || award.season?.name || "Season", league: award.reward?.art?.league || "", items: [], latest: "" });
    }
    const group = groups.get(key) as RewardGroup;
    group.items.push(award);
    const stamp = String(award.updated_at || award.date || "");
    if (stamp > group.latest) group.latest = stamp;
  }
  const rank = (award: RewardAward) => (Number.isInteger(award.rank) ? Number(award.rank) : 999);
  return [...groups.values()]
    .map((group) => ({ ...group, items: group.items.sort((a, b) => rank(a) - rank(b) || String(a.reward?.name).localeCompare(String(b.reward?.name), "de")) }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

/** Beschriftung der Vorlage: Season, Liga N, Platz. */
export function artLines(art?: RewardArtInfo | null): string[] {
  return [art?.season, art?.division, art?.place].filter(Boolean) as string[];
}

/** Die Zeile unter dem Namen: „1. Platz · Liga 1 · Staffel A“. */
export function rewardMeta(award: RewardAward): string {
  return [award.reward?.art?.place || award.rank_label, award.league?.division_label, award.league?.staffel ? `Staffel ${award.league.staffel}` : ""]
    .filter(Boolean).join(" · ");
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
