// Erfolge II (E8, #618): die neun Material-Looks als Farben und Eigenheiten. Jedes Material hat einen
// eigenen Charakter (Holz mit Maserung, Eisen gebürstet, Bronze mit Glanzlauf, Silber mit Spiegelblitz,
// Gold geprägt, Platin mit Eiskristallen, Diamant mit Facetten und Prisma, Legendär rot mit Löwenrelief,
// Geheim violett mit Fragezeichen). Das Abzeichen (Badge.jsx) baut daraus Verläufe, Rand und Effekte.

export const MATERIAL_LOOKS = {
  wood: {
    name: "Holz", rank: 1,
    base: "#7A5330", light: "#C08A55", dark: "#3E2914", rim: "#A0703C", ink: "#F3DDC0", glow: "#A0703C",
    texture: "grain", motion: "none",
  },
  iron: {
    name: "Eisen", rank: 2,
    base: "#6B7178", light: "#B4BAC0", dark: "#2E3237", rim: "#9AA0A6", ink: "#F1F3F5", glow: "#9AA0A6",
    texture: "brushed", motion: "spark",
  },
  bronze: {
    name: "Bronze", rank: 3,
    base: "#9A5E22", light: "#E3A25C", dark: "#4A2B0E", rim: "#CD7F32", ink: "#FFE7C8", glow: "#CD7F32",
    texture: "gloss", motion: "sheen",
  },
  silver: {
    name: "Silber", rank: 4,
    base: "#8E9296", light: "#E8EAEC", dark: "#3F4245", rim: "#C0C0C0", ink: "#FFFFFF", glow: "#C0C0C0",
    texture: "mirror", motion: "flash",
  },
  gold: {
    name: "Gold", rank: 5,
    base: "#B8900B", light: "#FFE066", dark: "#5C4706", rim: "#FFD700", ink: "#FFF6CC", glow: "#FFD700",
    texture: "emboss", motion: "sparkle",
  },
  platinum: {
    name: "Platin", rank: 6,
    base: "#1F6E88", light: "#8FE2FF", dark: "#0C2F3C", rim: "#29B6E8", ink: "#E6F9FF", glow: "#29B6E8",
    texture: "ice", motion: "crystals",
  },
  diamond: {
    name: "Diamant", rank: 7,
    base: "#5CB8CF", light: "#E9FCFF", dark: "#1C5563", rim: "#B9F2FF", ink: "#FFFFFF", glow: "#B9F2FF",
    texture: "facets", motion: "prism",
  },
  legendary: {
    name: "Legendär", rank: 8,
    base: "#9E1A12", light: "#FF7A6E", dark: "#3E0905", rim: "#FF3B30", ink: "#FFE8E5", glow: "#FF3B30", accent: "#FFD700",
    texture: "lion", motion: "flame",
  },
  hidden: {
    name: "Geheim", rank: 9,
    base: "#5B2A8F", light: "#C79BFF", dark: "#22103A", rim: "#A855F7", ink: "#F3E8FF", glow: "#A855F7",
    texture: "veil", motion: "turn",
  },
};

export const MATERIAL_ORDER = Object.keys(MATERIAL_LOOKS);

// Alte Clients / alte Vergaben tragen nur ein Level 1–5: daraus das Material, wie im Backend.
export function materialForLevel(level, { special = false, negative = false } = {}) {
  const n = Number(level || 1);
  if (n >= 5) return negative ? "hidden" : special ? "legendary" : "legendary";
  return { 1: "bronze", 2: "silver", 3: "gold", 4: "platinum" }[n] || "bronze";
}

export function lookFor(material, level, options) {
  const key = material && MATERIAL_LOOKS[material] ? material : materialForLevel(level, options);
  return { key, ...MATERIAL_LOOKS[key] };
}

export function rankNotches(rank, material) {
  const n = Number(rank || 0);
  if (n >= 1 && n <= 7) return n;
  return MATERIAL_LOOKS[material]?.rank <= 7 ? MATERIAL_LOOKS[material].rank : 0;
}
