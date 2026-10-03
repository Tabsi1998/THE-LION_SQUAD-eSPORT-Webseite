// Wo Partyhut und Luftschlangen sitzen (Fasching F2 #746, F3 #747): der Hut auf dem Kopf des echten Löwen - aus dem
// Bild gelesen, damit er auch auf einem eigenen Vereinslogo richtig sitzt -, die Luftschlangen an echten Kanten, nur
// dort, wo darunter nichts Lesbares hängt. Reine Rechnung bis auf das Lesen des Bildes.
import { seasonRng } from "../rng";

/**
 * Die Luftschlangen einer Seite in diesem Jahr: wie viele je Seite, wie lang, wie gekräuselt, welche Farben - aus
 * dem Jahres-Seed und der Route, damit jede Seite etwas anders aussieht und ein Neuladen nichts ändert.
 */
export function streamerPlan(year, route = "/") {
  const rng = seasonRng({ season: "carnival", year, route }, "streamers");
  const palette = [["#29B6E8", "#7fd6f5"], ["#FFD700", "#ffe866"], ["#ff4fa3", "#ff9ccb"], ["#3ddc84", "#8ff0bb"], ["#a66bff", "#cbb0ff"], ["#ff8a3d", "#ffbb8a"]];
  const make = (side) => Array.from({ length: 1 + Math.floor(rng() * 2) }, (_, index) => ({
    side,
    index,
    offset: Math.round(10 + rng() * 26 + index * 18),
    length: Math.round(70 + rng() * 80),
    curl: Math.round((5 + rng() * 7) * 10) / 10,
    turns: Math.round((2.5 + rng() * 2.5) * 10) / 10,
    colors: palette[Math.floor(rng() * palette.length)],
    sway: Math.round((4.5 + rng() * 2.5) * 10) / 10,
    delay: Math.round(rng() * 600),
  }));
  return [...make("left"), ...make("right")];
}

/** Die Form einer Luftschlange als SVG-Pfad: oben befestigt, nach unten gekräuselt, unten etwas weiter schwingend. */
export function streamerPath({ length, curl, turns }) {
  const steps = 32;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const s = i / steps;
    const x = Math.sin(s * turns * Math.PI * 2) * curl * (0.35 + 0.65 * s);
    return `${(12 + x).toFixed(1)} ${(s * length).toFixed(1)}`;
  });
  return `M ${points[0]} L ${points.slice(1).join(" L ")}`;
}
