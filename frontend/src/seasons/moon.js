// Mondphase (#658): der Mond auf der Seite zeigt die echte Phase des Tages - zu Halloween 2026 ist er
// fünf Tage nach Vollmond (26.10.) noch fast rund. Mittlere Rechnung ab dem Neumond vom 6.1.2000, 18:14 UTC;
// die Abweichung zur genauen Phase bleibt unter einem halben Tag.

export const SYNODIC_DAYS = 29.530588853;
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/** Phase als Bruch 0…1: 0 = Neumond, 0.25 = zunehmender Halbmond, 0.5 = Vollmond, 0.75 = abnehmender Halbmond. */
export function moonPhase(date = new Date()) {
  const days = (date.getTime() - REFERENCE_NEW_MOON) / 86400000;
  const phase = (days / SYNODIC_DAYS) % 1;
  return phase < 0 ? phase + 1 : phase;
}

/** Beleuchteter Anteil der Scheibe 0…1. */
export function illumination(phase) {
  return (1 - Math.cos(phase * Math.PI * 2)) / 2;
}

/** SVG-Pfad der hellen Sichel oder Scheibe (Nordhalbkugel: zunehmend rechts hell, abnehmend links hell). */
export function litPath(phase, cx, cy, r) {
  const waxing = phase <= 0.5;
  const gibbous = illumination(phase) > 0.5;
  const rx = Math.max(0.01, Math.abs(Math.cos(phase * Math.PI * 2)) * r);
  const outer = waxing ? 1 : 0;
  const inner = gibbous ? outer : 1 - outer;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${outer} ${cx} ${cy + r} A ${rx.toFixed(2)} ${r} 0 0 ${inner} ${cx} ${cy - r} Z`;
}
