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
// Durchmesser des Fotos: Profil, Spielerkarte, Listen (Chat, Teilnehmer, Rangliste).
export const FRAME_SIZES = { profile: 172, card: 96, list: 44 };
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
 * Ausdehnung (`box`) und dem Ring. Mal Foto-Durchmesser ergibt das den Außenabstand, damit der Rahmen nichts daneben
 * überdeckt. Auf drei Stellen nach oben gerundet.
 */
export function framePadding(ring) {
  const scale = 1 / (2 * ring.r);
  const [left, top, right, bottom] = ring.box;
  const up = (value) => Math.max(0, Math.ceil(value * 1000) / 1000);
  return [(ring.cy - top) * scale - 0.5, (right - ring.cx) * scale - 0.5, (bottom - ring.cy) * scale - 0.5, (ring.cx - left) * scale - 0.5].map(up);
}

// Listen: ein Wert für alle Ränge (je Seite das Größte), damit Zeilen gleich hoch bleiben.
export const LIST_PADDING = Object.values(RING).map(framePadding).reduce((max, pad) => max.map((value, i) => Math.max(value, pad[i])), [0, 0, 0, 0]);

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
