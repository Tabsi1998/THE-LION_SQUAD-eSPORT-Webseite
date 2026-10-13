// Löwen-Rang in der App (#1457): dieselbe Rechnung wie im Web (frontend/src/lib/loewenRang.js, #1452/#1454).
// 12 Ränge zu je fünf Level, Rang 12 = Level 55–60, dieselben Namen wie im Backend (services/levels.py). Die Rahmen
// sind gezeichnete Grafiken (mobile/assets/loewen-rang, erzeugt von scripts/loewen_rang_assets.py) und nicht genau
// mittig: geometry.json sagt je Rahmen, wo das Loch sitzt (cx, cy) und wie groß es ist (r), als Anteil der
// Kantenlänge. Web und App prüfen ihre Rechnung gegen dieselben Fälle (frontend/src/lib/loewenRang.cases.json).
import GEOMETRY from "../../assets/loewen-rang/geometry.json";

export type Ring = { cx: number; cy: number; r: number; box: number[]; edge?: number[][]; v?: string };
export type RankInfo = {
  level: number;
  rank: number;
  key: string;
  name: string;
  from: number;
  to: number;
  step: number;
  pips: number;
  filled: number;
  progress: number;
  max: boolean;
  color: string;
};

const RING = GEOMETRY as unknown as Record<string, Ring>;

export const MAX_LEVEL = 60;
export const RANK_SIZE = 5;
export const RANK_NAMES = [
  "Jungtier", "Fährte", "Rudel", "Jäger", "Silbermähne", "Goldmähne",
  "Löwenhaupt", "Brüller", "Schwingen", "Obsidian", "Sonnenlöwe", "Löwenkönig",
];
export const FRAME_WIDTHS = [160, 320, 640] as const;
export type FrameWidth = (typeof FRAME_WIDTHS)[number];
// Feste Fläche für Rahmen und Foto zusammen (Kantenlänge in Punkten), gleich für alle Ränge - wie im Web: Profil am
// Handy 220 (ab 640 Punkten Breite 285 wie am Desktop), Karte 150, Listen 92 und klein fürs Podest 64. Das Foto wird
// je Rang so groß, dass der Rahmen seitlich und unten genau hineinpasst; oben dürfen Krone und Schwingen bis
// TOP_OVERHANG über die Fläche ragen.
export const FRAME_SIZES = { profile: 220, card: 150, list: 92, mini: 64 } as const;
export type FrameVariant = keyof typeof FRAME_SIZES;
export const PROFILE_WIDE = 285;
export const WIDE_SCREEN = 640;
export const TOP_OVERHANG = 0.15;
const CYAN = "#29B6E8";
const GOLD = "#FFD700";

function clampLevel(level: unknown): number {
  const value = Math.floor(Number(level) || 1);
  return Math.max(1, Math.min(MAX_LEVEL, value));
}

/** Rang 1–12: Level 1–4 sind Rang 1, danach je fünf Level ein Rang, 55–60 Rang 12. */
export function rankForLevel(level: unknown): number {
  return Math.min(RANK_NAMES.length, Math.floor(clampLevel(level) / RANK_SIZE) + 1);
}

/**
 * Alles, was Rahmen und Schild über ein Level wissen: Rang, Name, Spanne, `step` (Level im Rang), wie viele Rauten
 * das Schild hat und wie viele gefüllt sind (Level 5 leer … 9 = vier gefüllt), MAX bei Level 60.
 */
export function rankInfo(level: unknown): RankInfo {
  const lvl = clampLevel(level);
  const rank = rankForLevel(lvl);
  const from = Math.max(1, (rank - 1) * RANK_SIZE);
  const to = rank === RANK_NAMES.length ? MAX_LEVEL : rank * RANK_SIZE - 1;
  const key = String(rank).padStart(2, "0");
  return {
    level: lvl, rank, key, name: RANK_NAMES[rank - 1], from, to,
    step: lvl - from, pips: to - from, filled: lvl - from,
    // Wie weit im Rang (0 … 1) - Glanz und Signatur werden damit stärker.
    progress: (lvl - from) / (to - from),
    max: lvl >= MAX_LEVEL,
    color: rank >= 6 ? GOLD : CYAN,
  };
}

/** Die gemessene Ring-Geometrie eines Rahmens. */
export function ringOf(key: string): Ring {
  return RING[key] || RING["01"];
}

/**
 * Den Rahmen so skalieren und verschieben, dass sein Ring genau auf dem runden Foto mit Radius `P` liegt:
 * Kantenlänge `F` und Versatz der Rahmenmitte (`ox`, `oy`) gegenüber der Fotomitte, in derselben Einheit wie `P`.
 */
