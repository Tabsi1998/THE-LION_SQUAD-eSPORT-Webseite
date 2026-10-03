import { ALIASES, MATERIAL_LOOKS, MOTIFS, type MaterialLook } from "./badgeArt.generated";

// Erfolge II (E13, #623): Zugriff auf die Abzeichen-Kunst der App - dieselben Regeln wie badgeArt.jsx und
// materials.js im Web (Motiv der Gruppe, sonst ein Verwandter; Material aus dem neuen Feld, sonst aus dem
// alten Level 1–5).

export const MATERIAL_ORDER = Object.keys(MATERIAL_LOOKS);
export const BADGE_ART_KEYS = Object.keys(MOTIFS);

export function resolveArt(key?: string | null): string | null {
  const wanted = String(key || "").trim();
  if (MOTIFS[wanted]) return wanted;
  const alias = ALIASES[wanted];
  return alias && MOTIFS[alias] ? alias : null;
}

export function hasMotif(key?: string | null): boolean {
  return resolveArt(key) !== null;
}

/** Altes Level 1–5 → Material, wie im Backend (5 ist Legendär, bei Negativ Geheim). */
export function materialForLevel(level?: number | null, { negative = false }: { negative?: boolean } = {}): string {
  const n = Number(level || 1);
  if (n >= 5) return negative ? "hidden" : "legendary";
  return ({ 1: "bronze", 2: "silver", 3: "gold", 4: "platinum" } as Record<number, string>)[n] || "bronze";
}

export type Look = MaterialLook & { key: string };

export function lookFor(material?: string | null, level?: number | null, options: { negative?: boolean } = {}): Look {
  const key = material && MATERIAL_LOOKS[material] ? material : materialForLevel(level, options);
  return { key, ...MATERIAL_LOOKS[key] };
}

/** Rang-Kerben 1–7: aus dem Rang, sonst aus dem Material (Legendär und Geheim haben keine). */
export function rankNotches(rank?: number | null, material?: string | null): number {
  const n = Number(rank || 0);
  if (n >= 1 && n <= 7) return n;
  const own = material ? MATERIAL_LOOKS[material]?.rank : 0;
  return own && own <= 7 ? own : 0;
}

/** Name des Materials einer Stufe: neues Feld, sonst der Name zum alten Level. */
export function materialName(tier?: { material?: string | null; material_name?: string | null; level?: number | null } | null): string {
  if (tier?.material && MATERIAL_LOOKS[tier.material]) return MATERIAL_LOOKS[tier.material].name;
  if (tier?.material_name) return tier.material_name;
  return lookFor(null, tier?.level).name;
}

/** Leitfarbe des Materials (Rand) - für Texte und Ränder neben dem Abzeichen. */
export function materialColor(tier?: { material?: string | null; level?: number | null } | null): string {
  return lookFor(tier?.material, tier?.level).rim;
}
