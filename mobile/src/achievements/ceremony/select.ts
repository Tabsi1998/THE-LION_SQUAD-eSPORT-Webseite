import { MATERIAL_LOOKS } from "../badgeArt.generated";
import { materialForLevel } from "../badgeArt";

// Erfolge II (E13, #623): welcher Ablauf für welches Paket - dieselben Regeln wie im Web
// (frontend/src/components/achievements/ceremony/select.js). Reine Funktionen, damit die Auswahl testbar
// bleibt: Material und Kategorie der höchsten Stufe bestimmen Look und Bewegung, das Paket und sein
// Kontext den Sonderablauf. Negatives bekommt nie eine Zeremonie.

export type CeremonyTier = {
  code?: string;
  name?: string;
  description?: string;
  material?: string | null;
  rank?: number | null;
  level?: number | null;
  points?: number | null;
  category?: string | null;
  group_category?: string | null;
  group_name?: string;
  group_code?: string | null;
  art?: string | null;
  icon?: string | null;
  group_art?: string | null;
  group_icon?: string | null;
  is_negative?: boolean;
  hidden?: boolean;
  award_id?: string | null;
};

export type LevelUp = { level: number; previous?: number; title?: string; titleChanged?: boolean; prestige?: number; prestigeGained?: boolean };
export type CeremonyContext = { firstEver?: boolean; groupCompleted?: string | null; categoryCompleted?: string | null; catchUp?: boolean; heading?: string | null; sub?: string | null };
export type CeremonyPackage = { id?: string; tiers?: CeremonyTier[]; context?: CeremonyContext; levelUp?: LevelUp | null };

// Kategorie → Bewegung, mit der das Abzeichen auf die Bühne kommt.
export const MOTIONS: Record<string, string> = {
  match: "impact",        // Einschlag von oben mit Bodenwelle
  tournament: "lift",     // Pokalhebung mit Konfetti
  fastlap: "driveby",     // Vorbeifahrt mit Bremsspur und Geschwindigkeitslinien
  season: "flip",         // Kalenderblätter, die sich umblättern
  team: "merge",          // Zusammenschieben aus zwei Hälften
  community: "bubbles",   // Sprechblasen, die sich zum Abzeichen sammeln
  creator: "live",        // „LIVE“-Schild, Scanlines
  profile: "card",        // Karte, die sich ausfüllt
  club: "banner",         // Löwenwappen mit Fahnenschwung
  special: "curtain",     // Vorhang und Scheinwerfer
  hidden: "smoke",        // Enthüllung aus Rauch
};
export const MOTION_KEYS = Object.freeze([...new Set(Object.values(MOTIONS))]);

export const SEQUENCES = Object.freeze({
  single: { duration: 7000, perItem: 0, label: "Neues Achievement" },
  stack: { duration: 3000, perItem: 2500, label: "Sammel-Zeremonie" },
  first: { duration: 13000, perItem: 0, label: "Dein erster Erfolg" },
  group: { duration: 11000, perItem: 0, label: "Gruppe abgeschlossen" },
  category: { duration: 9500, perItem: 0, label: "Kategorie abgeschlossen" },
  diamond: { duration: 12000, perItem: 0, label: "Diamant" },
  legendary: { duration: 10000, perItem: 0, label: "Legendär" },
  levelup: { duration: 9000, perItem: 0, label: "Level-Aufstieg" },
});
export type Sequence = keyof typeof SEQUENCES;
export const SEQUENCE_KEYS = Object.freeze(Object.keys(SEQUENCES) as Sequence[]);

const LEGACY_CATEGORY: Record<string, string> = { content: "creator", progression: "profile" };

export function categoryOf(tier?: CeremonyTier | null): string {
  const raw = tier?.category || tier?.group_category || "special";
  return LEGACY_CATEGORY[raw] || raw;
}

export function materialOf(tier?: CeremonyTier | null): string {
  if (tier?.material && MATERIAL_LOOKS[tier.material]) return tier.material;
  return materialForLevel(tier?.level, { negative: Boolean(tier?.is_negative) });
}

export function rankOf(tier?: CeremonyTier | null): number {
  const rank = Number(tier?.rank || 0);
  if (rank > 0) return rank;
  return MATERIAL_LOOKS[materialOf(tier)]?.rank || 1;
}

/** Höchste Stufe zuerst: Rang, dann Punkte, dann Name - die steht vorne auf der Bühne. */
export function sortByRank<T extends CeremonyTier>(tiers: T[]): T[] {
  return [...tiers].sort((a, b) => rankOf(b) - rankOf(a) || Number(b.points || 0) - Number(a.points || 0) || String(a.name || "").localeCompare(String(b.name || ""), "de"));
}

function isNegative(tier: CeremonyTier): boolean {
  return Boolean(tier?.is_negative || categoryOf(tier) === "negative");
}

type GroupLike = { code: string; category?: string | null; is_negative?: boolean; tiers?: Array<{ code: string; earned?: boolean; manual_only?: boolean; condition_status?: string | null }> };

/**
 * Das Paket beschreiben: aus dem frischen Katalog (/achievements/me) und den neuen Stufen ergibt sich,
 * ob es der erste Erfolg überhaupt ist, ob eine Gruppe oder eine Kategorie damit vollständig wurde.
 */
