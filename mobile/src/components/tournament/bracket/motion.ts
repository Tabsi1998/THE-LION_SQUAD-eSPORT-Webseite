import { css, cubicBezier } from "react-native-reanimated";

// Bewegung im Turnierbaum (#1563), geplant nach animate-expo: selten (je neuem Stand), nur transform und opacity, auf
// dem UI-Thread. Die federnden Teile (Weiterkommen, Platzziffern, Zählen) stehen in BracketMotion.tsx; hier die
// CSS-Animationen beim Einhängen: Aufleuchten, Atmen des Live-Punkts, Pokal, das Anheben einer Karte bei der Auslosung
// (#1633). „Bewegung reduzieren“: nichts davon.

export const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);

/** Kurzes Aufleuchten: hell, dann ruhig ausklingen. */
const FLASH = css.keyframes({ "0%": { opacity: 0 }, "20%": { opacity: 1 }, "100%": { opacity: 0 } });
/** Läuft gerade: der rote Punkt atmet. */
const BREATHE = css.keyframes({ "50%": { opacity: 0.3 } });
/** Sieger-Moment: der Pokal hebt sich einmal. */
const CROWN = css.keyframes({ "0%": { transform: [{ scale: 1 }] }, "35%": { transform: [{ scale: 1.06 }] }, "100%": { transform: [{ scale: 1 }] } });

export function flashStyle(delay: number) {
  return { animationName: FLASH, animationDuration: 760, animationDelay: delay, animationTimingFunction: EASE_OUT, animationFillMode: "both" as const };
}

export function breatheStyle(reduce: boolean) {
  return reduce ? null : { animationName: BREATHE, animationDuration: 1600, animationIterationCount: "infinite" as const, animationTimingFunction: "ease-in-out" as const };
}

export function crownStyle(reduce: boolean) {
  return reduce ? null : { animationName: CROWN, animationDuration: 520, animationTimingFunction: EASE_OUT };
}

// Auslosung als Moment (#1633): die Karte hebt sich sanft an und setzt wieder auf - ruhig, ohne Nachfedern. Nur
// transform; das Aufleuchten darüber ist eine eigene Fläche (Flash, nur Deckkraft).
const LIFT = css.keyframes({
  "0%": { transform: [{ translateY: 0 }, { scale: 1 }] },
  "40%": { transform: [{ translateY: -6 }, { scale: 1.02 }] },
  "100%": { transform: [{ translateY: 0 }, { scale: 1 }] },
});
/** Ein Hinweis kommt von unten herein (Auslosung bereit, zufällig gezogen). */
const RISE_IN = css.keyframes({
  "0%": { opacity: 0, transform: [{ translateY: 8 }] },
  "100%": { opacity: 1, transform: [{ translateY: 0 }] },
});
export const EASE_IN_OUT = cubicBezier(0.77, 0, 0.175, 1);

export function liftStyle(delay: number, reduce: boolean) {
  return reduce ? null : { animationName: LIFT, animationDuration: 700, animationDelay: delay, animationTimingFunction: EASE_IN_OUT, animationFillMode: "both" as const };
}

export function riseInStyle(reduce: boolean) {
  return reduce ? null : { animationName: RISE_IN, animationDuration: 260, animationTimingFunction: EASE_OUT, animationFillMode: "both" as const };
}
