import { mulberry32 } from "@/seasons/rng";

// Adventkalender (#641, #732): jedes Türchen ist anders - Form, Scharnier, Licht, Schmuck und die Lage des
// Schildchens kommen aus der Saat, die der Server je Jahr und Türchen liefert. Ein Neuladen ändert nichts,
// das nächste Jahr würfelt neu, und die App rechnet mit derselben Saat dasselbe aus.

export const DOORS = 24;
export const SHAPES = ["rect", "arch", "round"];
export const HINGES = ["left", "right", "top", "double"];
export const LIGHTS = [
  { key: "amber", color: "#ffb454", soft: "rgba(255, 180, 84, 0.55)" },
  { key: "candle", color: "#ffd98a", soft: "rgba(255, 217, 138, 0.55)" },
  { key: "rose", color: "#ff9f8c", soft: "rgba(255, 159, 140, 0.5)" },
  { key: "frost", color: "#bfe3ff", soft: "rgba(191, 227, 255, 0.5)" },
  { key: "gold", color: "#f4cf6a", soft: "rgba(244, 207, 106, 0.55)" },
];
export const ORNAMENTS = ["star", "twig", "flake", "bell", "paw", "none"];
export const PLAQUES = ["tl", "tr", "bl", "br", "center"];

function pick(rng, items) {
  return items[Math.floor(rng() * items.length) % items.length];
}

/** Die Eigenheiten eines Türchens aus seiner Saat. Runde Türchen haben nie ein Scharnier oben oder zwei Flügel. */
export function doorVariant(seed) {
  const rng = mulberry32(Number(seed) >>> 0);
  const shape = pick(rng, SHAPES);
  const hinge = pick(rng, shape === "round" ? ["left", "right"] : HINGES);
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

/** Spalten je Breite des Kalenders: 3 am Handy, 4 am Tablet, 6 am PC - immer 24 Türchen ohne Rest. */
export function columnsFor(width) {
  if (!(width > 0)) return 6;
  if (width < 560) return 3;
  if (width < 900) return 4;
  return 6;
}

/** Die Reihenfolge der Türchen: die des Servers, wenn sie stimmt - sonst 1 bis 24. */
export function doorOrder(order) {
  const days = Array.isArray(order) ? order.map(Number) : [];
  const valid = days.length === DOORS && new Set(days).size === DOORS && days.every((day) => Number.isInteger(day) && day >= 1 && day <= DOORS);
  return valid ? days : Array.from({ length: DOORS }, (_, index) => index + 1);
}

/** Spalte und Zeile eines Platzes im Raster. */
export function cellOf(index, columns) {
  return { col: index % columns, row: Math.floor(index / columns) };
}

/**
 * Das Scharnier an diesem Platz: am Rand des Kalenders schlägt kein Flügel nach außen über den Rahmen -
 * ganz links öffnet das Türchen nach rechts, ganz rechts nach links, in der obersten Reihe nie nach oben.
 */
export function hingeAt(hinge, cell, columns) {
  const first = cell.col === 0;
  const last = cell.col === columns - 1;
  if (hinge === "top" && cell.row === 0) return first ? "right" : "left";
  if ((hinge === "left" || hinge === "double") && first) return "right";
  if ((hinge === "right" || hinge === "double") && last) return "left";
  return hinge;
}

const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const VIENNA_PARTS = new Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", day: "numeric", month: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h23" });

/** „5. Dezember, 6 Uhr“ - nach der Uhr in Wien, egal wo das Gerät steht. */
export function opensLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(VIENNA_PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  const minute = parts.minute === "00" ? "" : `:${parts.minute}`;
  return `${Number(parts.day)}. ${MONTHS[Number(parts.month) - 1]}, ${Number(parts.hour)}${minute} Uhr`;
}

/** Was ein Türchen sagt, wenn man es vorliest oder darüber fährt. */
export function doorLabel(door, { today = false } = {}) {
  if (door.state === "locked") return `Türchen ${door.day} – öffnet sich am ${opensLabel(door.opens_at)}`;
  if (door.state === "opened") return `Türchen ${door.day} – geöffnet${door.content?.title ? `: ${door.content.title}` : ""}`;
  return `Türchen ${door.day} öffnen${today ? " – das heutige" : ""}`;
}