export function describePackage(groups: GroupLike[] = [], fresh: Array<{ code?: string }> = []): Required<Pick<CeremonyContext, "firstEver" | "groupCompleted" | "categoryCompleted">> {
  const freshCodes = new Set(fresh.map((t) => t.code));
  let earnedTotal = 0;
  let groupCompleted: string | null = null;
  let categoryCompleted: string | null = null;
  const byCategory: Record<string, { groups: number; complete: number; touched: boolean }> = {};
  for (const group of groups) {
    if (group.is_negative) continue;
    const tiers = group.tiers || [];
    const earned = tiers.filter((t) => t.earned);
    earnedTotal += earned.length;
    const touched = tiers.some((t) => freshCodes.has(t.code));
    const measurable = tiers.filter((t) => !t.manual_only && t.condition_status !== "planned");
    const complete = measurable.length > 0 && measurable.every((t) => t.earned);
    const cat = categoryOf({ category: group.category });
    const row = (byCategory[cat] ||= { groups: 0, complete: 0, touched: false });
    row.groups += 1;
    if (complete) row.complete += 1;
    if (touched) row.touched = true;
    if (touched && complete && tiers.length >= 3 && !groupCompleted) groupCompleted = group.code;
  }
  for (const [cat, row] of Object.entries(byCategory)) {
    if (row.touched && row.groups > 0 && row.complete === row.groups && row.groups >= 3) {
      categoryCompleted = cat;
      break;
    }
  }
  return { firstEver: earnedTotal > 0 && earnedTotal === fresh.length, groupCompleted, categoryCompleted };
}

export type CeremonyPlan = {
  id: string;
  sequence: Sequence;
  label: string;
  material: string;
  motion: string;
  category: string;
  accent: string;
  duration: number;
  autoAdvanceMs: number;
  tiers: CeremonyTier[];
  top: CeremonyTier | null;
  /** Die Gruppe, die dieses Paket vollständig macht - Sockel und Überschrift zeigen sie, nicht die höchste Stufe. */
  groupCompleted: string | null;
  points: number;
  levelUp: LevelUp | null;
  catchUp: boolean;
  heading: string | null;
  sub: string | null;
  shareId: string | null;
  hidden: boolean;
  sound: { material: string; special: Sequence | null };
  particles: number;
};

/**
 * Der Plan für ein Paket: Sonderablauf, Material, Bewegung, Dauer, Klang und die Stufen in Bühnenfolge.
 * Gibt null zurück, wenn es nichts zu feiern gibt (leer oder nur Negatives).
 */
export function planCeremony(pkg?: CeremonyPackage | null, now: () => number = Date.now): CeremonyPlan | null {
  const levelUp = pkg?.levelUp || null;
  const tiers = sortByRank((pkg?.tiers || []).filter((t) => !isNegative(t)));
  if (!tiers.length && !levelUp) return null;
  const context = pkg?.context || {};
  const top = tiers[0] || null;
  const material = top ? materialOf(top) : "gold";
  const motion = top ? MOTIONS[categoryOf(top)] || "curtain" : "impact";

  let sequence: Sequence = "single";
  if (levelUp && !tiers.length) sequence = "levelup";
  else if (context.firstEver) sequence = "first";
  else if (context.categoryCompleted) sequence = "category";
  else if (context.groupCompleted) sequence = "group";
  else if (material === "legendary") sequence = "legendary";
  else if (material === "diamond") sequence = "diamond";
  else if (tiers.length > 1) sequence = "stack";

  const meta = SEQUENCES[sequence];
  const duration = sequence === "stack" ? meta.duration + meta.perItem * tiers.length : meta.duration;
  return {
    id: pkg?.id || `${sequence}-${top?.code || "level"}-${now()}`,
    sequence,
    label: meta.label,
    material,
    motion,
    category: top ? categoryOf(top) : "profile",
    accent: MATERIAL_LOOKS[material]?.rim || "#FFD700",
    duration,
    autoAdvanceMs: sequence === "stack" ? meta.perItem : 0,
    tiers,
    top,
    groupCompleted: context.groupCompleted || null,
    points: tiers.reduce((sum, t) => sum + Number(t.points || 0), 0),
    levelUp,
    catchUp: Boolean(context.catchUp),
    heading: context.heading || null,
    sub: context.sub || null,
    shareId: top?.award_id || null,
    hidden: Boolean(top?.hidden || (top && categoryOf(top) === "hidden")),
    sound: { material, special: sequence === "single" || sequence === "stack" ? null : sequence },
    particles: particleBudget(sequence, material),
  };
}

/** Partikel je Ablauf - wie im Web, am Handy höchstens 60 (Abnahme E13: ohne Bildeinbrüche). */
export const PHONE_PARTICLE_CAP = 60;

export function particleBudget(sequence: string, material: string): number {
  const base = ({ single: 40, stack: 60, first: 80, group: 110, category: 120, diamond: 160, legendary: 160, levelup: 120 } as Record<string, number>)[sequence] || 40;
  const bonus = material === "gold" ? 20 : material === "diamond" ? 30 : material === "legendary" ? 30 : 0;
  return Math.min(PHONE_PARTICLE_CAP, Math.round(Math.min(160, base + bonus) * 0.375));
}

/** Die Stufe, die für die abgeschlossene Gruppe steht - sonst die höchste. */
export function groupTier(plan: Pick<CeremonyPlan, "tiers" | "top" | "groupCompleted">): CeremonyTier | null {
  return (plan.groupCompleted && plan.tiers.find((t) => t.group_code === plan.groupCompleted)) || plan.top;
}

export function particleKind(material: string): string {
  return ({ wood: "leaf", iron: "spark", bronze: "ember", silver: "glint", gold: "confetti", platinum: "crystal", diamond: "prism", legendary: "flame", hidden: "wisp" } as Record<string, string>)[material] || "confetti";
}
