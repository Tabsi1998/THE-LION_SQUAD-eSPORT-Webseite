import { BlendMode, BlurStyle, PaintStyle, Skia, TileMode, type SkCanvas, type SkImage } from "@shopify/react-native-skia";
import type { SignatureKind } from "../lib/loewenRang";

// Glanz und vereinfachte Signatur im Profil (#1457), gezeichnet auf dem UI-Thread (Worklet). Die Zeichenfläche ist das
// Quadrat der Rahmen-Grafik. Wenige Elemente: ein Glanzstreifen, der nur über das Metall läuft (die Grafik selbst ist
// die Maske), und höchstens sechs Teilchen - Funken, Glut, Frost oder Blitz.

export type SignatureScene = {
  /** Kantenlänge der Zeichenfläche (= Rahmen-Grafik) in Punkten. */
  size: number;
  /** Mitte und Radius des Fotos in der Zeichenfläche. */
  ringX: number;
  ringY: number;
  ringR: number;
  kind: SignatureKind;
  color: string;
  count: number;
  /** 0 … 1: Level im Rang. */
  strength: number;
  /** Deckkraft des Glanzes (wie `--lvf-shine` im Web). */
  shine: number;
  /** Punkte auf dem Metall, in der Zeichenfläche - dort springen Funken und Blitze. */
  edge: Array<[number, number]>;
};

/** Ein Glanz-Durchgang: 5,5 s, davon 45 % Lauf, wie im Web. */
export const SHINE_CYCLE_S = 5.5;
const SHINE_RUN = 0.45;
// 115° wie `linear-gradient(115deg, …)` im Web: der Streifen läuft nach rechts unten.
const DIR_X = Math.sin((115 * Math.PI) / 180);
const DIR_Y = -Math.cos((115 * Math.PI) / 180);

function noise(seed: number): number {
  "worklet";
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function frac(value: number): number {
  "worklet";
  return value - Math.floor(value);
}

function rgba(hex: string, alpha: number) {
  "worklet";
  const color = Skia.Color(hex);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(color);
  paint.setAlphaf(Math.max(0, Math.min(1, alpha)));
  return paint;
}

/** Glanzstreifen über dem Metall: Grafik in eine Ebene, Streifen nur dort, wo die Grafik deckt (SrcIn). */
function drawShine(canvas: SkCanvas, scene: SignatureScene, t: number, image: SkImage) {
  "worklet";
  const phase = frac(t / SHINE_CYCLE_S);
  if (phase >= SHINE_RUN) return;
  const S = scene.size;
  const travel = S * 1.5;
  const along = -travel / 2 + (phase / SHINE_RUN) * travel;
  const cx = S / 2 + DIR_X * along;
  const cy = S / 2 + DIR_Y * along;
  const half = S * 0.3;
  const glow = Skia.Color("#FFFAE1");
  const clear = Skia.Color("rgba(255,250,225,0)");
  const band = Skia.Paint();
  band.setAntiAlias(true);
  band.setBlendMode(BlendMode.SrcIn);
  band.setAlphaf(Math.max(0, Math.min(1, 0.8 * scene.shine)));
  band.setShader(Skia.Shader.MakeLinearGradient(Skia.Point(cx - DIR_X * half, cy - DIR_Y * half), Skia.Point(cx + DIR_X * half, cy + DIR_Y * half), [clear, glow, clear], [0, 0.5, 1], TileMode.Clamp));
  canvas.saveLayer();
  canvas.drawImageRect(image, Skia.XYWHRect(0, 0, image.width(), image.height()), Skia.XYWHRect(0, 0, S, S), Skia.Paint());
  canvas.drawRect(Skia.XYWHRect(0, 0, S, S), band);
  canvas.restore();
}

/** Ein leuchtender Punkt: weicher Hof und heller Kern. */
function dot(canvas: SkCanvas, x: number, y: number, radius: number, color: string, alpha: number) {
  "worklet";
  if (alpha <= 0.01) return;
  canvas.drawCircle(x, y, radius * 2.6, rgba(color, alpha * 0.22));
  canvas.drawCircle(x, y, radius, rgba(color, alpha));
}

function drawParticles(canvas: SkCanvas, scene: SignatureScene, t: number) {
  "worklet";
  const { count, ringX, ringY, ringR, color, kind, edge } = scene;
  if (count <= 0) return;
  const gain = 0.55 + 0.45 * scene.strength;
  if (kind === "blitz") {
    // Wetterleuchten: der Ring flackert kurz auf, dazu Funken auf dem Metall.
    const beat = frac(t / 2.6);
    const flash = beat < 0.05 ? 1 - beat / 0.05 : beat > 0.1 && beat < 0.13 ? 0.6 : 0;
    if (flash > 0) {
      const ring = rgba(color, flash * 0.75 * gain);
      ring.setStyle(PaintStyle.Stroke);
      ring.setStrokeWidth(Math.max(1.5, ringR * 0.04));
      ring.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 3, true));
      canvas.drawCircle(ringX, ringY, ringR * 1.03, ring);
      const burst = Math.floor(t / 2.6);
      for (let i = 0; i < count && edge.length; i += 1) {
        const [x, y] = edge[Math.floor(noise(burst * 31 + i) * edge.length) % edge.length];
        dot(canvas, x, y, 1.6, "#FFFFFF", flash * gain);
      }
    }
    return;
  }
  for (let i = 0; i < count; i += 1) {
    const seed = i + 1;
    if (kind === "funken") {
      // Funken springen über das Metall und glimmen auf.
      const period = 1.7 + noise(seed) * 0.8;
      const life = frac(t / period + noise(seed * 3));
      const hop = Math.floor(t / period + noise(seed * 3));
      if (!edge.length) continue;
      const [x, y] = edge[Math.floor(noise(seed * 7 + hop) * edge.length) % edge.length];
      dot(canvas, x, y, 1.2 + noise(seed * 5) * 0.8, color, Math.sin(Math.PI * life) * gain);
    } else if (kind === "glut") {
      // Glut steigt unten am Ring auf und verglimmt.
      const life = frac(t / 3.2 + i / count);
      const x = ringX + ringR * (-0.75 + 1.5 * noise(seed * 11)) + Math.sin(t * 2 + seed) * ringR * 0.06;
      const y = ringY + ringR * 0.95 - life * ringR * 1.7;
      dot(canvas, x, y, 1.9 * (1 - life * 0.5), color, Math.sin(Math.PI * life) * gain);
    } else {
      // Frost: Flocken sinken langsam am Ring vorbei.
      const life = frac(t / 5.5 + i / count);
      const x = ringX + ringR * (-1.15 + 2.3 * noise(seed * 13)) + Math.sin(t * 1.3 + seed) * ringR * 0.08;
      const y = ringY - ringR * 1.15 + life * ringR * 2.3;
      dot(canvas, x, y, 1.5, color, Math.sin(Math.PI * life) * 0.85 * gain);
    }
  }
}

/** Ein Bild der Signatur zum Zeitpunkt `t` (Sekunden). Ohne geladene Grafik nur die Teilchen. */
export function drawSignature(canvas: SkCanvas, scene: SignatureScene, t: number, image: SkImage | null) {
  "worklet";
  if (image) drawShine(canvas, scene, t, image);
  drawParticles(canvas, scene, t);
}
