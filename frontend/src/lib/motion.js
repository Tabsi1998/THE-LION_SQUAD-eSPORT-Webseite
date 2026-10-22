// Bewegungs-Regeln (#1070): drei Dauern und eine Kurve für die ganze Oberfläche. Dieselben Werte stehen als
// CSS-Variablen in index.css (--tls-motion-fast/-mid/-slow, --tls-ease) und in der App (mobile/src/theme.ts,
// `motion`); lib/motion.test.js hält die drei Stellen zusammen. Bewegt wird über Verschieben, Skalieren und
// Deckkraft - nicht über Breite, Höhe oder Abstände.
//   fast  150 ms  Rückmeldung auf Zeiger und Finger (Farbe, kleines Schild)
//   mid   240 ms  Zustandswechsel eines Teils (Karte hebt sich, Menü gleitet, Seite blendet ein)
//   slow  420 ms  größere Wege (Bild wächst, Linien zeichnen sich)
export const MOTION = Object.freeze({ fast: 150, mid: 240, slow: 420, ease: Object.freeze([0.2, 0.7, 0.2, 1]) });

// Bewegung über die Fläche (#1561): ein Name gleitet von Spiel zu Spiel - weich an, weich ab (strong ease-in-out).
// Nur für Wege auf dem Bildschirm, nicht für Ein- und Ausblenden; dort bleibt MOTION.ease.
export const EASE_MOVE = Object.freeze([0.77, 0, 0.175, 1]);

// Mikro-Bewegung (#1969): die Bausteine in components/tls/motion (CountUp, StaggerIn, Glow, Press) nehmen nur diese
// Werte. Dieselben stehen als CSS-Variablen in index.css (--tls-motion-count, --tls-motion-glow, --tls-stagger-step);
// lib/motion.test.js hält beide gleich.
//   count         900 ms  Zahlen und Zeiten zählen hoch (ease-out)
//   countStagger   25 ms  Versatz je Zeile beim Hochzählen in Tabellen
//   stagger        50 ms  Versatz je Eintrag beim gestaffelten Erscheinen - nur die ersten `staggerMax` Einträge
//   glow          840 ms  kurzes Aufleuchten eines neuen Werts oder Abzeichens, einmal
export const MICRO = Object.freeze({ count: 900, countStagger: 25, stagger: 50, staggerMax: 12, glow: 840 });

/** Dauer in Sekunden - so nimmt framer-motion sie. */
export function motionSeconds(key = "mid") {
  return (MOTION[key] ?? MOTION.mid) / 1000;
}

/** Übergang für framer-motion aus den festen Werten. */
export function motionTransition(key = "mid") {
  return { duration: motionSeconds(key), ease: [...MOTION.ease] };
}

/** Darf sich etwas bewegen? Mit „Bewegung reduzieren“ nein; ohne Auskunft des Browsers ja. */
export function motionAllowed(win = typeof window === "undefined" ? null : window) {
  if (!win || typeof win.matchMedia !== "function") return true;
  try {
    return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}
