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

export const radius = {
  sm: 2,
  md: 4,
  lg: 8,
};

// Bewegungs-Regeln (#1070) - dieselben Werte wie im Web (frontend/src/lib/motion.js und index.css): drei Dauern in
// Millisekunden und eine Kurve. Ein Test im Web (lib/motion.test.js) hält beide Seiten zusammen.
export const motion = {
  fast: 150,
  mid: 240,
  slow: 420,
  ease: [0.2, 0.7, 0.2, 1] as const,
};
