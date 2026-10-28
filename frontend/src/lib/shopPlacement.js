// Motive präzise setzen (#2117): Position als Zahl in cm, Ziehen mit Einrasten und Hilfslinien, Ausrichten, Zoom.
// Alles hier ändert nur den Versatz einer Ebene (`offset_x_cm`/`offset_y_cm`, auf 0,01 cm wie der Server speichert) -
// die Vorgabe bleibt verknüpft. Lage = Vorgabe + Versatz, darum lässt sich jede gewünschte Lage als Versatz ausdrücken;
// Druckdatei und Prüfung rechnet weiter allein der Server (`place_motif`/`place_text`).

import { pxToCm, visualOf } from "./shopLayout";

// Raster beim Ziehen: Vorgabe 0,5 cm, im Editor umstellbar (0 = ohne Raster).
export const GRID_CHOICES_CM = [0, 0.1, 0.25, 0.5, 1, 2];
export const DEFAULT_GRID_CM = 0.5;
// Wie nah (in Bildschirm-Pixeln) eine Kante an eine Hilfslinie muss, damit sie einrastet - beim Zoom also feiner in cm.
export const SNAP_SCREEN_PX = 6;
// Ab dieser Bewegung (Bildschirm-Pixel) ist ein Druck ein Ziehen - ein Klick zum Auswählen verschiebt nichts.
export const DRAG_START_PX = 3;
// Schritte für Knöpfe und Pfeiltasten: fein und mit Umschalt grob.
export const STEP_CM = 0.1;
export const BIG_STEP_CM = 1;
export const ZOOM_LIMITS = { min: 1, max: 8, factor: 1.25 };

export const round2 = (value) => {
  const out = Math.round(Number(value) * 100) / 100;
  return Object.is(out, -0) ? 0 : out;
};

