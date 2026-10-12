export const colors = {
  black: "#0A0A0A",
  surface: "#121212",
  card: "#18181B",
  cardAlt: "#101013",
  cyan: "#29B6E8",
  cyanHover: "#1E95C2",
  white: "#FFFFFF",
  muted: "#A1A1AA",
  border: "rgba(255,255,255,0.1)",
  gold: "#FFD700",
  live: "#FF3B30",
  success: "#00FF88",
};

// Ecken wie im Web (#1151): dort ist der Grundwert `--radius: 0.125rem` - 2 Punkte (frontend/src/index.css). Karten,
// Knöpfe, Eingaben und Schilder nehmen ihn; Runde (Avatare, Zahlen-Bubbles) bleiben rund. Ein Test im Web
// (lib/categoryColors.test.js) hält die Werte gleich.
export const radius = {
  sm: 2,
  md: 2,
  lg: 2,
};

// Farben je Art an einer Stelle (#1151) - dieselben wie im Web (frontend/src/lib/categoryColors.js): Kalender, Karten
// und Etiketten nehmen sie von hier. Die neue Zuordnung aus #1305 (Turnier Cyan, Fast Lap Türkis, Verein Gold) ändert
// beide Stellen zugleich; der Gleichheits-Test hält sie zusammen.
export const kindColors = {
  event: "#9F7AEA",
  tournament: "#FFD700",
  fastlap: "#29B6E8",
  // Versammlungen und eigene Helferschichten im Kalender (#1190) - grün, nur für Mitglieder.
  club: "#10B981",
};

// Die vier Knöpfe wie im Web (#1082, #1151; frontend/src/index.css `tls-btn--…`): wichtig (blau gefüllt, mit Pfeil),
// zweitrangig (blauer Rahmen), leise (grauer Rahmen), gefährlich (roter Rahmen statt roter Fläche).
export const buttonColors = {
  primary: { background: "#29B6E8", pressed: "#1E95C2", text: "#04141B", border: "#29B6E8" },
  secondary: { background: "transparent", pressed: "rgba(41, 182, 232, 0.12)", text: "#29B6E8", border: "rgba(41, 182, 232, 0.55)" },
  quiet: { background: "transparent", pressed: "rgba(255, 255, 255, 0.06)", text: "rgba(255, 255, 255, 0.72)", border: "rgba(255, 255, 255, 0.18)" },
  danger: { background: "transparent", pressed: "rgba(255, 59, 48, 0.16)", text: "#FF6B6B", border: "rgba(255, 59, 48, 0.5)" },
};

// Bewegungs-Regeln (#1070) - dieselben Werte wie im Web (frontend/src/lib/motion.js und index.css): drei Dauern in
// Millisekunden und eine Kurve. Ein Test im Web (lib/motion.test.js) hält beide Seiten zusammen.
export const motion = {
  fast: 150,
  mid: 240,
  slow: 420,
  ease: [0.2, 0.7, 0.2, 1] as const,
};
