// Die Jahreszahl um 00:00 (#853): je Ziffer eine Rakete; ihre Funken fliegen beim Zerplatzen in die Form der Ziffer,
// stehen kurz als Zahl am Himmel und rieseln dann herab. Reine Rechnung ohne Browser, gleich in der App
// (mobile/src/seasons/newYear/yearDigits.ts, Paritätstest auf beiden Seiten): eine Strichschrift im Kasten 0,6 × 1,
// gleichmäßig mit Punkten belegt, Platz und Größe nach dem Fenster, Bahnen geschlossen gerechnet.

/** Breite einer Ziffer (Höhe 1) und Abstand der Ziffermitten. */
export const GLYPH_WIDTH = 0.6;
export const GLYPH_PITCH = 0.82;
/** Unter der Gruß-Karte bleiben: so viel Platz (px) hält die Zahl oben frei. */
export const YEAR_CLEAR_TOP = 240;
/** Ablauf je Ziffer nach dem Zerplatzen (s): Funken fliegen in die Form, die Zahl steht, rieselt gestaffelt herab. */
export const YEAR_FORM = 0.7;
export const YEAR_HOLD = 2.6;
export const YEAR_TRICKLE = 0.7;
export const YEAR_FALL = 2.6;
export const YEAR_RISE = 1.35;
/** Die Ziffern steigen kurz nacheinander (ms), die gewohnte Salve folgt, sobald die Zahl zu rieseln beginnt. */
export const YEAR_STAGGER_MS = 160;
export const YEAR_SALVO_DELAY_MS = 4600;
/** Funken der ganzen Zahl: ein Teil des Budgets, damit sie lesbar bleibt, aber das Bild nicht sprengt. */
export const YEAR_STARS = { min: 72, max: 150, share: 0.75 };

