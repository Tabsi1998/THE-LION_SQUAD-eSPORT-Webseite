// Team-Farbe (#1347): acht ruhige Farben für den Wappen-Kopf - dieselben Schlüssel und Werte wie im Server
// (backend/services/team_colors.py) und in der App (mobile/src/lib/teamColors.ts); teamColors.test.js hält sie gleich.

export const TEAM_COLORS = [
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

/** Der Farbwert zu einem Schlüssel - ohne gültigen Schlüssel das Vereins-Cyan. */
export function teamColorHex(key) {
  return (TEAM_COLORS.find((color) => color.key === key) || TEAM_COLORS[0]).hex;
}

/** Der dunkle Verlauf des Bandes: oben die Team-Farbe gedämpft, unten fast schwarz. */
export function bandBackground(hex) {
  const color = hex || TEAM_COLORS[0].hex;
  return `linear-gradient(160deg, ${color}E6 0%, ${color}8C 38%, #0A0A0A 100%)`;
}
