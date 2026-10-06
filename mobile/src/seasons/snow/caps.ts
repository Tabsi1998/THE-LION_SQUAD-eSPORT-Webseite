import { hashString, mulberry32 } from "../rng";

// Schneehauben in der App (W3, #729; Entscheidung A vom 3.10.: nur im Kopf des Dashboards): dieselbe Rechnung wie im
// Web (`frontend/src/seasons/snow/caps.js`) - Kontur aus dem Jahres-Seed, Dicke je Stufe (1 bis 10.12., 2 bis 24.12.,
// dann 3), bei Plusgraden taut es, ab Stufe 2 hängen Zapfen. Die Haube liegt über der Oberkante der Karte und
// verschiebt nichts; was sie trägt, entscheidet der Screen (die Hero-Karte hat oben Luft, dort liegt nichts).

/** Dicke je Stufe (px) und wie weit die Haube über die Kante nach unten hängt. */
export const THICKNESS: Record<number, number> = { 1: 4, 2: 6.5, 3: 9 };
export const OVERHANG = 1.6;

/** Die wirksame Stufe: Plusgrade tauen - über 3 °C eine Stufe weniger, über 0,5 °C eine halbe; nie unter 0,5. */
export function capLevel({ stage = 1, tempC = null }: { stage?: number | null; tempC?: number | null } = {}): number {
  const base = Math.max(1, Math.min(3, Number(stage) || 1));
  const temp = Number(tempC);
  if (tempC === null || tempC === undefined || !Number.isFinite(temp)) return base;
  if (temp > 3) return Math.max(0.5, base - 1);
  if (temp > 0.5) return Math.max(0.5, base - 0.5);
  return base;
}

/** Dicke aus Stufe (auch halbe) und dem eigenen Wachstum der Kante. */
export function capThickness(level: number, growth = 1): number {
  if (level < 1) return Math.round(THICKNESS[1] * Math.max(0, level) * growth * 10) / 10;
  const lo = Math.floor(level);
  const hi = Math.ceil(level);
  const a = THICKNESS[Math.max(1, lo)] || THICKNESS[1];
  const b = THICKNESS[Math.min(3, hi)] || THICKNESS[3];
  const t = level - lo;
  return Math.round((a + (b - a) * t) * growth * 10) / 10;
}

/** Das eigene Wachstum einer Kante (0,7 bis 1,3) - je Jahr und Kante stabil, so sieht keine Haube aus wie die andere. */
export function capGrowth(seed: string): number {
  const rng = mulberry32(hashString(`snowcap:${seed}`));
  return Math.round((0.7 + rng() * 0.6) * 100) / 100;
}

export type CapShape = { d: string; height: number; base: number };

/**
 * Die Kontur einer Haube als SVG-Pfad in eigenen Koordinaten: x von 0 bis `width`, die Kante bei y = `thickness`,
 * der Schnee darüber (y kleiner) mit weichen Buckeln aus dem Seed, an den Enden auslaufend, unten mit leichtem
 * Überhang; ab Stufe 2 hängen ein, zwei kleine Zapfen herunter.
 */
export function capPath({ width, thickness, seed = "cap", level = 1 }: { width: number; thickness: number; seed?: string; level?: number }): CapShape {
  const rng = mulberry32(hashString(`snowcap:${seed}`));
  const w = Math.max(8, width);
  const t = Math.max(1, thickness);
  const base = t + OVERHANG;
  const step = 16 + rng() * 14;
  const points: Array<{ x: number; y: number }> = [];
  for (let x = 0; x <= w; x += step) {
    const edge = Math.min(1, Math.min(x, w - x) / (w * 0.18 + 1));
    const height = t * (0.55 + rng() * 0.45) * edge;
    points.push({ x: Math.min(w, x), y: base - height });
  }
  if (points[points.length - 1].x < w) points.push({ x: w, y: base - 0.2 });
  points[0].y = base - 0.2;
  let d = `M 0 ${base.toFixed(1)} L ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const cx = (prev.x + next.x) / 2;
    d += ` Q ${((prev.x + cx) / 2).toFixed(1)} ${prev.y.toFixed(1)} ${cx.toFixed(1)} ${((prev.y + next.y) / 2).toFixed(1)}`;
    d += ` Q ${((cx + next.x) / 2).toFixed(1)} ${next.y.toFixed(1)} ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }
  d += ` L ${w.toFixed(1)} ${base.toFixed(1)}`;
  // Unterkante mit Überhang und Zapfen (ab Stufe 2): von rechts nach links zurück.
  const drips = level >= 2 ? 1 + Math.floor(rng() * 2) : 0;
  const dripAt = Array.from({ length: drips }, () => w * (0.15 + rng() * 0.7)).sort((a, b) => b - a);
  dripAt.forEach((dx) => {
    const len = 2.5 + rng() * (level >= 3 ? 5 : 3);
    d += ` L ${(dx + 2.2).toFixed(1)} ${(base + 0.3).toFixed(1)} Q ${(dx + 0.9).toFixed(1)} ${(base + len * 0.55).toFixed(1)} ${dx.toFixed(1)} ${(base + len).toFixed(1)} Q ${(dx - 0.9).toFixed(1)} ${(base + len * 0.55).toFixed(1)} ${(dx - 2.2).toFixed(1)} ${(base + 0.3).toFixed(1)}`;
  });
  d += ` L 0 ${(base + 0.3).toFixed(1)} Z`;
  return { d, height: base + (drips ? 8.5 : 0.5), base };
}
