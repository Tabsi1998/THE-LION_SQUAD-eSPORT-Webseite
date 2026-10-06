// Bewegungs-Regeln (#1070): drei Dauern und eine Kurve für die ganze Oberfläche. Dieselben Werte stehen als
// CSS-Variablen in index.css (--tls-motion-fast/-mid/-slow, --tls-ease) und in der App (mobile/src/theme.ts,
// `motion`); lib/motion.test.js hält die drei Stellen zusammen. Bewegt wird über Verschieben, Skalieren und
// Deckkraft - nicht über Breite, Höhe oder Abstände.
//   fast  150 ms  Rückmeldung auf Zeiger und Finger (Farbe, kleines Schild)
//   mid   240 ms  Zustandswechsel eines Teils (Karte hebt sich, Menü gleitet, Seite blendet ein)
//   slow  420 ms  größere Wege (Bild wächst, Linien zeichnen sich)
export const MOTION = Object.freeze({ fast: 150, mid: 240, slow: 420, ease: Object.freeze([0.2, 0.7, 0.2, 1]) });

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
