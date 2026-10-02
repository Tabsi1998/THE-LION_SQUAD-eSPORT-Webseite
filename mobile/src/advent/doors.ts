import { mulberry32 } from "../seasons/rng";

// Adventkalender in der App (#641, #732, #642): dieselbe Rechnung wie im Web (frontend/src/advent/doors.js). Form,
// Scharnier, Licht, Schmuck und Schildchen kommen aus der Saat, die der Server je Jahr und Türchen liefert - Web und
// App zeigen damit dasselbe Türchen. Ein Test hält die beiden Rechnungen mit festen Werten zusammen.

export const DOORS = 24;
export const SHAPES = ["rect", "arch", "round"] as const;
export const HINGES = ["left", "right", "top", "double"] as const;
export const LIGHTS = [
  { key: "amber", color: "#ffb454", soft: "rgba(255, 180, 84, 0.55)" },
  { key: "candle", color: "#ffd98a", soft: "rgba(255, 217, 138, 0.55)" },
  { key: "rose", color: "#ff9f8c", soft: "rgba(255, 159, 140, 0.5)" },
  { key: "frost", color: "#bfe3ff", soft: "rgba(191, 227, 255, 0.5)" },
  { key: "gold", color: "#f4cf6a", soft: "rgba(244, 207, 106, 0.55)" },
] as const;
export const ORNAMENTS = ["star", "twig", "flake", "bell", "paw", "none"] as const;
export const PLAQUES = ["tl", "tr", "bl", "br", "center"] as const;

export type Shape = (typeof SHAPES)[number];
export type Hinge = (typeof HINGES)[number];
export type Light = (typeof LIGHTS)[number];
export type Ornament = (typeof ORNAMENTS)[number];
export type Plaque = (typeof PLAQUES)[number];
export type DoorVariant = { shape: Shape; hinge: Hinge; light: Light; ornament: Ornament; plaque: Plaque; inset: number; tilt: number; angle: number; swing: number; pulse: number; delay: number };
export type Cell = { col: number; row: number };

export type DoorContent = {
  kind: string;
  title: string;
  body?: string;
  media_url?: string | null;
  link?: { url: string; label?: string } | null;
  fallback?: boolean;
  video?: { id?: string; url?: string } | null;
  clip?: { id?: string; url?: string } | null;
  sticker?: { id?: string; name?: string; url?: string; width?: number | null; height?: number | null } | null;
  card?: { title?: string; name?: string; role?: string; excerpt?: string; image_url?: string | null; url?: string | null; date?: string | null; location?: string } | null;
  quiz?: { question: string; answers: string[]; done?: boolean } | null;
  prize?: PrizeState | null;
};
export type PrizeState = {
  label: string; value?: string; winners: number; audience: string; closes_at?: string | null; status: "open" | "closed" | "drawn";
  entries: number; entered: boolean; can_enter: boolean; can_withdraw: boolean; won: boolean; hint?: string | null; terms?: string[];
};
export type Door = { day: number; opens_at: string; seed: number; state: "locked" | "available" | "opened"; content?: DoorContent; opened_at?: string | null };
export type Calendar = {
  active: boolean; year?: number; order?: number[]; doors?: Door[]; catch_up?: boolean; newest_door?: number | null; door_hour?: number;
  opened?: number; total?: number; signed_in?: boolean; ends_at?: string; next_start?: string | null; reason?: string;
};

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}

/** Die Eigenheiten eines Türchens aus seiner Saat. Runde Türchen haben nie ein Scharnier oben oder zwei Flügel. */
export function doorVariant(seed: number | string): DoorVariant {
  const rng = mulberry32(Number(seed) >>> 0);
  const shape = pick(rng, SHAPES);
  const hinge = pick(rng, shape === "round" ? (["left", "right"] as const) : HINGES);
  const light = pick(rng, LIGHTS);
  const ornament = pick(rng, ORNAMENTS);
  const plaque = shape === "round" ? "center" : pick(rng, PLAQUES);
  return {
    shape,
    hinge,
    light,
    ornament,
    plaque,
    inset: Math.round((0.085 + rng() * 0.05) * 1000) / 1000,
    tilt: Math.round((rng() * 3 - 1.5) * 10) / 10,
    // Der Flügel steht etwa im rechten Winkel offen - weiter aufgeschlagen läge er über dem Nachbarn.
    angle: Math.round(90 + rng() * 8),
    swing: Math.round(760 + rng() * 280),
    pulse: Math.round((3.4 + rng() * 2.6) * 10) / 10,
    delay: Math.round(rng() * 30) / 10,
  };
}

