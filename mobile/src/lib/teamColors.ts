// Team-Farbe (#1347): dieselben acht ruhigen Farben wie Server (backend/services/team_colors.py) und Web
// (frontend/src/lib/teamColors.js) - der Test frontend/src/lib/teamColors.test.js hält alle drei gleich.

export type TeamColor = { key: string; label: string; hex: string };

export const TEAM_COLORS: TeamColor[] = [
  { key: "cyan", label: "Cyan", hex: "#1C8DB8" },
  { key: "blue", label: "Blau", hex: "#3159C9" },
  { key: "violet", label: "Violett", hex: "#6A47B8" },
  { key: "wine", label: "Weinrot", hex: "#9C3656" },
  { key: "orange", label: "Orange", hex: "#C06A2B" },
  { key: "ochre", label: "Ocker", hex: "#A07A2C" },
  { key: "green", label: "Grün", hex: "#2E8A5A" },
  { key: "slate", label: "Schiefer", hex: "#56627A" },
];

export const AUTO_COLOR = "auto";

export function teamColorHex(key?: string | null): string {
  return (TEAM_COLORS.find((color) => color.key === key) || TEAM_COLORS[0]).hex;
}

/** Fester Ton je Name (FNV-1a) für Gesichter ohne Bild - wie im Web. */
export function faceTone(name?: string | null): string {
  let hash = 2166136261;
  for (const ch of String(name || "")) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return TEAM_COLORS[hash % TEAM_COLORS.length].hex;
}