export function frameLayout(P: number, ring: Ring): { F: number; ox: number; oy: number } {
  const F = P / ring.r;
  return { F, ox: (0.5 - ring.cx) * F, oy: (0.5 - ring.cy) * F };
}

/**
 * Platz, den die Grafik rund um ein Foto mit Durchmesser 1 braucht - [oben, rechts, unten, links], aus der gemessenen
 * Ausdehnung (`box`) und dem Ring.
 */
export function framePadding(ring: Ring): number[] {
  const scale = 1 / (2 * ring.r);
  const [left, top, right, bottom] = ring.box;
  return [(ring.cy - top) * scale - 0.5, (right - ring.cx) * scale - 0.5, (bottom - ring.cy) * scale - 0.5, (ring.cx - left) * scale - 0.5].map((value) => Math.max(0, value));
}

/**
 * Wie das Foto in der festen Fläche (Kantenlänge 1) sitzt: `photo` ist sein Durchmesser, `left`/`top` seine linke obere
 * Ecke. Seitlich und unten passt die ganze Grafik in die Fläche, oben darf sie bis `overhang` hinausragen. Passt sie
 * auch ohne Überstand, steht sie mittig; sonst sitzt sie unten auf und ragt oben hinaus. Auf drei Stellen abgerundet,
 * damit nichts über den Rand ragt.
 */
export function frameFit(ring: Ring, overhang = TOP_OVERHANG): { photo: number; left: number; top: number } {
  const [pt, pr, pb, pl] = framePadding(ring);
  const width = 1 + pl + pr;
  const height = 1 + pt + pb;
  const photo = Math.floor(1000 * Math.min(1 / width, (1 + overhang) / height)) / 1000;
  const artTop = height * photo <= 1 ? (1 - height * photo) / 2 : 1 - height * photo;
  return { photo, left: (1 - width * photo) / 2 + pl * photo, top: artTop + pt * photo };
}

// ---- Ab hier nur App: Maße in Punkten, Schild, Bildgröße, Signatur ----

/** Das Schild ragt 10 Punkte in die Grafik hinein (wie im Web). */
export const PLATE_OVERLAP = 10;
/** Listen und klein: nur die Grafik, ohne Glanz, Schild und Bewegung. */
export const STILL_VARIANTS: ReadonlySet<FrameVariant> = new Set<FrameVariant>(["list", "mini"]);
export const MAX_PRESTIGE = 5;

export type FrameBox = {
  info: RankInfo;
  ring: Ring;
  /** Kantenlänge der festen Fläche. */
  area: number;
  /** Durchmesser des runden Fotos und seine linke obere Ecke in der Fläche. */
  photo: number;
  photoLeft: number;
  photoTop: number;
  /** Die Rahmen-Grafik: Kantenlänge und linke obere Ecke in der Fläche (oben bis 15 % darüber hinaus). */
  art: { size: number; left: number; top: number };
  /** Oberkante des Schilds in der Fläche. */
  plateTop: number;
};

/** Wo Foto, Rahmen und Schild in einer Fläche mit Kantenlänge `area` sitzen - in Punkten, für jedes Level. */
export function frameBox(level: unknown, area: number): FrameBox {
  const info = rankInfo(level);
  const ring = ringOf(info.key);
  const fit = frameFit(ring);
  const pad = framePadding(ring);
  const photo = area * fit.photo;
  const photoLeft = area * fit.left;
  const photoTop = area * fit.top;
  const { F, ox, oy } = frameLayout(photo / 2, ring);
  return {
    info,
    ring,
    area,
    photo,
    photoLeft,
    photoTop,
    art: { size: F, left: photoLeft + photo / 2 + ox - F / 2, top: photoTop + photo / 2 + oy - F / 2 },
    plateTop: photoTop + photo + pad[2] * photo - PLATE_OVERLAP,
  };
}

/** Kantenlänge der Fläche je Größe; das Profil auf breiten Geräten (Tablet) wie am Desktop. */
export function areaFor(variant: FrameVariant, screenWidth = 0): number {
  if (variant === "profile" && screenWidth >= WIDE_SCREEN) return PROFILE_WIDE;
  return FRAME_SIZES[variant];
}

/** Platz unter der Fläche für Schild und Rauten, mit Prestige auch für die Sterne (wie im Web). */
export function plateSpace(variant: FrameVariant, stars: number): number {
  if (STILL_VARIANTS.has(variant)) return 0;
  if (variant === "card") return stars > 0 ? 35 : 21;
  return stars > 0 ? 41 : 26;
}