function round1(value) {
  return Math.round(value * 10) / 10;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function arc(cx, cy, rx, ry, from, to, steps) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

const PI = Math.PI;
const SIX = [[...arc(0.52, 0.56, 0.46, 0.52, -PI / 2 - 0.15, -PI, 10), ...arc(0.31, 0.73, 0.26, 0.25, PI, -PI + 0.25, 28)]];

/** Die Striche je Ziffer (y nach unten): Bögen und Linien, die man auch aus Funken noch lesen kann. */
export const DIGIT_STROKES = {
  0: [arc(0.3, 0.5, 0.28, 0.48, -PI / 2, (3 * PI) / 2, 32)],
  1: [[[0.1, 0.2], [0.34, 0.02], [0.34, 0.98]]],
  2: [[...arc(0.3, 0.28, 0.27, 0.26, PI, 2 * PI + 0.55, 18), [0.03, 0.98], [0.59, 0.98]]],
  3: [[...arc(0.3, 0.26, 0.25, 0.24, PI + 0.45, 2.5 * PI + 0.25, 16), ...arc(0.3, 0.74, 0.28, 0.25, 1.5 * PI - 0.25, 2.5 * PI + 0.95, 18)]],
  4: [[[0.45, 0.98], [0.45, 0.02], [0.02, 0.7], [0.6, 0.7]]],
  5: [[[0.55, 0.02], [0.12, 0.02], [0.09, 0.47], ...arc(0.3, 0.69, 0.28, 0.29, 1.5 * PI - 0.75, 2.5 * PI + 0.95, 18)]],
  6: SIX,
  7: [[[0.02, 0.02], [0.58, 0.02], [0.22, 0.98]]],
  // Beide Schleifen beginnen fern vom Knoten - sonst lägen dort zwei Funken aufeinander.
  8: [arc(0.3, 0.26, 0.22, 0.24, -PI / 2, 1.5 * PI, 24), arc(0.3, 0.75, 0.27, 0.25, PI / 2, 2.5 * PI, 26)],
  9: SIX.map((stroke) => stroke.map(([x, y]) => [GLYPH_WIDTH - x, 1 - y])),
};

function strokeLength(stroke) {
  let length = 0;
  for (let i = 1; i < stroke.length; i += 1) length += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
  return length;
}

/** Wie lang die Striche einer Ziffer sind (Einheiten der Höhe) - danach richtet sich, wie viele Funken sie bekommt. */
export function glyphLength(digit) {
  return (DIGIT_STROKES[digit] || []).reduce((sum, stroke) => sum + strokeLength(stroke), 0);
}

/** Der Punkt im Abstand `at` entlang eines Strichs. */
function pointAlong(stroke, at) {
  let rest = at;
  for (let i = 1; i < stroke.length; i += 1) {
    const [x0, y0] = stroke[i - 1];
    const [x1, y1] = stroke[i];
    const piece = Math.hypot(x1 - x0, y1 - y0);
    if (rest <= piece || i === stroke.length - 1) {
      const t = piece > 0 ? Math.min(1, rest / piece) : 0;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    rest -= piece;
  }
  return stroke[0];
}

/**
 * `count` Punkte gleichmäßig auf den Strichen einer Ziffer, bezogen auf ihre Mitte (Einheiten der Höhe). Geschlossene
 * Striche (0, 8) ohne doppelten Punkt am Stoß, offene mit beiden Enden.
 */
export function glyphPoints(digit, count) {
  const strokes = DIGIT_STROKES[digit] || [];
  const total = glyphLength(digit);
  if (!strokes.length || total <= 0 || count <= 0) return [];
  const out = [];
  for (const stroke of strokes) {
    const length = strokeLength(stroke);
    const first = stroke[0];
    const last = stroke[stroke.length - 1];
    const closed = Math.hypot(last[0] - first[0], last[1] - first[1]) < 1e-6;
    const n = Math.max(2, Math.round((count * length) / total));
    for (let i = 0; i < n; i += 1) {
      const at = closed ? (length * i) / n : (length * i) / (n - 1);
      const [x, y] = pointAlong(stroke, at);
      out.push([round3(x - GLYPH_WIDTH / 2), round3(y - 0.5)]);
    }
  }
  return out;
}

/** Nur die Ziffern einer Jahreszahl (höchstens vier) - ohne Zahl keine Salve. */
export function yearText(year) {
  return String(year ?? "").replace(/[^0-9]/g, "").slice(0, 4);
}

/** Funken für die ganze Zahl bei diesem Budget. */
export function yearStarCount(cap) {
  return Math.max(YEAR_STARS.min, Math.min(YEAR_STARS.max, Math.round((Number(cap) || 0) * YEAR_STARS.share)));
}

/** Wie viele Funken jede Ziffer bekommt: nach der Länge ihrer Striche, damit alle gleich dicht stehen. */
export function glyphCounts(text, total) {
  const lengths = Array.from(text).map((digit) => glyphLength(digit));
  const sum = lengths.reduce((a, b) => a + b, 0) || 1;
  return lengths.map((length) => Math.max(10, Math.round((total * length) / sum)));
}

/** Ab dieser Fensterbreite steht die Zahl rechts der Mitte - zwischen dem Text links und dem Löwen rechts. */
export const WIDE_FROM = 1024;
export const WIDE_CENTER = 0.57;

/**
 * Wo eine Ziffer steht (px), unter der Gruß-Karte. `slot` ist der Platz in der Zahl, `slots` ihre Länge. Abnahme
 * Silvester (#744): die Zahl darf nicht über dem Text der Startseite stehen - am PC (ab 1024 px) steht sie bei 57 %
 * der Breite zwischen Text und Löwe, 14 % hoch und höchstens halb so breit wie das Fenster; am Handy unter dem Text
 * bei 55 % der Höhe, 11,5 % hoch und höchstens 80 % breit.
 */
export function glyphSpot(slot, slots, size) {
  const n = Math.max(1, Number(slots) || 1);
  const span = GLYPH_WIDTH + (n - 1) * GLYPH_PITCH;
  const wide = size.width >= WIDE_FROM;
  const height = Math.max(40, Math.min(size.height * (wide ? 0.14 : 0.115), (size.width * (wide ? 0.5 : 0.8)) / span));
  const y = Math.max(size.height * (wide ? 0.42 : 0.55), YEAR_CLEAR_TOP + height / 2);
  const center = wide ? size.width * WIDE_CENTER : size.width / 2;
  const x = center + ((Number(slot) || 0) - (n - 1) / 2) * GLYPH_PITCH * height;
  return { x: round1(x), y: round1(y), height: round1(height) };
}

/** Ist das eine Rakete der Jahreszahl? */
export function isGlyph(launch) {
  return typeof launch?.glyph === "string" && launch.glyph.length === 1;
}

/**
 * Die Raketen der Jahreszahl um `at` (ms, Serverzeit): je Ziffer eine, kurz nacheinander, gold mit weißen Funken. Ihr
 * Platz kommt erst beim Zeichnen aus dem Fenster (`glyphSpot`).
 */
export function yearLaunches(year, at) {
  const text = yearText(year);
  return Array.from(text).map((glyph, slot) => ({
    id: `salvo:year:${slot}`,
    at: at + slot * YEAR_STAGGER_MS,
    type: "peony",
    caliber: "large",
    glyph,
    text,
    slot,
    slots: text.length,
    x: 0.5,
    distance: 0.1,
    colors: ["gold", "white"],
    burstY: 0.42,
    rise: YEAR_RISE,
    drift: 0,
    pattern: "year",
  }));
}

/**
 * Die Funken einer Ziffer: Ziel auf dem Strich (px ab der Mitte), Größe, Farbe, Funkeln, wann sie zu rieseln beginnt
 * und wohin sie dabei leicht treibt. `total` sind die Funken der ganzen Zahl (`yearStarCount`).
 */
export function yearStars(launch, rng, size, total = YEAR_STARS.max) {
  const spot = glyphSpot(launch.slot, launch.slots, size);
  const counts = glyphCounts(launch.text || launch.glyph, total);
  const points = glyphPoints(launch.glyph, counts[launch.slot] || counts[0] || 0);
  const grain = Math.max(0.75, Math.min(1.2, Math.sqrt(spot.height / 150)));
  const pick = (min, max) => min + rng() * (max - min);
  return points.map(([ux, uy]) => ({
    tx: round1(ux * spot.height),
    ty: round1(uy * spot.height),
    size: round2(2 * grain * pick(0.85, 1.15)),
    color: rng() < 0.22 ? launch.colors[1] : launch.colors[0],
    glitter: round2(pick(0, Math.PI * 2)),
    fall: round2(pick(0, YEAR_TRICKLE)),
    vx: round2(pick(-10, 10)),
  }));
}

/**
 * Wo ein Funke der Zahl nach `age` Sekunden (seit dem Zerplatzen) steht: fliegt gebremst in seine Form, steht dort
 * (sinkt kaum, treibt leicht mit dem Wind) und rieselt danach mit Luftwiderstand und Schwerkraft herab.
 */
export function yearStarAt(star, age, origin, wind = 0) {
  if (age < YEAR_FORM) {
    const p = 1 - (1 - Math.max(0, age) / YEAR_FORM) ** 3;
    return { x: round1(origin.x + star.tx * p), y: round1(origin.y + star.ty * p) };
  }
  const held = age - YEAR_FORM;
  const x = origin.x + star.tx + wind * held * 0.15;
  const y = origin.y + star.ty + 3 * held;
  const falling = held - YEAR_HOLD - star.fall;
  if (falling <= 0) return { x: round1(x), y: round1(y) };
  const k = 1.1;
  const decay = (1 - Math.exp(-k * falling)) / k;
  const terminal = 46 / k;
  return { x: round1(x + star.vx * decay + wind * falling * 0.6), y: round1(y + terminal * falling - terminal * decay) };
}

/** Wie hell ein Funke der Zahl ist: Blitz beim Zerplatzen, ruhiges Funkeln im Stehen, beim Rieseln Glut und aus. */
export function yearStarLight(star, age) {
  if (age < 0) return { alpha: 0, ember: 0 };
  const falling = age - YEAR_FORM - YEAR_HOLD - star.fall;
  if (falling >= YEAR_FALL) return { alpha: 0, ember: 0 };
  let alpha = age < 0.08 ? 1 : 0.95;
  let ember = 0;
  if (falling > 0) {
    const q = falling / YEAR_FALL;
    alpha *= (1 - q) ** 1.2 * (0.6 + 0.4 * Math.abs(Math.sin(age * 30 + star.glitter)));
    ember = Math.min(1, q / 0.6);
  } else if (age >= YEAR_FORM) {
    alpha *= 0.82 + 0.18 * Math.abs(Math.sin(age * 9 + star.glitter));
  }
  return { alpha: round3(alpha), ember: round3(ember) };
}

/** So lange ist eine Ziffer-Rakete zu sehen: Aufstieg, Form, Stehen, Rieseln. */
export function yearDuration(launch) {
  return round2(launch.rise + YEAR_FORM + YEAR_HOLD + YEAR_TRICKLE + YEAR_FALL + 0.2);
}

/** Die ruhige Zahl (dezent, Bewegung reduzieren): dieselben Punkte, fertig geformt, ohne Rakete. */
export function calmYearDots(year, size, total = 120) {
  const text = yearText(year);
  const counts = glyphCounts(text, total);
  return Array.from(text).flatMap((digit, slot) => {
    const spot = glyphSpot(slot, text.length, size);
    return glyphPoints(digit, counts[slot]).map(([ux, uy], i) => ({ x: round1(spot.x + ux * spot.height), y: round1(spot.y + uy * spot.height), white: (slot * 7 + i) % 5 === 0 }));
  });
}