// Zahl aus einem Eingabefeld: Komma oder Punkt, Minus auch als „−“ oder „–“, Leerzeichen egal. Sonst `null`.
export function parseCm(text) {
  const raw = String(text ?? "").replace(/\s+/g, "").replace(/[−–]/g, "-").replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

// „5,25“, „-1,5“, „0“ - höchstens zwei Nachkommastellen, ohne Nullen am Ende.
export function formatCm(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "";
  const out = Number(Number(value).toFixed(digits));
  return String(Object.is(out, -0) ? 0 : out).replace(".", ",");
}

// ---------------------------------------------------------------- Bildschirm ↔ cm (mit Zoom)

// Die Fläche ist auf dem Bildschirm `screenWidthPx` breit - beim Zoom entsprechend breiter, also mehr Pixel je cm.
export function screenPxPerCm(screenWidthPx, areaWidthCm) {
  return areaWidthCm > 0 && screenWidthPx > 0 ? screenWidthPx / areaWidthCm : 0;
}

export function screenToCm(pixels, screenWidthPx, areaWidthCm) {
  const scale = screenPxPerCm(screenWidthPx, areaWidthCm);
  return scale ? pixels / scale : 0;
}

export function cmToScreen(cm, screenWidthPx, areaWidthCm) {
  return cm * screenPxPerCm(screenWidthPx, areaWidthCm);
}

// Nächste Zoomstufe (`direction` > 0 größer): in Schritten von 25 %, begrenzt; nahe 100 % rastet auf genau 100 %.
export function nextZoom(zoom, direction, limits = ZOOM_LIMITS) {
  const raw = direction > 0 ? zoom * limits.factor : zoom / limits.factor;
  const out = Math.min(limits.max, Math.max(limits.min, raw));
  return Math.abs(out - 1) < 0.02 ? 1 : Math.round(out * 100) / 100;
}

// Mausrad und Trackpad: ein Zoomschritt erst nach 100 Einheiten Drehung (eine Raste) und höchstens einer je 100 ms -
// ein Trackpad schickt viele kleine Werte schnell hintereinander und sprang sonst sofort auf 800 %.
export const WHEEL_ZOOM = { delta: 100, ms: 100 };

export function wheelZoom(state, deltaY, now, deltaMode = 0, limits = WHEEL_ZOOM) {
  // deltaMode 1 = Zeilen, 2 = Seiten (Firefox) - in Pixel umgerechnet.
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const before = state?.sum || 0;
  // Richtung gewechselt: neu sammeln.
  const sum = before && Math.sign(before) !== Math.sign(px) ? px : before + px;
  const last = state?.last ?? -Infinity;
  if (Math.abs(sum) >= limits.delta && now - last >= limits.ms) return { state: { sum: 0, last: now }, direction: sum < 0 ? 1 : -1 };
  // Nicht aufstauen: höchstens ein Schritt wartet.
  return { state: { sum: Math.max(-limits.delta, Math.min(limits.delta, sum)), last }, direction: 0 };
}

// ---------------------------------------------------------------- Lage einer Ebene in cm

export function areaSizeCm(area) {
  return { width: pxToCm(area.width_px, area.dpi), height: pxToCm(area.height_px, area.dpi) };
}

// Rahmen in cm von links oben: waagrecht der Rahmen (bei Text die Leinwand, der Name steht mittig darin), senkrecht
// die sichtbaren Kanten (bei Text die Großbuchstaben bzw. Ziffern - wie „Abstand zur Ebene darüber“).
export function frameCm(area, item) {
  const seen = visualOf(item);
  if (!seen) return null;
  const cm = (px) => pxToCm(px, area.dpi);
  const left = cm(item.box.left);
  const width = cm(item.box.width);
  const top = cm(seen.top);
  const bottom = cm(seen.bottom);
  return { left, right: left + width, centerX: left + width / 2, top, bottom, middle: (top + bottom) / 2 };
}

// Die angezeigte Position: `y` Abstand der Oberkante von oben; `x` je nach Messart - „center“: Mitte der Ebene zur
// Mitte der Fläche (minus = links, plus = rechts, von vorne gesehen), „left“: linke Kante vom linken Rand.
export function positionCm(area, item, measure = "center") {
  const frame = frameCm(area, item);
  if (!frame) return null;
  return { x: measure === "left" ? frame.left : frame.centerX - areaSizeCm(area).width / 2, y: frame.top };
}

// Der Versatz, mit dem die Ebene an der gewünschten Position liegt (nur die angegebenen Achsen).
export function offsetsForPosition(area, item, layer, wanted, measure = "center") {
  const now = positionCm(area, item, measure);
  if (!now) return null;
  const out = {};
  if (Number.isFinite(wanted?.x)) out.offset_x_cm = round2(Number(layer?.offset_x_cm || 0) + wanted.x - now.x);
  if (Number.isFinite(wanted?.y)) out.offset_y_cm = round2(Number(layer?.offset_y_cm || 0) + wanted.y - now.y);
  return out;
}

// Der Server nimmt einen Versatz nur bis ±`max_offset_cm` (300 cm) - mehr wird hier gleich begrenzt statt beim
// Speichern abgelehnt. Andere Felder bleiben, wie sie sind.
export const MAX_OFFSET_CM = 300;

export function clampOffsets(patch, maxCm = MAX_OFFSET_CM) {
  if (!patch) return patch;
  const out = { ...patch };
  for (const name of ["offset_x_cm", "offset_y_cm"]) {
    if (Number.isFinite(out[name])) out[name] = round2(Math.max(-maxCm, Math.min(maxCm, out[name])));
  }
  return out;
}

// ---------------------------------------------------------------- Ausrichten mit einem Klick

function shifted(layer, dx, dy) {
  const out = {};
  if (dx !== null) out.offset_x_cm = round2(Number(layer?.offset_x_cm || 0) + dx);
  if (dy !== null) out.offset_y_cm = round2(Number(layer?.offset_y_cm || 0) + dy);
  return out;
}

// Waagrecht mittig auf der Fläche.
export function centerOnArea(area, item, layer) {
  const frame = frameCm(area, item);
  return frame ? shifted(layer, areaSizeCm(area).width / 2 - frame.centerX, null) : null;
}

// Gespiegelt zur Gegenseite: die Mitte der Ebene an der Mitte der Fläche gespiegelt (Brust rechts ↔ Brust links).
export function mirrorOnArea(area, item, layer) {
  const frame = frameCm(area, item);
  return frame ? shifted(layer, areaSizeCm(area).width - 2 * frame.centerX, null) : null;
}

export const ALIGN_HOW = ["middle", "top", "center", "opposite"];

// An einer anderen Ebene ausrichten: „middle“ gleiche Höhe (senkrechte Mitten), „top“ gleiche Oberkante, „center“
// gleiche waagrechte Mitte, „opposite“ gegenüber - waagrecht gespiegelt und auf derselben Höhe (etwa der Gamertag
// gegenüber dem Löwen).
export function alignToLayer(area, item, layer, other, how) {
  const own = frameCm(area, item);
  const ref = frameCm(area, other);
  if (!own || !ref) return null;
  if (how === "middle") return shifted(layer, null, ref.middle - own.middle);
  if (how === "top") return shifted(layer, null, ref.top - own.top);
  if (how === "center") return shifted(layer, ref.centerX - own.centerX, null);
  if (how === "opposite") return shifted(layer, areaSizeCm(area).width - ref.centerX - own.centerX, ref.middle - own.middle);
  return null;
}

// Welche Ebenen mitwandern, wenn sich Ebene `index` bewegt (etwa ein Name „gegenüber dem Motiv“): an ihnen darf die
// Ebene weder einrasten noch ausgerichtet werden. `resolve(layers)` rechnet die Ebenen wie die Vorschau.
export function followersOf(resolve, layers, index) {
  const before = resolve(layers);
  const moved = layers.map((layer, at) => (at === index && layer
    ? { ...layer, offset_x_cm: Number(layer.offset_x_cm || 0) + 1, offset_y_cm: Number(layer.offset_y_cm || 0) + 1 } : layer));
  const after = resolve(moved);
  const out = [];
  for (const item of after) {
    const old = before.find((entry) => entry.index === item.index);
    if (item.index === index || !item.box || !old?.box) continue;
    if (Math.abs(item.box.left - old.box.left) > 1e-6 || Math.abs(item.box.top - old.box.top) > 1e-6) out.push(item.index);
  }
  return out;
}

// ---------------------------------------------------------------- Ziehen mit Einrasten

// Hilfslinien einer Fläche in cm: Ränder, Mitte, Sicherheitsrand und Kanten bzw. Mitten der anderen Ebenen (ohne
// `skip`: die gezogene Ebene und was ihr folgt).
export function snapLines(area, items, { marginCm = 0, skip = [] } = {}) {
  const { width, height } = areaSizeCm(area);
  const x = [{ at: 0, kind: "edge" }, { at: width / 2, kind: "center" }, { at: width, kind: "edge" }];
  const y = [{ at: 0, kind: "edge" }, { at: height / 2, kind: "center" }, { at: height, kind: "edge" }];
  if (marginCm > 0) {
    x.push({ at: marginCm, kind: "margin" }, { at: width - marginCm, kind: "margin" });
    y.push({ at: marginCm, kind: "margin" }, { at: height - marginCm, kind: "margin" });
  }
  for (const item of items || []) {
    if (skip.includes(item.index)) continue;
    const frame = item.box ? frameCm(area, item) : null;
    if (!frame) continue;
    x.push({ at: frame.left, kind: "layer", index: item.index }, { at: frame.centerX, kind: "layer", index: item.index }, { at: frame.right, kind: "layer", index: item.index });
    y.push({ at: frame.top, kind: "layer", index: item.index }, { at: frame.middle, kind: "layer", index: item.index }, { at: frame.bottom, kind: "layer", index: item.index });
  }
  return { x, y };
}

function snapAxis(edges, delta, lines, tolerance, gridRef, grid, still) {
  // Kaum bewegt (Zittern beim waagrechten Ziehen): die Achse bleibt genau, wo sie war - ein gesetztes „5,13“ springt nicht.
  if (Math.abs(delta) < still) return { delta: 0, guide: null };
  let best = null;
  for (const edge of edges) {
    for (const line of lines) {
      const distance = Math.abs(line.at - (edge + delta));
      if (distance <= tolerance && (!best || distance < best.distance - 1e-9)) best = { distance, delta: line.at - edge, line };
    }
  }
  if (best) return { delta: best.delta, guide: best.line };
  // Weniger als ein Rasterschritt ohne Hilfslinie: die Achse bleibt - erst ein ganzer Schritt setzt sie aufs Raster.
  if (grid > 0 && Math.abs(delta) < grid) return { delta: 0, guide: null };
  if (grid > 0) return { delta: Math.round((gridRef + delta) / grid) * grid - gridRef, guide: null };
  return { delta, guide: null };
}

// Eine Bewegung beim Ziehen: `frame` ist der Rahmen beim Greifen (cm), `dx`/`dy` die Bewegung der Maus in cm. Eine
// Achse, die sich kaum bewegt hat (unter `stillCm`), bleibt genau; liegt eine Kante oder Mitte näher als `toleranceCm` an
// einer Hilfslinie, rastet sie dort ein (die Linie wird gezeigt); sonst landet die angezeigte Position auf dem Raster -
// unter einem Rasterschritt bleibt sie, wo sie war. `free` (Alt bzw. Strg gedrückt oder Einrasten aus): genau wie gezogen.
export function snapDrag({ frame, dx, dy, lines, toleranceCm, gridCm = 0, measure = "center", areaWidthCm, free = false, stillCm = 0 }) {
  if (free || !frame) return { dx, dy, guides: [] };
  const gridX = measure === "left" ? frame.left : frame.centerX - areaWidthCm / 2;
  const x = snapAxis([frame.left, frame.centerX, frame.right], dx, lines?.x || [], toleranceCm, gridX, gridCm, stillCm);
  const y = snapAxis([frame.top, frame.middle, frame.bottom], dy, lines?.y || [], toleranceCm, frame.top, gridCm, stillCm);
  const guides = [];
  if (x.guide) guides.push({ axis: "x", ...x.guide });
  if (y.guide) guides.push({ axis: "y", ...y.guide });
  return { dx: x.delta, dy: y.delta, guides };
}
