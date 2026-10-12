// Löwen-Rang (#1452, #1454): 12 Ränge zu je fünf Level, Rang 12 = Level 55–60. Dieselben Namen wie im Backend
// (services/levels.py) - Abzeichen, XP-Balken, Profil und App zeigen überall denselben Namen.
// Die Rahmen sind gezeichnete Grafiken (frontend/public/assets/loewen-rang, erzeugt von
// scripts/loewen_rang_assets.py). Sie sind nicht genau mittig gezeichnet: loewenRangRing.json sagt je Rahmen, wo
// das Loch sitzt (cx, cy) und wie groß es ist (r), alles als Anteil der Kantenlänge.
import RING from "./loewenRangRing.json";

export const MAX_LEVEL = 60;
export const RANK_SIZE = 5;
export const RANK_NAMES = [
  "Jungtier", "Fährte", "Rudel", "Jäger", "Silbermähne", "Goldmähne",
  "Löwenhaupt", "Brüller", "Schwingen", "Obsidian", "Sonnenlöwe", "Löwenkönig",
];
export const FRAME_WIDTHS = [160, 320, 640];
// Feste Fläche für Rahmen und Foto zusammen (Kantenlänge in px), gleich für alle Ränge: Profil (am Handy 200), Karte,
// Listen (Chat, Teilnehmer, Rangliste) und klein fürs Podest. Das Foto wird je Rang so groß, dass der Rahmen samt
// Schwingen und Krone genau hineinpasst - der Kopf ist bei jedem Rang gleich hoch.
export const FRAME_SIZES = { profile: 260, card: 150, list: 92, mini: 64 };
export const PROFILE_SMALL = 200;
const CYAN = "#29B6E8";
const GOLD = "#FFD700";

function clampLevel(level) {
  const value = Math.floor(Number(level) || 1);
  return Math.max(1, Math.min(MAX_LEVEL, value));
}

/** Rang 1–12: Level 1–4 sind Rang 1, danach je fünf Level ein Rang, 55–60 Rang 12. */
export function rankForLevel(level) {
  return Math.min(RANK_NAMES.length, Math.floor(clampLevel(level) / RANK_SIZE) + 1);
}

/**
 * Alles, was Rahmen und Schild über ein Level wissen: Rang, Name, Spanne, `step` (Level im Rang), wie viele Rauten
 * das Schild hat und wie viele gefüllt sind (Level 5 leer … 9 = vier gefüllt), MAX bei Level 60.
 */
export function rankInfo(level) {
  const lvl = clampLevel(level);
  const rank = rankForLevel(lvl);
  const from = Math.max(1, (rank - 1) * RANK_SIZE);
  const to = rank === RANK_NAMES.length ? MAX_LEVEL : rank * RANK_SIZE - 1;
  const key = String(rank).padStart(2, "0");
  return {
    level: lvl, rank, key, name: RANK_NAMES[rank - 1], from, to,
    step: lvl - from, pips: to - from, filled: lvl - from,
    // Wie weit im Rang (0 … 1) - der Glanz wird damit stärker.
    progress: (lvl - from) / (to - from),
    max: lvl >= MAX_LEVEL,
    color: rank >= 6 ? GOLD : CYAN,
  };
}

/** Die gemessene Ring-Geometrie eines Rahmens. */
export function ringOf(key) {
  return RING[key] || RING["01"];
}

/**
 * Den Rahmen so skalieren und verschieben, dass sein Ring genau auf dem runden Foto mit Radius `P` liegt:
 * Kantenlänge `F` und Versatz der Rahmenmitte (`ox`, `oy`) gegenüber der Fotomitte, in derselben Einheit wie `P`.
 */
export function frameLayout(P, ring) {
  const F = P / ring.r;
  return { F, ox: (0.5 - ring.cx) * F, oy: (0.5 - ring.cy) * F };
}

/**
 * Platz, den die Grafik rund um ein Foto mit Durchmesser 1 braucht - [oben, rechts, unten, links], aus der gemessenen
 * Ausdehnung (`box`) und dem Ring.
 */
export function framePadding(ring) {
  const scale = 1 / (2 * ring.r);
  const [left, top, right, bottom] = ring.box;
  return [(ring.cy - top) * scale - 0.5, (right - ring.cx) * scale - 0.5, (bottom - ring.cy) * scale - 0.5, (ring.cx - left) * scale - 0.5].map((value) => Math.max(0, value));
}

/**
 * Wie das Foto in der festen Fläche (Kantenlänge 1) sitzt: `photo` ist sein Durchmesser, `left`/`top` seine linke obere
 * Ecke - so, dass die ganze Grafik in die Fläche passt und darin mittig steht. Auf drei Stellen abgerundet, damit
 * nichts über den Rand ragt.
 */
export function frameFit(ring) {
  const [pt, pr, pb, pl] = framePadding(ring);
  const width = 1 + pl + pr;
  const height = 1 + pt + pb;
  const photo = Math.floor(1000 / Math.max(width, height)) / 1000;
  return { photo, left: (1 - width * photo) / 2 + pl * photo, top: (1 - height * photo) / 2 + pt * photo };
}

/** Die Bilder eines Rahmens: srcset über 160/320/640 und die Fassung für die Glanz-Maske. */
export function frameSources(key, displayPx = 320) {
  const v = ringOf(key).v;
  const url = (width) => `/assets/loewen-rang/rang-${key}-${width}.webp${v ? `?v=${v}` : ""}`;
  const maskWidth = FRAME_WIDTHS.find((width) => width >= displayPx * 2) || FRAME_WIDTHS[FRAME_WIDTHS.length - 1];
  return {
    src: url(320),
    srcSet: FRAME_WIDTHS.map((width) => `${url(width)} ${width}w`).join(", "),
    mask: url(maskWidth),
  };
}