/** Spalten je Breite des Kalenders: 3 am Handy, 4 am kleinen Tablet, 6 am großen - immer 24 Türchen ohne Rest. */
export function columnsFor(width: number): number {
  if (!(width > 0)) return 3;
  if (width < 560) return 3;
  if (width < 900) return 4;
  return 6;
}

/** Die Reihenfolge der Türchen: die des Servers, wenn sie stimmt - sonst 1 bis 24. */
export function doorOrder(order: unknown): number[] {
  const days = Array.isArray(order) ? order.map(Number) : [];
  const valid = days.length === DOORS && new Set(days).size === DOORS && days.every((day) => Number.isInteger(day) && day >= 1 && day <= DOORS);
  return valid ? days : Array.from({ length: DOORS }, (_, index) => index + 1);
}

export function cellOf(index: number, columns: number): Cell {
  return { col: index % columns, row: Math.floor(index / columns) };
}

/**
 * Das Scharnier an diesem Platz: am Rand des Kalenders schlägt kein Flügel nach außen über den Rahmen -
 * ganz links öffnet das Türchen nach rechts, ganz rechts nach links, in der obersten Reihe nie nach oben.
 */
export function hingeAt(hinge: Hinge, cell: Cell, columns: number): Hinge {
  const first = cell.col === 0;
  const last = cell.col === columns - 1;
  if (hinge === "top" && cell.row === 0) return first ? "right" : "left";
  if ((hinge === "left" || hinge === "double") && first) return "right";
  if ((hinge === "right" || hinge === "double") && last) return "left";
  return hinge;
}

const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

/** Letzter Sonntag eines Monats um 01:00 UTC - dann stellt Europa die Uhr um. */
function lastSunday(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0, 1, 0, 0));
  return last.getTime() - last.getUTCDay() * 86400000;
}

/**
 * Die Uhr in Wien zu einem Augenblick - nach der Regel gerechnet (Sommerzeit vom letzten Sonntag im März bis zum
 * letzten im Oktober), weil `Intl` mit Zeitzonen nicht auf jedem Gerät da ist.
 */
export function viennaParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const time = date.getTime();
  const year = date.getUTCFullYear();
  const summer = time >= lastSunday(year, 2) && time < lastSunday(year, 9);
  const local = new Date(time + (summer ? 2 : 1) * 3600000);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(), hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/** „5. Dezember, 6 Uhr“ - nach der Uhr in Wien, egal wo das Gerät steht. */
export function opensLabel(iso: string | null | undefined): string {
  const date = new Date(iso || "");
  if (Number.isNaN(date.getTime())) return "";
  const parts = viennaParts(date);
  const minute = parts.minute === 0 ? "" : `:${String(parts.minute).padStart(2, "0")}`;
  return `${parts.day}. ${MONTHS[parts.month - 1]}, ${parts.hour}${minute} Uhr`;
}

/** „19. Dezember 2026“ - der Tag nach der Uhr in Wien. */
export function dayLabel(iso: string | null | undefined): string {
  const date = new Date(iso || "");
  if (Number.isNaN(date.getTime())) return "";
  const parts = viennaParts(date);
  return `${parts.day}. ${MONTHS[parts.month - 1]} ${parts.year}`;
}

/** Was ein Türchen sagt, wenn es vorgelesen wird. */
export function doorLabel(door: Pick<Door, "day" | "state" | "opens_at" | "content">, { today = false }: { today?: boolean } = {}): string {
  if (door.state === "locked") return `Türchen ${door.day} – öffnet sich am ${opensLabel(door.opens_at)}`;
  if (door.state === "opened") return `Türchen ${door.day} – geöffnet${door.content?.title ? `: ${door.content.title}` : ""}`;
  return `Türchen ${door.day} öffnen${today ? " – das heutige" : ""}`;
}
