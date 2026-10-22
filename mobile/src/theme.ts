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
  // Grün heißt „offen und frei“ (#1305) - das weichere #1FD08E statt Neon, wie `roles.ok`.
  success: "#1FD08E",
};

// Ecken wie im Web (#1151): dort ist der Grundwert `--radius: 0.125rem` - 2 Punkte (frontend/src/index.css). Karten,
// Knöpfe, Eingaben und Schilder nehmen ihn; Runde (Avatare, Zahlen-Bubbles) bleiben rund. Ein Test im Web
// (lib/categoryColors.test.js) hält die Werte gleich.
export const radius = {
  sm: 2,
  md: 2,
  lg: 2,
};

// Farb-Rollen (#1305) - dieselben Werte wie im Web (frontend/src/lib/categoryColors.js, styles/system.css): jede Farbe
// hat genau eine Aufgabe. Cyan Marke und „du“, Rot nur „läuft gerade“, Orange Achtung, Grün offen und frei, Gold Ehre
// (Platz 1, Pokal, Mitgliedschaft, Verein), Violett Events, Grau Nebentext und Vorbei. Silber und Bronze nur für Platz 2/3.
export const roles = {
  brand: "#29B6E8",
  live: "#FF3B30",
  warn: "#FF9F43",
  ok: "#1FD08E",
  honor: "#FFD700",
  event: "#9F7AEA",
  muted: "#B4B4BD",
  quiet: "#8E8E99",
  silver: "#C9CED6",
  bronze: "#D08A4E",
  // Pink und Violett nur für Pole und schnellste Runde (Rennserien) - wie --tls-pole/--tls-fastest im Web.
  pole: "#E879F9",
  fastest: "#C084FC",
};

// Flächen (#1305): Schwarz als Grund, darauf drei Stufen - wie --tls-surface-0 bis -3 im Web.
export const surfaces = {
  base: "#0A0A0A",
  s1: "#121214",
  s2: "#18181C",
  s3: "#1F1F24",
};

// Farben je Art an einer Stelle (#1151, #1305) - dieselben wie im Web (frontend/src/lib/categoryColors.js): Event
// Violett, Turnier Cyan, Fast Lap Türkis, Verein Gold. Kalender, Karten und Etiketten nehmen sie von hier; der
// Gleichheits-Test im Web hält beide Seiten zusammen.
export const kindColors = {
  event: "#9F7AEA",
  tournament: "#29B6E8",
  fastlap: "#2DD4BF",
  // Versammlungen und eigene Helferschichten im Kalender (#1190), nur für Mitglieder.
  club: "#FFD700",
};

// Dunkle Fassungen je Art für Flächen mit weißer Schrift (Kopf der Datums-Kachel, #1318): Weiß erreicht darauf
// mindestens 4,5 : 1.
export const kindColorsDark = {
  event: "#7655CC",
  tournament: "#1A7AA3",
  fastlap: "#0E7F73",
  club: "#85690A",
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

// Mikro-Bewegung (#1969) - dieselben Werte wie `MICRO` im Web (frontend/src/lib/motion.js). Die Bausteine in
// components/motion (CountUp, StaggerIn, Glow, Press) nehmen nur diese Werte; lib/motion.test.ts hält sie fest.
//   count         900 ms  Zahlen und Zeiten zählen hoch (ease-out)
//   countStagger   25 ms  Versatz je Zeile beim Hochzählen in Tabellen
//   stagger        50 ms  Versatz je Eintrag beim gestaffelten Erscheinen - nur die ersten `staggerMax` Einträge
//   glow          840 ms  kurzes Aufleuchten eines neuen Werts oder Abzeichens, einmal
export const micro = {
  count: 900,
  countStagger: 25,
  stagger: 50,
  staggerMax: 12,
  glow: 840,
};

// Farben fürs Aufleuchten (#1969) - die Farb-Rollen wie `data-tone` an `.tls-glow` im Web.
export const glowTones = {
  brand: roles.brand,
  honor: roles.honor,
  ok: roles.ok,
  pole: roles.pole,
  fastest: roles.fastest,
};

// Puls-Varianten (#1969) wie `.tls-run-pulse` im Web: Gold (Ehre, Vorgabe), Cyan (Marke), Rot („läuft gerade“), Grün.
export const pulseTones = {
  honor: roles.honor,
  brand: roles.brand,
  live: roles.live,
  ok: roles.ok,
};
