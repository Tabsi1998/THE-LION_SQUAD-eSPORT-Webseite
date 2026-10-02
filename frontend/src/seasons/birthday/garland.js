// Girlanden zum Vereinsgeburtstag (B2 #750): Wimpelketten in Vereinsfarben, die unter der Kopfzeile durchhängen - auf
// breiten Schirmen im Rand neben dem Inhalt, sonst in den oberen Ecken. Wie tief sie hängen, entscheidet die Seite:
// nie über Schrift, Bildern oder Bedienelementen (index.jsx probiert flacher, bevor es eine weglässt). Länge, Tiefe,
// Zahl der Wimpel und Farbfolge kommen aus Jahr und Seite. Reine Rechnung.
import { seasonRng } from "../rng";

export const PENNANT_COLORS = ["#29B6E8", "#FFD700", "#f7f4ee"];
/** Probiert von tief nach flach - so tief wie möglich, aber nie über Inhalt. */
export const SAGS = [36, 28, 20, 13];
export const MAX_SPAN = 260;
/** Luft rundum im Kasten einer Kette (Wimpel, die schwingen). */
export const GARLAND_PAD = 8;
const WIDE_MARGIN = 140;

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Je Seite eine Kette: Anteil der Breite, Zahl der Wimpel, Farbe, mit der sie beginnt, Größe und Schwingen. */
export function garlandPlan(year, route = "/") {
  const rng = seasonRng({ season: "club_birthday", year, route }, "garland");
  return ["left", "right"].map((side) => ({
    side,
    share: round(0.72 + rng() * 0.24, 2),
    count: 7 + Math.floor(rng() * 4),
    firstColor: Math.floor(rng() * PENNANT_COLORS.length),
    size: round(12 + rng() * 3),
    sway: round(5 + rng() * 3),
    delay: Math.round(rng() * 400),
  }));
}

/**
 * Wo eine Kette hängt (Fensterkoordinaten, ohne Tiefe): auf breiten Schirmen im Rand neben der Spalte des Inhalts,
 * sonst in der Ecke über ein Viertel bis Drittel der Breite.
 */
export function garlandSpan(chain, width, column = null) {
  const wide = column && column.left >= WIDE_MARGIN;
  if (wide) {
    const room = Math.min(MAX_SPAN, (column.left - 24) * chain.share);
    return chain.side === "left" ? { x0: round(column.left - 12 - room), x1: round(column.left - 12) } : { x0: round(column.right + 12), x1: round(column.right + 12 + room) };
  }
  // Abstand zum Fensterrand: der Kasten der Kette (GARLAND_PAD rundum) bleibt in der Seite - sonst scrollte sie seitlich.
  const edge = GARLAND_PAD + 2;
  const room = Math.min(MAX_SPAN, width * (0.22 + 0.12 * chain.share));
  return chain.side === "left" ? { x0: edge, x1: round(edge + room) } : { x0: round(width - edge - room), x1: round(width - edge) };
}

/** Der Faden: eine Parabel von (x0, y) nach (x1, y), in der Mitte `sag` tief - als SVG-Pfad und als Rechnung. */
export function stringPath(x0, x1, y, sag) {
  return `M ${round(x0)} ${round(y)} Q ${round((x0 + x1) / 2)} ${round(y + 2 * sag)} ${round(x1)} ${round(y)}`;
}

export function stringY(x0, x1, y, sag, x) {
  const t = (x - x0) / (x1 - x0);
  return y + 4 * sag * t * (1 - t);
}

/** Die Wimpel: gleichmäßig am Faden, jeder so gedreht, wie der Faden dort verläuft; Farben im Wechsel. */
export function pennants(chain, x0, x1, y, sag) {
  return Array.from({ length: chain.count }, (_, index) => {
    const t = (index + 0.5) / chain.count;
    const x = x0 + (x1 - x0) * t;
    const slope = (4 * sag * (1 - 2 * t)) / (x1 - x0);
    return {
      index,
      x: round(x),
      y: round(stringY(x0, x1, y, sag, x)),
      angle: round((Math.atan(slope) * 180) / Math.PI),
      color: PENNANT_COLORS[(chain.firstColor + index) % PENNANT_COLORS.length],
    };
  });
}

/**
 * Die Punkte, an denen nachgesehen wird, ob unter der Kette Platz ist: Faden, Wimpelspitzen und die unteren Ecken des
 * Kastens, den die Kette einnimmt (`GARLAND_PAD` rundum) - auch dort darf nichts Lesbares liegen.
 */
export function probePoints(chain, x0, x1, y, sag) {
  const points = pennants(chain, x0, x1, y, sag).map((pennant) => ({ x: pennant.x, y: pennant.y + chain.size + 3 }));
  for (let x = x0 + 6; x < x1 - 6; x += 18) points.push({ x: round(x), y: round(stringY(x0, x1, y, sag, x) + 2) });
  const bottom = round(y + sag + chain.size + GARLAND_PAD);
  points.push({ x: round(x0 - GARLAND_PAD + 2), y: bottom }, { x: round(x1 + GARLAND_PAD - 2), y: bottom });
  return points;
}
