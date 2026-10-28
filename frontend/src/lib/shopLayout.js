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

// `above` (#2142): waagrechte Mitte und sichtbarer unterer Rand der Ebene davor; `bandTop`: wie weit der sichtbare obere
// Rand (Großbuchstaben bzw. Ziffern) unter dem Rand der Leinwand liegt - „unter der Ebene davor“ misst dazwischen.
export function placeText(area, preset, { widthPx, heightPx, follow, offsetXCm = 0, offsetYCm = 0, rules, above = null, bandTop = 0 }) {
  let box;
  if (preset.follow === "stack") {
    if (!above) return null;
    box = { left: above.centerX - widthPx / 2, top: above.bottom + cmToPx(preset.gap_cm ?? 1, area.dpi) - bandTop, width: widthPx, height: heightPx };
    return { ...box, left: box.left + cmToPx(offsetXCm, area.dpi), top: box.top + cmToPx(offsetYCm, area.dpi) };
  }
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

// Die Leinwand einer Textebene in Zoll (#2105): Breite = Höchstbreite der Ebene (sonst global), Höhe wächst mit der
// Texthöhe (`height_per_text` vom Server, wie `shop_gamertag.canvas`). Ohne Angabe die Leinwand der globalen Regeln.
// Seit #2142 je Schrift (`font_metrics`): eine Vereinsnummer ist nur so hoch wie ihre Ziffern, eine Kontur kommt oben und
// unten dazu; `band` ist das sichtbare Band (Großbuchstaben bzw. Ziffern) in Zoll.
export function textCanvasIn(canvas, layer) {
  const width = layer?.max_width_cm ? layer.max_width_cm / CM_PER_INCH : (canvas?.width_in || 3.5);
  const metrics = canvas?.font_metrics?.[layer?.font || canvas?.font];
  if (metrics) {
    const number = layer?.kind === "member_number";
    const textIn = Number(layer?.text_height_cm || canvas?.text_height_cm || 1.27) / CM_PER_INCH;
    const outlineIn = Number(layer?.outline_cm || 0) / CM_PER_INCH;
    return {
      width,
      height: (number ? metrics.number : metrics.name) * textIn + 2 * outlineIn,
      band: (number ? metrics.band_number : metrics.band_name) * textIn,
    };
  }
  if (!layer?.text_height_cm) return { width, height: canvas?.height_in || 0.8 };
  const heightIn = layer.text_height_cm / CM_PER_INCH;
  const perText = canvas?.height_per_text || ((canvas?.height_in || 0.8) / ((canvas?.text_height_cm || 1.27) / CM_PER_INCH));
  return { width, height: perText * heightIn };
}

// Sichtbarer oberer und unterer Rand einer Ebene (#2142): bei Motiven der Rahmen, bei Text das Band in der Mitte der
// Leinwand - wie `shop_print_files.Planned.visual`.
export function visualOf(item) {
  if (!item?.box) return null;
  if (!item.band) return { top: item.box.top, bottom: item.box.top + item.box.height };
  const middle = item.box.top + item.box.height / 2;
  return { top: middle - item.band / 2, bottom: middle + item.band / 2 };
}

// Alle Ebenen einer Fläche für eine Farbe: Motive zuerst (ein Name folgt dem ersten Motiv), danach die Textebenen in
// ihrer Reihenfolge; „unter der Ebene davor“ (#2142) meint die zuletzt gesetzte. Ergebnis in der Reihenfolge der Ebenen.
// `motifFor(layer, index)` liefert das Motiv der Ebene für diese Farbe ({ width_px, height_px, … }); eine leere Ebene
// (`null`) zählt nur für die Nummerierung.
export function resolveLayers(area, layers, { presets, motifFor, gamertagCanvas, rules }) {
  const byKey = Object.fromEntries((presets || []).map((preset) => [preset.key, preset]));
  const out = [];
  let follow = null;
  let previous = null;
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
      previous = { index, kind: "motif", box, motif, outside: outside(area, box, rules) };
      out.push(previous);
    } else {
      const size = textCanvasIn(gamertagCanvas, layer);
      const heightPx = size.height * area.dpi;
      const band = (size.band || 0) * area.dpi;
      const above = previous ? { centerX: previous.box.left + previous.box.width / 2, bottom: visualOf(previous).bottom } : null;
      const box = placeText(area, preset, { widthPx: size.width * area.dpi, heightPx, follow, above, bandTop: (heightPx - band) / 2, ...offsets });
      if (!box) {
        out.push({ index, kind: layer.kind, box: null, problem: preset.follow === "stack" ? "braucht eine Ebene davor auf dieser Fläche" : "braucht ein Motiv auf dieser Fläche" });
        continue;
      }
      previous = { index, kind: layer.kind, box, band, outside: outside(area, box, rules) };
      out.push(previous);
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------- Ausrichten (#2142)

// Versatz waagrecht, damit die Ebene mittig auf der Fläche liegt.
export function centerOffsetCm(area, item, layer) {
  if (!item?.box) return null;
  const shift = area.width_px / 2 - (item.box.left + item.box.width / 2);
  return Math.round((Number(layer?.offset_x_cm || 0) + pxToCm(shift, area.dpi)) * 10) / 10;
}

// Die Ebene direkt darüber: von allen, die sichtbar über dieser enden, die mit dem tiefsten unteren Rand.
export function layerAbove(resolved, index) {
  const item = resolved.find((entry) => entry.index === index);
  const own = visualOf(item);
  if (!own) return null;
  let best = null;
  for (const entry of resolved) {
    const seen = entry.index !== index ? visualOf(entry) : null;
    if (seen && seen.bottom <= own.top + 0.5 && (!best || seen.bottom > visualOf(best).bottom)) best = entry;
  }
  return best;
}

// Sichtbarer Abstand in cm zwischen der Ebene darüber und dieser (Unterkante darüber bis Oberkante hier).
export function gapCm(area, above, item) {
  const top = visualOf(item);
  const bottom = visualOf(above);
  if (!top || !bottom) return null;
  return pxToCm(top.top - bottom.bottom, area.dpi);
}

// Versatz senkrecht, damit der sichtbare Abstand zur Ebene darüber `wantedCm` beträgt.
export function gapOffsetCm(area, above, item, layer, wantedCm) {
  const now = gapCm(area, above, item);
  if (now === null || !Number.isFinite(Number(wantedCm))) return null;
  return Math.round((Number(layer?.offset_y_cm || 0) + Number(wantedCm) - now) * 10) / 10;
}

// Wie groß eine Textebene auf dieser Fläche höchstens sein kann (#2142, wie `shop_products._text_bounds`): Breite der
// Fläche ohne Sicherheitsrand; Texthöhe so, dass die Leinwand in die Höhe ohne Sicherheitsrand passt.
export function textBoundsCm(area, rules, canvas, layer) {
  const margin = Number(rules?.safe_margin_cm?.[area.family] ?? 0);
  const width = Math.max(0, Number(area.width_cm) - 2 * margin);
  const height = Math.max(0, Number(area.height_cm) - 2 * margin);
  const metrics = canvas?.font_metrics?.[layer?.font || canvas?.font];
  const perText = metrics ? (layer?.kind === "member_number" ? metrics.number : metrics.name) : (canvas?.height_per_text || 1);
  return { width: Math.floor(width * 100) / 100, height: Math.floor((height / perText) * 100) / 100 };
}

// Eine Vorlage mit mehreren Ebenen (#2142) für eine Fläche: die Ebenen vom Server (Personalisierung schon beachtet),
// Motive mit dem Motiv, das auf der Fläche schon liegt, sonst dem ersten der Bibliothek.
export function layersFromSet(set, { motifKey = "" } = {}) {
  return (set?.layers || []).map((layer) => (layer.kind === "motif"
    ? { ...layer, offset_x_cm: 0, offset_y_cm: 0, width_cm: layer.width_cm ?? 8.9, motif: { key: layer.motif?.key || motifKey || "", by_color: {} } }
    : { ...layer, offset_x_cm: 0, offset_y_cm: 0 }));
}
