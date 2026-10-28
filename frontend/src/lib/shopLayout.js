// Druckflächen im Shop-Admin (#2069): Positions-Vorgaben auf eine Printful-Fläche umrechnen - für die Live-Vorschau.
// Spiegel von backend/services/shop_print_templates.py (place_motif, place_text, problems, max_width_cm). Entscheiden tut
// der Server: er prüft beim Speichern und erzeugt die Druckdatei. Die Vorschau soll nur genau dasselbe zeigen.
// Maße: Pixel der Druckdatei (bei der DPI der Vorlage), von links oben, von vorne gesehen.

export const CM_PER_INCH = 2.54;

export const cmToPx = (cm, dpi) => (cm / CM_PER_INCH) * dpi;
export const pxToCm = (px, dpi) => (px / dpi) * CM_PER_INCH;

function trim(value, digits) {
  return String(Number(Number(value).toFixed(digits))).replace(".", ",");
}

// „20 cm (7,87 Zoll)“ - im Admin immer beides.
export function cmText(cm) {
  if (cm === null || cm === undefined || !Number.isFinite(Number(cm))) return "–";
  return `${trim(cm, 1)} cm (${trim(cm / CM_PER_INCH, 2)} Zoll)`;
}

function clamp(value, low, high) {
  return high >= low ? Math.max(low, Math.min(value, high)) : low;
}

export function marginPx(area, rules) {
  return cmToPx(Number(rules?.safe_margin_cm?.[area.family] ?? 0), area.dpi);
}

function anchored(area, preset, width, height, margin) {
  const left = preset.center_x * area.width_px - width / 2;
  let top = cmToPx(preset.top_cm || 0, area.dpi);
  if (preset.anchor === "middle") top = (area.height_px - height) / 2;
  if (preset.anchor === "bottom") top = area.height_px - height - cmToPx(preset.top_cm || 0, area.dpi);
  return {
    left: clamp(left, margin, area.width_px - margin - width),
    top: clamp(top, margin, area.height_px - margin - height),
    width,
    height,
  };
}

export function placeMotif(area, preset, { widthCm, aspect, offsetXCm = 0, offsetYCm = 0, rules }) {
  const width = cmToPx(widthCm, area.dpi);
  const box = anchored(area, preset, width, width * aspect, marginPx(area, rules));
  return { ...box, left: box.left + cmToPx(offsetXCm, area.dpi), top: box.top + cmToPx(offsetYCm, area.dpi) };
}

export function placeText(area, preset, { widthPx, heightPx, follow, offsetXCm = 0, offsetYCm = 0, rules }) {
  let box;
  if (preset.follow && !follow) return null;
  if (preset.follow === "opposite") {
    const centerX = area.width_px - (follow.left + follow.width / 2);
    const centerY = follow.top + follow.height / 2;
    box = { left: centerX - widthPx / 2, top: centerY - heightPx / 2, width: widthPx, height: heightPx };
  } else if (preset.follow === "below") {
    const centerX = follow.left + follow.width / 2;
    box = { left: centerX - widthPx / 2, top: follow.top + follow.height + cmToPx(preset.gap_cm ?? 1, area.dpi), width: widthPx, height: heightPx };
  } else {
    box = anchored(area, preset, widthPx, heightPx, marginPx(area, rules));
  }
  return { ...box, left: box.left + cmToPx(offsetXCm, area.dpi), top: box.top + cmToPx(offsetYCm, area.dpi) };
}

// Ragt der Rahmen aus der Fläche (bzw. dem Sicherheitsrand)? Ein halbes Pixel Rundung ist kein Überstand.
export function outside(area, box, rules) {
  const margin = marginPx(area, rules);
  const sides = [];
  if (box.left < margin - 0.5) sides.push("links");
  if (box.top < margin - 0.5) sides.push("oben");
  if (box.left + box.width > area.width_px - margin + 0.5) sides.push("rechts");
  if (box.top + box.height > area.height_px - margin + 0.5) sides.push("unten");
  return sides;
}

export function maxWidthCm(area, aspect, rules) {
  const margin = marginPx(area, rules);
  const width = Math.min(area.width_px - 2 * margin, aspect > 0 ? (area.height_px - 2 * margin) / aspect : Infinity);
  return Math.floor(pxToCm(Math.max(width, 0), area.dpi) * 10) / 10;
}

// Die Leinwand einer Namensebene in Zoll (#2105): Breite = Höchstbreite der Ebene (sonst global), Höhe wächst mit der
// Texthöhe (`height_per_text` vom Server, wie `shop_gamertag.canvas`). Ohne Angabe die Leinwand der globalen Regeln.
export function textCanvasIn(canvas, layer) {
  const width = layer?.max_width_cm ? layer.max_width_cm / CM_PER_INCH : (canvas?.width_in || 3.5);
  if (!layer?.text_height_cm) return { width, height: canvas?.height_in || 0.8 };
  const heightIn = layer.text_height_cm / CM_PER_INCH;
  const perText = canvas?.height_per_text || ((canvas?.height_in || 0.8) / ((canvas?.text_height_cm || 1.27) / CM_PER_INCH));
  return { width, height: perText * heightIn };
}

// Alle Ebenen einer Fläche für eine Farbe: Motive zuerst (ein Name folgt dem ersten Motiv), Ergebnis in der Reihenfolge
// der Ebenen. `motifFor(layer, index)` liefert das Motiv der Ebene für diese Farbe ({ width_px, height_px, … }); eine
// leere Ebene (`null`) zählt nur für die Nummerierung.
export function resolveLayers(area, layers, { presets, motifFor, gamertagCanvas, rules }) {
  const byKey = Object.fromEntries((presets || []).map((preset) => [preset.key, preset]));
  const out = [];
  let follow = null;
  const order = layers.map((layer, index) => ({ layer, index })).filter((item) => item.layer).sort((a, b) => (a.layer.kind === "motif" ? 0 : 1) - (b.layer.kind === "motif" ? 0 : 1));
  for (const { layer, index } of order) {
    const preset = byKey[layer.preset];
    if (!preset) {
      out.push({ index, kind: layer.kind, box: null, problem: "Vorgabe fehlt" });
      continue;
    }
    const offsets = { offsetXCm: Number(layer.offset_x_cm || 0), offsetYCm: Number(layer.offset_y_cm || 0), rules };
    if (layer.kind === "motif") {
      const motif = motifFor(layer, index);
      if (!motif?.width_px || !motif?.height_px) {
        out.push({ index, kind: "motif", box: null, problem: "Motiv fehlt" });
        continue;
      }
      const box = placeMotif(area, preset, { widthCm: Number(layer.width_cm || preset.width_cm || 5), aspect: motif.height_px / motif.width_px, ...offsets });
      if (!follow) follow = box;
      out.push({ index, kind: "motif", box, motif, outside: outside(area, box, rules) });
    } else {
      const size = textCanvasIn(gamertagCanvas, layer);
      const box = placeText(area, preset, { widthPx: size.width * area.dpi, heightPx: size.height * area.dpi, follow, ...offsets });
      out.push(box ? { index, kind: layer.kind, box, outside: outside(area, box, rules) } : { index, kind: layer.kind, box: null, problem: "braucht ein Motiv auf dieser Fläche" });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
