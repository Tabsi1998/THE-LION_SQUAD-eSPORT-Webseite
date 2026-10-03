// Ostern in der App - die Rechnung ohne React (#645, #753, #756; wie frontend/src/seasons/easter/plan.js): welcher
// Ostertag heute ist (Wiener Datum), wann es still bleibt (Karfreitag), wann gegrüßt wird (Ostersonntag und -montag),
// welche Eier an der Begrüßungskarte liegen, wie ein Zitronenfalter fliegt, wann der Feldhase guckt und wie die
// wenigen Blütenblätter sinken.
import { effectClasses, screenClass } from "../intensity";
import { mulberry32 } from "../rng";

export const TIME_ZONE = "Europe/Vienna";
/** Die zwölf Muster der Ostereier - dieselben wie im Web (EggShape.jsx). */
export const EGG_PATTERNS = ["stripes", "dots", "zigzag", "waves", "checks", "stars", "flowers", "leaves", "hearts", "spiral", "diamonds", "lion"] as const;
export type EggPattern = (typeof EGG_PATTERNS)[number];

type EasterSeason = { data?: Record<string, unknown> | null } | null | undefined;

/** Das Wiener Datum (JJJJ-MM-TT) zu einem Zeitpunkt. */
export function viennaDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayNumber(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

export type EasterDay = "palm" | "week" | "friday" | "saturday" | "sunday" | "monday";
const DAYS: Record<string, EasterDay> = { "-7": "palm", "-2": "friday", "-1": "saturday", 0: "sunday", 1: "monday" };

/** Welcher Ostertag heute ist - gezählt vom Ostersonntag, den der Server mitschickt (`data.sunday`). */
export function easterDay(season: EasterSeason, now: Date = new Date()): EasterDay {
  const sunday = String(season?.data?.sunday || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sunday)) return season?.data?.quiet ? "friday" : "week";
  return DAYS[String(dayNumber(viennaDate(now)) - dayNumber(sunday))] || "week";
}

/** Karfreitag: die Deko bleibt, aber still - keine Bewegung, kein Gruß, keine Falter, kein Hase. */
export function isQuiet(season: EasterSeason, now: Date = new Date()): boolean {
  return Boolean(season?.data?.quiet) || easterDay(season, now) === "friday";
}

/** Gegrüßt wird am Ostersonntag und am Ostermontag. */
export function greetingDay(season: EasterSeason, now: Date = new Date()): boolean {
  const day = easterDay(season, now);
  return day === "sunday" || day === "monday";
}

/** Die Muster der Reihe: `count` verschiedene aus zwölf, je Saat gemischt. */
export function rowPatterns(seed: number, count = 5): EggPattern[] {
  const rng = mulberry32(seed >>> 0);
  const list = [...EGG_PATTERNS];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, count);
}

/** Wie viele Eier an der Begrüßungskarte liegen: auf schmalen Geräten vier, sonst fünf. */
export function edgeCount(width: number): number {
  return width < 360 ? 4 : 5;
}

export type Flight = { fromLeft: boolean; y: number; seconds: number; bob: number; size: number };

/** Ein Flug des Zitronenfalters: Richtung, Höhe (Anteil des Screens), Dauer, Bogen, Größe. */
export function butterflyFlight(rng: () => number): Flight {
  return { fromLeft: rng() < 0.5, y: Math.round((0.22 + rng() * 0.4) * 100) / 100, seconds: Math.round((8 + rng() * 4) * 10) / 10, bob: Math.round(10 + rng() * 16), size: Math.round(22 + rng() * 6) };
}

/** Takte in Sekunden: der erste bald, dann lange Pausen; am Handy guckt der Hase seltener als im Web. */
export const BUTTERFLY_FIRST: [number, number] = [20, 40];
export const BUTTERFLY_EVERY: [number, number] = [120, 180];
export const PEEK_FIRST: [number, number] = [90, 150];
export const PEEK_EVERY: [number, number] = [480, 900];

export function nextDelay(rng: () => number, [min, max]: [number, number]): number {
  return Math.round((min + rng() * (max - min)) * 1000);
}

export type Rect = { x: number; y: number; width: number; height: number };
export const PEEK_BOX = { width: 26, height: 30 };

/**
 * Wo der Hase guckt (Fensterkoordinaten der Ohren-Box, ihre Unterkante auf der Oberkante einer Karte): die erste Karte,
 * deren Oberkante frei im Bild ist - unter dem Kopf (`top`), über der Tab-Leiste (`bottom`), breit genug.
 */
export function peekSpot(rects: Rect[], { top, bottom }: { top: number; bottom: number }): { x: number; y: number } | null {
  for (const rect of [...rects].sort((a, b) => a.y - b.y)) {
    if (rect.width < 140 || rect.y < top + PEEK_BOX.height + 8 || rect.y > bottom - 60) continue;
    return { x: Math.round(rect.x + rect.width * 0.78 - PEEK_BOX.width / 2), y: Math.round(rect.y - PEEK_BOX.height) };
  }
  return null;
}

/** Wie viele Blütenblätter ein Screen bekommt: lebendige vier (bei „voll“ sechs), mittlere zwei, sonst keine. */
export function petalCount(screen: string, effective: string): number {
  const fx = effectClasses(screenClass(screen), effective);
  if (fx.subtle || fx.ambient === "none") return 0;
  if (fx.ambient === "near") return fx.full ? 6 : 4;
  return fx.full ? 3 : 2;
}

export type Petal = { x: number; y: number; r: number; fall: number; amp: number; freq: number; phase: number; angle: number; spin: number; flip: number; color: number; t: number };
export const PETAL_COLORS = ["#f3a6ba", "#fbd3de", "#fff3ee", "#f6d462"];

/** Ein Blatt: irgendwo in der Breite, über dem Screen (am Anfang irgendwo darin). `rng` liefert 0…1. */
export function createPetal(rng: () => number, width: number, height: number, anywhere = false): Petal {
  "worklet";
  return {
    x: rng() * width,
    y: anywhere ? rng() * height : -20 - rng() * height * 0.5,
    r: 4.4 + rng() * 3,
    fall: 12 + rng() * 12,
    amp: 14 + rng() * 22,
    freq: 0.35 + rng() * 0.35,
    phase: rng() * Math.PI * 2,
    angle: rng() * Math.PI * 2,
    spin: (rng() - 0.5) * 1.6,
    flip: 1.2 + rng() * 1.6,
    color: Math.floor(rng() * PETAL_COLORS.length),
    t: 0,
  };
}

/** Ein Schritt (Sekunden) mit Verschiebung durch Scrollen (`shift` Pixel): sinken, drehen; unten raus → oben neu. */
export function stepPetal(petal: Petal, dt: number, shift: number, width: number, height: number, rng: () => number): Petal {
  "worklet";
  const y = petal.y + petal.fall * dt - shift;
  if (y > height + 24) return createPetal(rng, width, height);
  return { ...petal, t: petal.t + dt, y, angle: petal.angle + petal.spin * dt };
}

/** Wo das Blatt gezeichnet wird: die Mitte pendelt, die Breite taumelt. */
export function petalPose(petal: Petal): { x: number; y: number; squash: number } {
  "worklet";
  return { x: petal.x + Math.sin(petal.t * petal.freq * Math.PI * 2 + petal.phase) * petal.amp, y: petal.y, squash: 0.5 + 0.5 * Math.abs(Math.sin(petal.t * petal.flip + petal.phase)) };
}