/** Die kleinste Bildbreite, die die Grafik in Gerätepixeln abdeckt (160, 320 oder 640). */
export function frameWidthFor(artSize: number, pixelRatio = 2): FrameWidth {
  const px = Math.ceil(artSize * pixelRatio);
  return FRAME_WIDTHS.find((width) => px <= width) ?? 640;
}

/** Prestige-Sterne 0–5 aus dem, was der Server schickt. */
export function prestigeCount(prestige: unknown): number {
  return Math.max(0, Math.min(MAX_PRESTIGE, Math.floor(Number(prestige) || 0)));
}

/** Text des Schilds: „LVL 9“, bei 60 „LVL 60 · MAX“, für Teams „TEAM LVL 9“. */
export function plateTag(level: unknown, { team = false }: { team?: boolean } = {}): string {
  const info = rankInfo(level);
  if (team) return `TEAM LVL ${info.level}`;
  return info.max ? "LVL 60 · MAX" : `LVL ${info.level}`;
}

/**
 * Zugänglicher Name des Rahmens: „Level 9, Rang Fährte“, mit Prestige „…, Prestige 2“. Der Rangname kommt vom
 * Server (`rank_name`), sonst aus der eigenen Liste - beide sind gleich.
 */
export function frameLabel(level: unknown, { rankName, prestige = 0, team = false }: { rankName?: string | null; prestige?: unknown; team?: boolean } = {}): string {
  const info = rankInfo(level);
  const stars = prestigeCount(prestige);
  return `${team ? "Team-Level" : "Level"} ${info.level}, Rang ${rankName || info.name}${stars > 0 ? `, Prestige ${stars}` : ""}`;
}

// ---- Vereinfachte Signatur fürs Profil (#1457) ----
// Im Web hat jeder Rang eine eigene, aufwendige Signatur (#1455). Die App zeigt im Profil eine schlanke Fassung mit
// vier Arten: Funken, Glut, Frost und Blitz - zugeordnet nach dem Namen der Web-Signatur desselben Rangs.

export const SIGNATURE_FX = ["spark", "paw", "ember", "hunt", "frost", "gold", "fire", "roar", "feather", "lava", "sun", "storm"] as const;
export type SignatureKind = "funken" | "glut" | "frost" | "blitz";
const KIND_OF: Record<(typeof SIGNATURE_FX)[number], SignatureKind> = {
  spark: "funken", paw: "funken", ember: "glut", hunt: "funken", frost: "frost", gold: "funken",
  fire: "glut", roar: "blitz", feather: "frost", lava: "glut", sun: "glut", storm: "blitz",
};
const FX_COLOR: Record<(typeof SIGNATURE_FX)[number], string> = {
  spark: CYAN, paw: CYAN, ember: "#FF9A4D", hunt: CYAN, frost: "#CFF3FF", gold: GOLD,
  fire: "#FF7A2F", roar: "#FFE27A", feather: "#F4F8FF", lava: "#FF5A2A", sun: "#FFC94D", storm: "#8FE3FF",
};
/** Höchstens so viele Teilchen gleichzeitig - flüssig auch auf schwachen Geräten. */
export const MAX_PARTICLES = 6;
const MIN_PARTICLES = 2;

export type SignaturePlan = { fx: (typeof SIGNATURE_FX)[number]; kind: SignatureKind; color: string; strength: number; count: number };

/**
 * Die Signatur eines Levels: Art und Farbe nach Rang, Stärke nach Level im Rang. Das erste Level eines Rangs hat noch
 * keine Teilchen (wie im Web), danach 2 bis 6.
 */
export function signaturePlan(level: unknown): SignaturePlan {
  const info = rankInfo(level);
  const fx = SIGNATURE_FX[info.rank - 1];
  const strength = info.progress;
  const count = strength <= 0 ? 0 : Math.round(MIN_PARTICLES + (MAX_PARTICLES - MIN_PARTICLES) * strength);
  return { fx, kind: KIND_OF[fx], color: FX_COLOR[fx], strength, count };
}

/** Bewegt wird nur das Profil, und nie bei „Bewegung reduzieren“. */
export function frameAnimated(variant: FrameVariant, reduceMotion: boolean): boolean {
  return variant === "profile" && !reduceMotion;
}

/** Stärke des Glanzes: wächst mit dem Level im Rang (wie `--lvf-shine` im Web). */
export function shineStrength(level: unknown): number {
  return 0.35 + 0.55 * rankInfo(level).progress;
}
