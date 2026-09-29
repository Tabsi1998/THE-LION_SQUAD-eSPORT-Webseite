// Erfolge II (E8, #618): welcher Ablauf für welches Paket. Reine Funktionen ohne DOM, damit die Auswahl
// testbar bleibt: Material und Kategorie der höchsten Stufe bestimmen Look und Bewegung, das Paket und
// sein Kontext den Sonderablauf. Negatives bekommt nie eine Zeremonie.

import { MATERIAL_LOOKS, materialForLevel } from "../materials";

// Kategorie → Bewegung, mit der das Abzeichen auf die Bühne kommt.
export const MOTIONS = {
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
  single: { duration: 7000, label: "Neues Achievement" },
  stack: { duration: 3000, perItem: 2500, label: "Sammel-Zeremonie" },
  first: { duration: 13000, label: "Dein erster Erfolg" },
  group: { duration: 11000, label: "Gruppe abgeschlossen" },
  category: { duration: 9500, label: "Kategorie abgeschlossen" },
  diamond: { duration: 12000, label: "Diamant" },
  legendary: { duration: 10000, label: "Legendär" },
  levelup: { duration: 9000, label: "Level-Aufstieg" },
});
export const SEQUENCE_KEYS = Object.freeze(Object.keys(SEQUENCES));

const LEGACY_CATEGORY = { content: "creator", progression: "profile" };

export function categoryOf(tier) {
  const raw = tier?.category || tier?.group_category || "special";
  return LEGACY_CATEGORY[raw] || raw;
}

export function materialOf(tier) {
  if (tier?.material && MATERIAL_LOOKS[tier.material]) return tier.material;
  return materialForLevel(tier?.level, { negative: Boolean(tier?.is_negative), special: categoryOf(tier) === "special" });
}

export function rankOf(tier) {
  const rank = Number(tier?.rank || 0);
  if (rank > 0) return rank;
  return MATERIAL_LOOKS[materialOf(tier)]?.rank || 1;
}

// Höchste Stufe zuerst: Rang, dann Punkte, dann Name - die steht vorne auf der Bühne.
export function sortByRank(tiers) {
  return [...tiers].sort((a, b) => rankOf(b) - rankOf(a) || Number(b.points || 0) - Number(a.points || 0) || String(a.name || "").localeCompare(String(b.name || ""), "de"));
}

function isNegative(tier) {
  return Boolean(tier?.is_negative || categoryOf(tier) === "negative");
}

/**
 * Das Paket beschreiben: aus dem frischen Katalog (/achievements/me) und den neuen Stufen ergibt sich,
 * ob es der erste Erfolg überhaupt ist, ob eine Gruppe oder eine Kategorie damit vollständig wurde.
 */
export function describePackage(groups = [], fresh = []) {
  const freshCodes = new Set(fresh.map((t) => t.code));
  let earnedTotal = 0;
  let groupCompleted = null;
  let categoryCompleted = null;
  const byCategory = {};
  for (const group of groups) {
    if (group.is_negative) continue;
    const tiers = group.tiers || [];
    const earned = tiers.filter((t) => t.earned);
    earnedTotal += earned.length;
    const touched = tiers.some((t) => freshCodes.has(t.code));
    const measurable = tiers.filter((t) => !t.manual_only && t.condition_status !== "planned");
    const complete = measurable.length > 0 && measurable.every((t) => t.earned);
    const cat = categoryOf(group);
    const row = (byCategory[cat] ||= { groups: 0, complete: 0, touched: false });
    row.groups += 1;
    if (complete) row.complete += 1;
    if (touched) row.touched = true;
    if (touched && complete && tiers.length >= 3 && !groupCompleted) groupCompleted = group.code;
  }
  for (const [cat, row] of Object.entries(byCategory)) {
    if (row.touched && row.groups > 0 && row.complete === row.groups && row.groups >= 3) { categoryCompleted = cat; break; }
  }
  return { firstEver: earnedTotal > 0 && earnedTotal === fresh.length, groupCompleted, categoryCompleted };
}

/**
 * Der Plan für ein Paket: Sonderablauf, Material, Bewegung, Dauer, Klang und die Stufen in Bühnenfolge.
 * Gibt null zurück, wenn es nichts zu feiern gibt (leer oder nur Negatives).
 */
export function planCeremony(pkg) {
  const levelUp = pkg?.levelUp || null;
  const tiers = sortByRank((pkg?.tiers || []).filter((t) => !isNegative(t)));
  if (!tiers.length && !levelUp) return null;
  const context = pkg?.context || {};
  const top = tiers[0] || null;
  const material = top ? materialOf(top) : "gold";
  const motion = top ? (MOTIONS[categoryOf(top)] || "curtain") : "impact";

  let sequence = "single";
  if (levelUp && !tiers.length) sequence = "levelup";
  else if (context.firstEver) sequence = "first";
  else if (context.categoryCompleted) sequence = "category";
  else if (context.groupCompleted) sequence = "group";
  else if (material === "legendary") sequence = "legendary";
  else if (material === "diamond") sequence = "diamond";
  else if (tiers.length > 1) sequence = "stack";

  const meta = SEQUENCES[sequence];
  const duration = sequence === "stack" ? meta.duration + meta.perItem * tiers.length : meta.duration;
  const look = MATERIAL_LOOKS[material];
  return {
    id: pkg?.id || `${sequence}-${top?.code || "level"}-${Date.now()}`,
    sequence,
    label: meta.label,
    material,
    motion,
    category: top ? categoryOf(top) : "profile",
    accent: look?.rim || "#FFD700",
    duration,
    autoAdvanceMs: sequence === "stack" ? meta.perItem : 0,
    tiers,
    top,
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

// Partikelbudget je Ablauf: höchstens 160 am PC, 60 auf dem Handy (Ceremony.jsx halbiert bei schmalen Fenstern).
export function particleBudget(sequence, material) {
  const base = { single: 40, stack: 60, first: 80, group: 110, category: 120, diamond: 160, legendary: 160, levelup: 120 }[sequence] || 40;
  const bonus = material === "gold" ? 20 : material === "diamond" ? 30 : material === "legendary" ? 30 : 0;
  return Math.min(160, base + bonus);
}

export function particleKind(material) {
  return { wood: "leaf", iron: "spark", bronze: "ember", silver: "glint", gold: "confetti", platinum: "crystal", diamond: "prism", legendary: "flame", hidden: "wisp" }[material] || "confetti";
}
