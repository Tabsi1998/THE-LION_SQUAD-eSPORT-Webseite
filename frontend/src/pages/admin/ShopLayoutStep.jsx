import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, AlignCenterHorizontal, CheckCircle2, ExternalLink, Image as ImageIcon, LayoutTemplate, Move, Plus, RefreshCw, RotateCcw, Trash2, Upload, Wand2 } from "lucide-react";
import { api, formatRequestError, resolveMediaUrl, uploadApi } from "@/lib/api";
import { viennaDateTime } from "@/lib/vienna";
import { centerOffsetCm, cmText, gapCm, gapOffsetCm, layerAbove, layersFromSet, maxWidthCm, resolveLayers, textBoundsCm } from "@/lib/shopLayout";
import { techniqueLabel } from "@/lib/shopTechniques";

// Schritt 3 der Produktverwaltung (#2069): Druckflächen direkt aus der Printful-Vorlage. Je Fläche wählt der Admin Motiv,
// Vorgabe-Position und Größe in cm - die Website erzeugt daraus die Druckdatei in der exakten Pixelgröße von Printful.
// Feinjustieren geht per Ziehen oder Pfeiltasten in der Vorschau; der Hauptweg bleibt Vorgabe plus Regler. Gamertag und
// Vereinsnummer sind Platzhalter: ihre Datei entsteht je Bestellung. Prüfen und Erzeugen tut der Server.

const BASE = "/admin/shop/products";
const SELECT = "mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-2 text-sm focus:border-brand outline-none disabled:opacity-50";
const SMALL_BTN = "tls-btn tls-btn--secondary min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5 disabled:opacity-40";
const QUIET_BTN = "tls-btn tls-btn--quiet min-h-9 px-2 text-xs rounded-sm inline-flex items-center gap-1.5 disabled:opacity-40";
const STATE_TONES = { ok: "text-ok", not_needed: "text-white/55", missing: "text-warn", outdated: "text-honor", invalid: "text-warn", no_area: "text-warn" };
const STATE_TEXT = { ok: "aktuell", not_needed: "Platzhalter", missing: "fehlt", outdated: "veraltet", invalid: "passt nicht", no_area: "Fläche fehlt" };
const NUDGE_CM = 0.1;
const DRAFT_PREVIEW_DELAY_MS = 350;
const SAMPLE_DELAY_MS = 300;

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

function areaOf(available) {
  return { ...available.file, family: available.family, label: available.label, placement: available.key };
}

function sizeText(file) {
  return `${file.width_px} × ${file.height_px} px · ${cmText(file.width_cm)} × ${cmText(file.height_cm)} · ${file.dpi} DPI`;
}

function draftFrom(view) {
  return Object.fromEntries((view.placements || []).map((row) => [row.key, {
    mode: row.mode || "layout",
    layers: (row.layers || []).map((layer) => ({ ...layer, ...(layer.motif ? { motif: { key: layer.motif.key, by_color: { ...(layer.motif.by_color || {}) } } } : {}) })),
  }]));
}

function cleanLayer(layer) {
  const out = { kind: layer.kind, preset: layer.preset, offset_x_cm: round1(layer.offset_x_cm || 0), offset_y_cm: round1(layer.offset_y_cm || 0) };
  if (layer.kind === "motif") {
    out.width_cm = round1(layer.width_cm);
    out.motif = { key: layer.motif?.key || "", by_color: Object.fromEntries(Object.entries(layer.motif?.by_color || {}).filter(([, key]) => key)) };
  } else {
    // Größe je Namensebene (#2105) - nur, wenn gesetzt; sonst gelten die globalen Gamertag-Regeln.
    for (const name of ["text_height_cm", "max_width_cm"]) {
      if (Number(layer[name]) > 0) out[name] = Math.round(Number(layer[name]) * 100) / 100;
    }
    // Feste Farbe des Namens (#2141) - nur, wenn gewählt; sonst automatisch nach Kontrast.
    if (layer.ink) out.ink = layer.ink;
    // Schrift und Kontur (#2142) - nur, wenn gesetzt; der feste Text selbst nur bei der Art „Fester Text“.
    if (layer.font) out.font = layer.font;
    if (Number(layer.outline_cm) > 0) {
      out.outline_cm = Math.round(Number(layer.outline_cm) * 100) / 100;
      if (layer.outline_ink) out.outline_ink = layer.outline_ink;
    }
    if (layer.kind === "text") out.text = String(layer.text ?? "");
  }
  // Fassung von Hand (#2141) - nur hell oder dunkel; „automatisch“ ist die Vorgabe und wird nicht mitgeschickt.
  if (layer.variant === "light" || layer.variant === "dark") out.variant = layer.variant;
  return out;
}

function defaultCm(value) {
  return Number(value) > 0 ? `Vorgabe ${String(round1(value)).replace(".", ",")}` : "Vorgabe";
}

function cmNumber(text) {
  const value = Number(String(text ?? "").trim().replace(",", "."));
  return String(text ?? "").trim() && Number.isFinite(value) && value > 0 ? value : null;
}

// Beispielname in echter Größe (#2105): der Server rendert ihn wie die Druckdatei - dieselben Regeln der Ebene, und
// liegt der Name auf einem Hintergrund, dieselbe Farbe aus dem Untergrund (#2141, `ink` aus dem Plan).
function nameSample(productId, kind, color, layer, ink) {
  const params = { kind, color };
  if (Number(layer?.text_height_cm) > 0) params.text_height_cm = String(layer.text_height_cm);
  if (Number(layer?.max_width_cm) > 0) params.max_width_cm = String(layer.max_width_cm);
  if (ink) params.ink = ink;
  // Schrift, Kontur und fester Text (#2142) - der Server rendert genau das.
  if (layer?.font) params.font = layer.font;
  if (Number(layer?.outline_cm) > 0) {
    params.outline_cm = String(layer.outline_cm);
    if (layer.outline_ink) params.outline_ink = layer.outline_ink;
  }
  if (kind === "text") params.text = String(layer?.text ?? "");
  const path = `${BASE}/${productId}/name-sample`;
  return { path, params, url: resolveMediaUrl(`/api${path}?${new URLSearchParams(params).toString()}`) };
}

// Das Bild des Beispielnamens: gedrosselt (beim Tippen nicht jede Zwischengröße laden - ein neues Bild ersetzt das
// alte), je Adresse neu (`key`) - und passt der Name so nicht (Server sagt 400), steht dessen Satz an der Ebene statt
// eines stillen Lochs (Review #2105).
function SampleImage({ sample, onProblem, testId }) {
  const [shown, setShown] = useState(sample);
  const [failed, setFailed] = useState(null);
  const report = useRef(onProblem);
  const latest = useRef(sample);
  report.current = onProblem;
  latest.current = sample;
  useEffect(() => {
    if (sample.url === shown.url) return undefined;
    const timer = setTimeout(() => setShown(latest.current), SAMPLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [sample.url, shown.url]);
  useEffect(() => {
    let live = true;
    if (failed !== shown.url) {
      report.current(null);
      return undefined;
    }
    api.get(shown.path, { params: shown.params }).then(() => {
      if (live) report.current("Der Beispielname lässt sich gerade nicht anzeigen.");
    }).catch((failure) => {
      if (live) report.current(formatRequestError(failure, "Der Name passt mit dieser Größe nicht."));
    });
    return () => { live = false; };
  }, [failed, shown]);
  if (failed === shown.url) return null;
  return <img key={shown.url} src={shown.url} alt="" aria-hidden="true" className="w-full h-full pointer-events-none" draggable={false}
    onError={() => setFailed(shown.url)} data-testid={testId} />;
}

// Welche Fassung der Server für eine Farbe druckt (hell oder dunkel samt Version, #2069 Teil A) - aus den Plänen der
// zuletzt gespeicherten Fassung, solange die Ebene dasselbe Motiv und dieselbe Ausnahme hat. So zeigt die Vorschau
// genau das Bild, das in die Druckdatei kommt.
function savedSources(view) {
  const out = {};
  for (const row of view.placements || []) {
    for (const state of row.files || []) {
      for (const layer of state.plan?.layers || []) {
        if (!layer.source?.design_key) continue;
        const saved = (row.layers || [])[layer.index]?.motif || {};
        out[`${row.key}|${layer.index}|${state.color}`] = {
          key: layer.source.design_key, variant: layer.source.variant, base: saved.key, exception: saved.by_color?.[state.color] || "",
          image_path: layer.image_path, aspect: layer.aspect,
        };
      }
    }
  }
  return out;
}

// Was der Server je Ebene und Farbe entschieden hat (#2141): Untergrund hell oder dunkel samt Herkunft („aus
// Hintergrund“) und bei Namen die Farbe - und je Fläche und Farbe der hochgeladene Hintergrund.
function planLayers(view) {
  const out = {};
  for (const row of view.placements || []) {
    for (const state of row.files || []) {
      for (const layer of state.plan?.layers || []) {
        out[`${row.key}|${layer.index}|${state.color}`] = { surface: layer.surface || null, ink: layer.ink || null };
      }
    }
  }
  return out;
}

function backgroundsOf(view) {
  const out = {};
  for (const row of view.placements || []) {
    for (const state of row.files || []) {
      // `ok`: passt der Hintergrund zur Vorlage? Nur dann entscheidet er über Fassung und Farbe (#2142).
      if (state.background?.id) out[`${row.key}|${state.color}`] = { ...state.background, ok: state.background_ok !== false };
    }
  }
  return out;
}

const KIND_SHORT = { motif: "Motiv", gamertag: "Gamertag", member_number: "Vereinsnummer", text: "Fester Text" };

function scrollToArea(key) {
  const card = document.querySelector(`[data-testid="shop-area-${key}"]`);
  if (!card) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  card.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
  card.querySelector(`[data-testid="shop-area-use-${key}"]`)?.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- Vorschau mit Vorlagenbild, Ziehen und Pfeiltasten

function LayoutPreview({ area, preview, layers, resolved, colorCode, motifFor, sampleFor, onSampleProblem, selected, onSelect, onNudge, editable, testId, stale = false, backdrop = null }) {
  const areaRef = useRef(null);
  const drag = useRef(null);
  const templateW = preview?.template_width || area.width_px;
  const templateH = preview?.template_height || area.height_px;
  const box = preview?.area || { left: 0, top: 0, width: area.width_px, height: area.height_px };
  const pct = (value, whole) => `${(value / whole) * 100}%`;
  const imagePath = preview?.image_path ? resolveMediaUrl(preview.image_path) : null;
  const background = preview?.background_path ? resolveMediaUrl(preview.background_path) : null;
  const marginCm = Number(area.safe_margin_cm || 0);

  const toCm = (pixels) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect?.width) return 0;
    return (pixels / rect.width) * area.width_cm;
  };
  const onPointerDown = (event, index) => {
    if (!editable) return;
    onSelect(index);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { index, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event) => {
    if (!drag.current) return;
    const dx = toCm(event.clientX - drag.current.x);
    const dy = toCm(event.clientY - drag.current.y);
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return;
    drag.current = { ...drag.current, x: event.clientX, y: event.clientY };
    onNudge(drag.current.index, dx, dy);
  };
  const stop = () => { drag.current = null; };
  const onKeyDown = (event, index) => {
    const step = event.shiftKey ? 1 : NUDGE_CM;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!editable || !moves[event.key]) return;
    event.preventDefault();
    onNudge(index, ...moves[event.key]);
  };

  return (
    <div className="relative w-full overflow-hidden rounded-sm border border-white/10 select-none" style={{ aspectRatio: `${templateW} / ${templateH}`, backgroundColor: colorCode || "#808080" }} data-testid={testId} data-stale={stale ? "true" : undefined} data-tinted={preview?.tinted ? "true" : undefined}>
      {background && <img src={background} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" />}
      {preview?.positioning === "background" && imagePath && <img src={imagePath} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" />}
      <div ref={areaRef} className="absolute outline outline-1 outline-dashed outline-white/40" style={{ left: pct(box.left, templateW), top: pct(box.top, templateH), width: pct(box.width, templateW), height: pct(box.height, templateH) }}
        onPointerMove={onPointerMove} onPointerUp={stop} onPointerCancel={stop} data-testid={`${testId}-area`}>
        {/* Die fertige Datei dieser Farbe als Hintergrund (#2141) - genau die Druckfläche, unter den Ebenen. */}
        {backdrop && <img src={backdrop} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" draggable={false} data-testid={`${testId}-backdrop`} />}
        {marginCm > 0 && (
          <div className="absolute border border-dashed border-honor/60 pointer-events-none" aria-hidden="true"
            style={{ inset: `${(marginCm / area.height_cm) * 100}% ${(marginCm / area.width_cm) * 100}%` }} />
        )}
        {resolved.map((item) => {
          if (!item.box) return null;
          const layer = layers[item.index];
          const motif = item.kind === "motif" ? motifFor(layer, item.index) : null;
          const bad = item.outside?.length > 0;
          const isSelected = selected === item.index;
          const label = item.kind === "motif" ? `Motiv ${motif?.title || ""}` : KIND_SHORT[item.kind] || item.kind;
          return (
            <button key={item.index} type="button" aria-label={`${label} verschieben (Pfeiltasten, mit Umschalt 1 cm)`} aria-pressed={isSelected}
              onPointerDown={(event) => onPointerDown(event, item.index)} onKeyDown={(event) => onKeyDown(event, item.index)} onFocus={() => onSelect(item.index)}
              className={`absolute p-0 m-0 bg-transparent touch-none outline-none transition-[box-shadow,opacity] duration-150 ${stale ? "opacity-50" : ""} ${editable ? "cursor-move" : "cursor-default"} ${isSelected ? "ring-2 ring-brand" : "ring-1 ring-white/25"} ${bad ? "ring-2 ring-warn" : ""} focus-visible:ring-2 focus-visible:ring-brand`}
              style={{ left: pct(item.box.left, area.width_px), top: pct(item.box.top, area.height_px), width: pct(item.box.width, area.width_px), height: pct(item.box.height, area.height_px) }}
              data-testid={`${testId}-layer-${item.index}`} data-outside={bad ? item.outside.join(",") : undefined}>
              {item.kind === "motif" && motif?.image_path
                ? <img src={resolveMediaUrl(motif.image_path)} alt="" aria-hidden="true" className="w-full h-full pointer-events-none" draggable={false} />
                : item.kind !== "motif" && sampleFor
                  // Der Name in echter Texthöhe; die Leinwand (Höchstbreite) ist nur der feine Rahmen drumherum (#2105).
                  ? <SampleImage sample={sampleFor(item.kind, layer)} onProblem={(text) => onSampleProblem?.(item.index, text)} testId={`${testId}-layer-${item.index}-sample`} />
                  : <span className="flex items-center justify-center w-full h-full border border-dashed border-brand/70 bg-brand/10 text-[10px] font-bold uppercase tracking-wider text-brand pointer-events-none">{item.kind === "motif" ? "Motiv" : item.kind === "gamertag" ? "Gamertag" : item.kind === "text" ? "Text" : "Nr."}</span>}
            </button>
          );
        })}
      </div>
      {preview?.positioning !== "background" && imagePath && <img src={imagePath} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full pointer-events-none" />}
    </div>
  );
}

// ---------------------------------------------------------------- Ebenen bearbeiten

function MotifLayer({ layer, area, presets, motifs, colors, colorName, minWidth, rules, aspect, editable, onChange, onRemove, testId }) {
  const max = Math.max(minWidth, maxWidthCm(area, aspect || 1, rules));
  const width = Number(layer.width_cm || minWidth);
  const offset = Number(layer.offset_x_cm || 0) !== 0 || Number(layer.offset_y_cm || 0) !== 0;
  const exceptions = Object.entries(layer.motif?.by_color || {}).filter(([, key]) => key);
  const [open, setOpen] = useState(exceptions.length > 0);
  // Eingabe als Text (Komma erlaubt): ein leeres Feld beim Tippen ist kein „0 cm“.
  const [typed, setTyped] = useState(String(width).replace(".", ","));
  useEffect(() => {
    setTyped((now) => (Number(now.replace(",", ".")) === width ? now : String(width).replace(".", ",")));
  }, [width]);
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-sm"><span className="text-white/70">Motiv</span>
          <select value={layer.motif?.key || ""} disabled={!editable} onChange={(event) => onChange({ motif: { ...(layer.motif || {}), key: event.target.value } })} className={SELECT} data-testid={`${testId}-motif`}>
            <option value="">– Motiv wählen –</option>
            {motifs.map((motif) => <option key={motif.key} value={motif.key}>{motif.title}</option>)}
          </select>
        </label>
        <label className="block text-sm"><span className="text-white/70">Position</span>
          <select value={layer.preset} disabled={!editable} onChange={(event) => onChange({ preset: event.target.value, offset_x_cm: 0, offset_y_cm: 0 })} className={SELECT} data-testid={`${testId}-preset`}>
            {presets.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
          </select>
        </label>
      </div>
      {presets.find((preset) => preset.key === layer.preset)?.hint && <p className="text-xs text-white/50">{presets.find((preset) => preset.key === layer.preset).hint}</p>}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-sm">
          <label htmlFor={`${testId}-width`} className="text-white/70">Breite</label>
          <span className="tabular-nums" data-testid={`${testId}-width-text`}>{cmText(width)}</span>
        </div>
        <div className="flex items-center gap-3">
          <input id={`${testId}-width`} type="range" min={minWidth} max={max} step={0.1} value={Math.min(width, max)} disabled={!editable}
            onChange={(event) => onChange({ width_cm: Number(event.target.value) })} className="flex-1 accent-brand" data-testid={`${testId}-width`} />
          <input type="text" inputMode="decimal" value={typed} disabled={!editable} aria-label="Breite in cm"
            onChange={(event) => {
              setTyped(event.target.value);
              const value = Number(event.target.value.trim().replace(",", "."));
              if (event.target.value.trim() && Number.isFinite(value) && value > 0) onChange({ width_cm: value });
            }}
            className={`${SELECT} mt-0 w-24 tabular-nums`} data-testid={`${testId}-width-cm`} />
        </div>
        <p className="text-xs text-white/45">Höchstens {cmText(max)} - die Fläche begrenzt die Größe, die Höhe folgt aus dem Motiv.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {offset && <span className="text-xs text-white/55 tabular-nums" data-testid={`${testId}-offset`}>Feinjustiert: {round1(layer.offset_x_cm).toString().replace(".", ",")} / {round1(layer.offset_y_cm).toString().replace(".", ",")} cm</span>}
        {offset && <button type="button" disabled={!editable} onClick={() => onChange({ offset_x_cm: 0, offset_y_cm: 0 })} className={QUIET_BTN} data-testid={`${testId}-reset`}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Auf die Vorgabe</button>}
        {colors.length > 1 && <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={QUIET_BTN} data-testid={`${testId}-exceptions-toggle`}>Ausnahme je Farbe{exceptions.length ? ` (${exceptions.length})` : ""}</button>}
        <button type="button" disabled={!editable} onClick={onRemove} className={`${QUIET_BTN} ml-auto`} data-testid={`${testId}-remove`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Ebene entfernen</button>
      </div>
      {open && colors.length > 1 && (
        <div className="grid gap-2 sm:grid-cols-2 border-t border-white/10 pt-2" data-testid={`${testId}-exceptions`}>
          <p className="sm:col-span-2 text-xs text-white/50">Ohne Ausnahme nimmt jede Farbe automatisch die passende Fassung (hell oder dunkel).</p>
          {colors.map((color) => (
            <label key={color} className="block text-sm"><span className="text-white/70">{colorName(color)}</span>
              <select value={layer.motif?.by_color?.[color] || ""} disabled={!editable}
                onChange={(event) => onChange({ motif: { ...(layer.motif || {}), by_color: { ...(layer.motif?.by_color || {}), [color]: event.target.value } } })}
                className={SELECT} data-testid={`${testId}-exception-${color}`}>
                <option value="">automatisch</option>
                {motifs.map((motif) => <option key={motif.key} value={motif.key}>{motif.title}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Texthöhe und Höchstbreite einer Namensebene in cm (#2105): leer heißt Vorgabe aus den Gamertag-Regeln. Eingabe als
// Text (Komma erlaubt), damit ein leeres Feld beim Tippen nicht „0 cm“ ist.
function SizeField({ label, value, placeholder, editable, onChange, testId }) {
  const [typed, setTyped] = useState(value ? String(value).replace(".", ",") : "");
  useEffect(() => {
    setTyped((now) => (cmNumber(now) === (value || null) ? now : (value ? String(value).replace(".", ",") : "")));
  }, [value]);
  return (
    <label className="block text-sm min-w-0"><span className="text-white/70">{label}</span>
      <input type="text" inputMode="decimal" value={typed} disabled={!editable} placeholder={placeholder}
        onChange={(event) => {
          setTyped(event.target.value);
          if (!event.target.value.trim()) onChange(null);
          else if (cmNumber(event.target.value) !== null) onChange(cmNumber(event.target.value));
        }}
        className={`${SELECT} tabular-nums`} data-testid={testId} />
    </label>
  );
}

const TEXT_HINTS = {
  gamertag: "Die Datei mit dem Namen entsteht je Bestellung.",
  member_number: "Nur Ziffern - die Nummer kommt je Bestellung.",
  text: "Gleich für alle Bestellungen - der Text kommt in die Grunddatei.",
};

function TextLayer({ layer, area, rules, canvas, presets, kindLabel, editable, onChange, onRemove, testId, problem, inks = [], fonts = [] }) {
  const limits = canvas?.limits || {};
  // Seit #2142 begrenzt die Fläche (mit Sicherheitsrand) - nicht mehr 2 bzw. 12 Zoll.
  const bounds = textBoundsCm(area, rules, canvas, layer);
  const height = Number(layer.text_height_cm) || null;
  const width = Number(layer.max_width_cm) || null;
  const outline = Number(layer.outline_cm) || null;
  const bad = (height && (height < limits.min_text_height_cm || height > bounds.height))
    || (width && (width < limits.min_width_cm || width > bounds.width));
  const badOutline = outline && (outline < (limits.min_outline_cm ?? 0.05) || outline > (limits.max_outline_cm ?? 2));
  const fixed = layer.kind === "text";
  return (
    <div className="space-y-2" data-testid={testId}>
      {fixed && (
        <label className="block text-sm"><span className="text-white/70">Text</span>
          <input type="text" value={layer.text ?? ""} disabled={!editable} maxLength={40} onChange={(event) => onChange({ text: event.target.value })}
            className={SELECT} data-testid={`${testId}-text`} placeholder="z. B. Vereinsname" />
        </label>
      )}
      <label className="block text-sm"><span className="text-white/70">{kindLabel} - Position</span>
        <select value={layer.preset} disabled={!editable} onChange={(event) => onChange({ preset: event.target.value, offset_x_cm: 0, offset_y_cm: 0 })} className={SELECT} data-testid={`${testId}-preset`}>
          {presets.map((preset) => <option key={preset.key} value={preset.key}>{preset.label}</option>)}
        </select>
      </label>
      <p className="text-xs text-white/50">{presets.find((preset) => preset.key === layer.preset)?.hint || TEXT_HINTS[layer.kind]}</p>
      <div className="grid gap-2 grid-cols-2">
        <SizeField label="Texthöhe (cm)" value={height} placeholder={defaultCm(canvas?.text_height_cm)} editable={editable}
          onChange={(next) => onChange({ text_height_cm: next })} testId={`${testId}-text-height`} />
        <SizeField label="Höchstbreite (cm)" value={width} placeholder={defaultCm(canvas?.max_width_cm)} editable={editable}
          onChange={(next) => onChange({ max_width_cm: next })} testId={`${testId}-max-width`} />
      </div>
      <p className={`text-xs ${bad ? "text-warn" : "text-white/45"}`} data-testid={`${testId}-size-hint`}>
        Leer = Vorgabe aus den Gamertag-Regeln. Auf dieser Fläche (mit Sicherheitsrand): Texthöhe {cmText(limits.min_text_height_cm)} bis {cmText(bounds.height)}, Höchstbreite bis {cmText(bounds.width)}. {layer.kind === "member_number" ? "Gemessen an den Ziffern." : "Was nicht in die Höchstbreite passt, wird bis zur Mindesthöhe verkleinert."}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {fonts.length > 0 && (
          <label className="block text-sm min-w-0"><span className="text-white/70">Schrift</span>
            <select value={layer.font || ""} disabled={!editable} onChange={(event) => onChange({ font: event.target.value || null })} className={SELECT} data-testid={`${testId}-font`}>
              <option value="">Vorgabe (Gamertag-Regeln)</option>
              {fonts.map((font) => <option key={font.key} value={font.key}>{font.label}</option>)}
            </select>
          </label>
        )}
        {inks.length > 0 && (
          // Farbe (#2141): automatisch nach Kontrast zum Untergrund oder fest eine Farbe der Gamertag-Regeln.
          <label className="block text-sm min-w-0"><span className="text-white/70">Farbe</span>
            <select value={layer.ink || ""} disabled={!editable} onChange={(event) => onChange({ ink: event.target.value || null })} className={SELECT} data-testid={`${testId}-ink`}>
              <option value="">automatisch (Kontrast)</option>
              {inks.map((ink) => <option key={ink.key} value={ink.key}>{ink.label}</option>)}
            </select>
          </label>
        )}
        <SizeField label="Kontur (cm)" value={outline} placeholder="keine" editable={editable}
          onChange={(next) => onChange({ outline_cm: next, ...(next ? {} : { outline_ink: null }) })} testId={`${testId}-outline`} />
        {outline && inks.length > 0 && (
          <label className="block text-sm min-w-0"><span className="text-white/70">Farbe der Kontur</span>
            <select value={layer.outline_ink || ""} disabled={!editable} onChange={(event) => onChange({ outline_ink: event.target.value || null })} className={SELECT} data-testid={`${testId}-outline-ink`}>
              <option value="">automatisch (Kontrast zur Schrift)</option>
              {inks.map((ink) => <option key={ink.key} value={ink.key}>{ink.label}</option>)}
            </select>
          </label>
        )}
      </div>
      {badOutline && <p className="text-xs text-warn" data-testid={`${testId}-outline-hint`}>Kontur {cmText(limits.min_outline_cm ?? 0.05)} bis {cmText(limits.max_outline_cm ?? 2)}.</p>}
      {problem && <p className="text-xs text-warn" role="alert">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        {(Number(layer.offset_x_cm || 0) !== 0 || Number(layer.offset_y_cm || 0) !== 0) && <button type="button" disabled={!editable} onClick={() => onChange({ offset_x_cm: 0, offset_y_cm: 0 })} className={QUIET_BTN} data-testid={`${testId}-reset`}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Auf die Vorgabe</button>}
        <button type="button" disabled={!editable} onClick={onRemove} className={`${QUIET_BTN} ml-auto`} data-testid={`${testId}-remove`}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> {fixed ? "Ebene entfernen" : "Platzhalter entfernen"}</button>
      </div>
    </div>
  );
}

// Ausrichten (#2142): mittig auf die Fläche und ein Abstand in cm zur Ebene darüber (sichtbare Kanten: bei Text die
// Großbuchstaben bzw. Ziffern). Beides setzt nur den Versatz - Zahleneingabe, Einrasten und Zoom kommen mit #2117.
function AlignTools({ area, item, above, layer, editable, onChange, testId }) {
  const now = above ? gapCm(area, above, item) : null;
  const [wanted, setWanted] = useState("");
  if (!item?.box) return null;
  const value = cmNumber(wanted) ?? (wanted.trim() === "0" ? 0 : null);
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-2 mt-2" data-testid={`${testId}-align`}>
      <button type="button" disabled={!editable} onClick={() => onChange({ offset_x_cm: centerOffsetCm(area, item, layer) })} className={QUIET_BTN} data-testid={`${testId}-center`}>
        <AlignCenterHorizontal className="w-3.5 h-3.5" aria-hidden="true" /> Mittig auf Fläche
      </button>
      {above && (
        <>
          <label className="block text-sm"><span className="text-white/70 text-xs">Abstand zur Ebene darüber (cm)</span>
            <input type="text" inputMode="decimal" value={wanted} disabled={!editable} placeholder={now === null ? "" : String(Math.round(now * 10) / 10).replace(".", ",")}
              onChange={(event) => setWanted(event.target.value)} className={`${SELECT} w-28 tabular-nums`} data-testid={`${testId}-gap`} />
          </label>
          <button type="button" disabled={!editable || value === null} className={QUIET_BTN} data-testid={`${testId}-gap-set`}
            onClick={() => { onChange({ offset_y_cm: gapOffsetCm(area, above, item, layer, value) }); setWanted(""); }}>
            Abstand setzen
          </button>
          <span className="text-xs text-white/50 tabular-nums pb-2.5" data-testid={`${testId}-gap-now`}>jetzt {now === null ? "–" : cmText(now)}</span>
        </>
      )}
    </div>
  );
}

// Fassung je Ebene (#2141): automatisch (Hintergrund unter der Ebene, sonst Vorgabe des Produkts, sonst Shirtfarbe)
// oder von Hand hell bzw. dunkel - etwa bei gemischtem Hintergrund. Daneben, was der Server für die Vorschau-Farbe
// entschieden hat, bei Namen samt Farbe.
const VARIANT_HINTS = { light: "für hellen Untergrund", dark: "für dunklen Untergrund" };

const SURFACE_FROM = { background: "aus Hintergrund", product: "Vorgabe des Produkts", layer: "Untergrund von Hand", garment: "nach der Shirtfarbe" };

function SurfaceField({ layer, info, labels, editable, onChange, testId, stale }) {
  const value = layer.variant === "light" || layer.variant === "dark" ? layer.variant : "auto";
  const options = labels || { auto: "automatisch", light: "hell", dark: "dunkel" };
  const surface = info?.surface;
  if (layer.kind !== "motif") {
    // Textebenen (#2142): die Fassung steuert hier nur die Farbe - darum nur „Farbe“ mit ihrer Herkunft. Eine früher von
    // Hand gesetzte Fassung bleibt sichtbar, damit sie sich zurücksetzen lässt.
    const from = info?.ink?.fixed ? "fest" : SURFACE_FROM[surface?.source] || SURFACE_FROM.garment;
    return (
      <div className="border-t border-white/10 pt-2 mt-2 space-y-2">
        <p className={`text-xs ${stale ? "text-white/40" : "text-white/60"}`} role="status" data-testid={`${testId}-surface`}>
          {info?.ink?.label ? `Farbe: ${info.ink.label} (${from})` : `Farbe ${from}.`}
        </p>
        {value !== "auto" && (
          <label className="block text-sm max-w-xs"><span className="text-white/70">Untergrund für die Farbe</span>
            <select value={value} disabled={!editable} onChange={(event) => onChange({ variant: event.target.value === "auto" ? null : event.target.value })}
              className={SELECT} data-testid={`${testId}-variant`}>
              {Object.entries(options).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        )}
      </div>
    );
  }
  const ink = info?.ink?.label && (info.ink.fixed || surface?.variant) ? ` · Farbe: ${info.ink.label}${info.ink.fixed ? " (fest)" : ""}` : "";
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-end border-t border-white/10 pt-2 mt-2">
      <label className="block text-sm"><span className="text-white/70">Fassung</span>
        <select value={value} disabled={!editable} onChange={(event) => onChange({ variant: event.target.value === "auto" ? null : event.target.value })}
          className={SELECT} data-testid={`${testId}-variant`}>
          {Object.entries(options).map(([key, label]) => <option key={key} value={key}>{VARIANT_HINTS[key] ? `${label} (${VARIANT_HINTS[key]})` : label}</option>)}
        </select>
      </label>
      <p className={`text-xs sm:pb-2.5 ${stale ? "text-white/40" : "text-white/60"}`} role="status" data-testid={`${testId}-surface`}>
        {surface?.text ? `${surface.text}${ink}` : `Fassung nach der Shirtfarbe.${ink}`}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Dateien je Farbe

function FileStates({ productId, row, mode, editable, busy, onUpload }) {
  const files = row?.files || [];
  const [chosen, setChosen] = useState({});
  if (!files.length) return <p className="text-xs text-white/50">Nach dem Speichern steht hier je Farbe die Druckdatei.</p>;
  return (
    <ul className="space-y-1.5" data-testid={`shop-files-${row.key}`}>
      {files.map((state) => {
        const key = `${state.color}|${state.group || "all"}`;
        return (
          <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid={`shop-file-${row.key}-${state.color}`} data-state={state.state}>
            <span className="font-bold min-w-[5rem]">{state.color_label || state.color}</span>
            <span className={`inline-flex items-center gap-1 ${STATE_TONES[state.state] || "text-white/60"}`}>
              {state.state === "ok" ? <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> : <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />}
              {STATE_TEXT[state.state] || state.state}{state.file?.version ? ` · v${state.file.version}` : ""}
            </span>
            {state.file?.warnings?.length > 0 && <span className="text-honor" title={state.file.warnings.join(" ")}>Hinweis</span>}
            {state.state !== "ok" && state.state !== "not_needed" && state.detail && <span className="text-white/55 basis-full">{state.detail}</span>}
            <a href={resolveMediaUrl(`/api${BASE}/${productId}/preview?placement=${encodeURIComponent(row.key)}&color=${encodeURIComponent(state.color)}`)} target="_blank" rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-brand hover:underline" data-testid={`shop-file-${row.key}-${state.color}-preview`}>
              <ImageIcon className="w-3 h-3" aria-hidden="true" /> Vorschau
            </a>
            {state.file?.id && (
              <a href={resolveMediaUrl(`/api${BASE}/${productId}/print-files/${state.file.id}`)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand hover:underline">
                Druckdatei <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
            {state.background?.id && state.background.id !== state.file?.id && (
              <a href={resolveMediaUrl(`/api${BASE}/${productId}/print-files/${state.background.id}`)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand hover:underline" data-testid={`shop-file-${row.key}-${state.color}-background`}>
                Hintergrund{state.background.version ? ` v${state.background.version}` : ""} <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            )}
            {mode === "upload" && editable && (
              <span className="flex flex-wrap items-center gap-2 basis-full min-w-0">
                <label className="sr-only" htmlFor={`shop-upload-${row.key}-${state.color}`}>Hintergrund für {state.color_label || state.color}</label>
                <input id={`shop-upload-${row.key}-${state.color}`} type="file" accept="image/png,image/jpeg" className="text-xs min-w-0 max-w-full sm:max-w-[14rem]"
                  onChange={(event) => setChosen({ ...chosen, [key]: event.target.files?.[0] || null })} data-testid={`shop-upload-${row.key}-${state.color}`} />
                <button type="button" disabled={!chosen[key] || busy === `upload-${key}`} className={SMALL_BTN}
                  onClick={() => onUpload(row.key, state.color, state.group, chosen[key], key)} data-testid={`shop-upload-${row.key}-${state.color}-submit`}>
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" /> {busy === `upload-${key}` ? "Lädt …" : "Hochladen und prüfen"}
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- Eine Fläche

function PlacementCard({ view, available, state, savedRow, used, onToggle, onChange, colors, colorName, previewColor, codes, motifsByKey, sources, infos = {}, backgrounds = {}, problem = null, stale, editable, busy, onUpload }) {
  const area = areaOf(available);
  const presets = view.presets || [];
  const motifPresets = presets.filter((preset) => available.presets.motif.includes(preset.key));
  const textPresets = presets.filter((preset) => available.presets.text.includes(preset.key));
  const rules = view.preset_rules || {};
  const personalization = view.product.personalization || "none";
  const [selected, setSelected] = useState(null);
  // Was der Server zum Beispielnamen einer Ebene sagt, wenn er so nicht passt (Review #2105).
  const [sampleProblems, setSampleProblems] = useState({});
  const onSampleProblem = useCallback((index, text) => {
    setSampleProblems((now) => ((now[index] || null) === (text || null) ? now : { ...now, [index]: text || null }));
  }, []);
  const layers = state?.layers || [];
  const mode = state?.mode || "layout";
  // Das Motiv dieser Ebene für die Vorschau-Farbe: die gespeicherte Fassung (hell/dunkel, Version) samt Bild, solange
  // Motiv und Ausnahme unverändert sind - sonst die Hauptdatei des gewählten Motivs.
  const motifFor = (layer, index) => {
    const exception = layer.motif?.by_color?.[previewColor] || "";
    const saved = sources[`${available.key}|${index}|${previewColor}`];
    if (saved && saved.base === layer.motif?.key && saved.exception === exception && saved.aspect) {
      const base = motifsByKey[saved.key] || {};
      return { ...base, key: saved.key, width_px: 1000, height_px: 1000 * saved.aspect, image_path: saved.image_path || base.image_path, variant: saved.variant };
    }
    return motifsByKey[exception || layer.motif?.key];
  };
  // Seit #2141 liegen Motive auch auf einer fertigen Datei (Hintergrund) - alle Ebenen zählen in beiden Arten.
  const visible = layers;
  const hiddenBefore = mode === "upload" && savedRow?.mode === "upload" && savedRow?.motifs_hidden && layers.some((layer) => layer.kind === "motif");
  const saveFirst = mode === "upload" && savedRow?.mode !== "upload";
  const background = mode === "upload" ? backgrounds[`${available.key}|${previewColor}`] : null;
  const backdrop = background?.id ? resolveMediaUrl(`/api${BASE}/${view.product.id}/print-files/${background.id}?thumb=1`) : null;
  const infoFor = (index) => infos[`${available.key}|${index}|${previewColor}`] || null;
  const resolved = resolveLayers(area, visible, {
    presets, motifFor, gamertagCanvas: view.gamertag_canvas, rules,
  });
  const update = (index, patch) => onChange({ ...state, layers: layers.map((layer, at) => (at === index ? { ...layer, ...patch } : layer)) });
  const nudge = (index, dx, dy) => {
    const layer = layers[index];
    update(index, { offset_x_cm: round1(Number(layer.offset_x_cm || 0) + dx), offset_y_cm: round1(Number(layer.offset_y_cm || 0) + dy) });
  };
  const add = (kind) => {
    const preset = kind === "motif" ? motifPresets[0] : (textPresets.find((item) => item.follow === "opposite" && layers.some((layer) => layer.kind === "motif")) || textPresets.find((item) => !item.follow) || textPresets[0]);
    if (!preset) return;
    const motif = view.motif_options?.[0];
    const aspect = motif?.width_px ? motif.height_px / motif.width_px : 1;
    // Fester Text (#2142): mittig, 3 cm hoch, so breit wie die Fläche es erlaubt (höchstens 25 cm) - etwa der Vereinsname.
    const textPreset = textPresets.find((item) => !item.follow) || preset;
    const clubText = (view.print_sets || []).flatMap((set) => set.layers || []).find((item) => item.kind === "text")?.text || "VEREINSNAME";
    const layer = kind === "motif"
      ? { kind, preset: preset.key, width_cm: Math.min(preset.width_cm, maxWidthCm(area, aspect, rules)), offset_x_cm: 0, offset_y_cm: 0, motif: { key: motif?.key || "", by_color: {} } }
      : kind === "text"
        ? { kind, preset: textPreset.key, text: clubText, text_height_cm: 3, max_width_cm: Math.min(25, textBoundsCm(area, rules, view.gamertag_canvas, { kind }).width), offset_x_cm: 0, offset_y_cm: 0 }
        : { kind, preset: preset.key, offset_x_cm: 0, offset_y_cm: 0 };
    // Motive vor die Namen - wie der Server beim Speichern sortiert (shop_products._clean_layout): so stimmen Nummern,
    // Fassung und Farbe aus dem Plan schon im Entwurf (Review #2141).
    const firstName = layers.findIndex((item) => item.kind !== "motif");
    const at = kind === "motif" && firstName >= 0 ? firstName : layers.length;
    onChange({ ...state, layers: [...layers.slice(0, at), layer, ...layers.slice(at)] });
    setSelected(at);
    setSampleProblems({});
  };
  // Trikot-Vorlagen (#2142): ein Klick setzt alle Ebenen dieser Fläche - gespeichert wird erst mit „Druckflächen
  // speichern“. Ein Motiv behält das schon gewählte.
  const sets = (view.print_sets || []).filter((set) => (set.families || []).includes(available.family));
  const [setNotice, setSetNotice] = useState(null);
  const applySet = (set) => {
    const motifKey = layers.find((layer) => layer.kind === "motif")?.motif?.key || view.motif_options?.[0]?.key || "";
    const next = layersFromSet(set, { motifKey });
    onChange({ ...state, layers: next });
    setSelected(null);
    setSampleProblems({});
    setSetNotice([`Vorlage „${set.label}“ gesetzt: ${next.length} ${next.length === 1 ? "Ebene" : "Ebenen"} - übernommen erst mit „Druckflächen speichern“.`, ...(set.skipped || [])].join(" "));
  };
  // Je Farbe die passende Printful-Vorlage, sonst vom Server eingefärbt (#2105) - nie das helle Foto unter Schwarz.
  const preview = available.preview_by_color?.[previewColor] || available.preview;
  const kinds = view.labels.kinds || {};
  const surcharge = savedRow && !savedRow.included && savedRow.surcharge_cents ? ` · Aufpreis ${(savedRow.surcharge_cents / 100).toFixed(2).replace(".", ",")} €` : "";
  const resolvedFor = (index) => resolved.find((item) => item.index === index);
  return (
    <li className={`border rounded-sm p-3 bg-black/20 space-y-3 scroll-mt-24 transition-colors duration-150 ${problem ? "border-warn/70" : "border-white/10"}`} data-testid={`shop-area-${available.key}`} data-blocked={problem ? "true" : undefined}>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm font-bold min-h-10 cursor-pointer">
          <input type="checkbox" checked={used} disabled={!editable} onChange={(event) => onToggle(event.target.checked)} className="w-4 h-4 accent-brand" data-testid={`shop-area-use-${available.key}`} />
          {available.label}
        </label>
        {available.label_translated === false && <span className="text-xs text-honor" data-testid={`shop-area-label-english-${available.key}`}>Bezeichnung von Printful (englisch) - keine Übersetzung bekannt</span>}
        <span className="text-xs text-white/50 tabular-nums" data-testid={`shop-area-size-${available.key}`}>Druckdatei {sizeText(available.file)}{surcharge}</span>
        {available.groups.length > 1 && <span className="text-xs text-honor">Je Größe eine eigene Fläche ({available.groups.length})</span>}
      </div>
      {problem && <p className="text-xs text-warn inline-flex items-center gap-1" role="alert" data-testid={`shop-area-problem-${available.key}`}><AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {problem}</p>}
      {used && (
        <>
          <div className="space-y-1.5">
            <div role="radiogroup" aria-label={`Art von ${available.label}`} className="flex flex-wrap gap-2">
              {Object.entries(view.labels.modes || {}).map(([key, label]) => (
                <button key={key} type="button" role="radio" aria-checked={mode === key} disabled={!editable} onClick={() => onChange({ ...state, mode: key })}
                  className={`min-h-9 px-3 text-xs border rounded-sm transition-colors duration-150 ${mode === key ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
                  data-testid={`shop-area-mode-${available.key}-${key}`}>{label}</button>
              ))}
            </div>
            {view.labels.mode_hints?.[mode] && <p className="text-xs text-white/55 max-w-2xl" data-testid={`shop-area-mode-hint-${available.key}`}>{view.labels.mode_hints[mode]}</p>}
            {saveFirst && (
              <p className="text-xs text-honor inline-flex items-center gap-1" role="status" data-testid={`shop-area-save-first-${available.key}`}>
                <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> Erst speichern, dann je Farbe hochladen.
              </p>
            )}
            {hiddenBefore && (
              <p className="text-xs text-honor" role="status" data-testid={`shop-area-motifs-hidden-${available.key}`}>
                Diese Motive wurden bisher nicht gedruckt (gespeichert vor dem Hintergrund-Modus). Nach dem Speichern liegen sie auf dem Hintergrund.
              </p>
            )}
          </div>
          <div className="grid gap-4 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <div className="space-y-1">
              <LayoutPreview stale={stale} area={{ ...area, safe_margin_cm: available.safe_margin_cm }} preview={preview} layers={visible}
                resolved={resolved} colorCode={codes[previewColor]} motifFor={motifFor} selected={selected} onSelect={setSelected}
                sampleFor={previewColor ? (kind, layer) => {
                  // Die Farbe des Namens aus dem Plan, sobald der Untergrund entschieden ist (Hintergrund, Vorgabe, von Hand).
                  const index = layers.indexOf(layer);
                  const info = index >= 0 ? infoFor(index) : null;
                  const planned = info?.ink && (info.ink.fixed || info.surface?.variant) ? info.ink.key : null;
                  return nameSample(view.product.id, kind, previewColor, layer, layer.ink || planned);
                } : null}
                onSampleProblem={onSampleProblem}
                onNudge={nudge} backdrop={backdrop}
                editable={editable} testId={`shop-preview-${available.key}`} />
              {!preview?.image_path && <p className="text-xs text-honor" data-testid={`shop-preview-${available.key}-no-image`}>Kein Vorlagenbild von Printful - die Vorschau zeigt nur die Druckfläche, Maße und Druckdatei stimmen trotzdem.</p>}
              {mode === "upload" && !background && <p className="text-xs text-white/50" data-testid={`shop-preview-${available.key}-no-backdrop`}>Für {colorName(previewColor)} ist noch kein Hintergrund hochgeladen.</p>}
              {mode === "upload" && background && background.ok === false && <p className="text-xs text-honor" role="status" data-testid={`shop-preview-${available.key}-backdrop-outdated`}>Dieser Hintergrund passt nicht mehr zur Vorlage von Printful - bis er neu hochgeladen ist, richten sich Fassung und Farbe nach der Shirtfarbe.</p>}
              <p className="text-xs text-white/45 inline-flex items-center gap-1"><Move className="w-3 h-3" aria-hidden="true" /> Ziehen oder Pfeiltasten zum Feinjustieren.</p>
            </div>
            <div className="space-y-3">
              {mode === "upload" && <p className="text-xs text-white/60" data-testid={`shop-area-upload-hint-${available.key}`}>Je Farbe eine fertige Datei der ganzen Fläche als Hintergrund: genau {available.file.width_px} × {available.file.height_px} px (oder größer im selben Seitenverhältnis). Motive, Gamertag und Vereinsnummer kommen als Ebenen darüber. Ob die Datei echte Details hat oder nur hochskaliert ist, misst keine Prüfung - am Muster prüfen.</p>}
              {layers.map((layer, index) => {
                const found = resolvedFor(index);
                const motif = motifsByKey[layer.motif?.key];
                return (
                  <div key={index} className={`border rounded-sm p-3 transition-colors duration-150 ${selected === index ? "border-brand/60" : "border-white/10"}`} onFocusCapture={() => setSelected(index)}>
                    <div className="text-xs font-bold uppercase tracking-wider text-white/60 mb-2">{kinds[layer.kind] || layer.kind}</div>
                    {layer.kind === "motif" ? (
                      <MotifLayer layer={layer} area={area} presets={motifPresets} motifs={view.motif_options || []} colors={colors} colorName={colorName}
                        minWidth={view.limits?.min_width_cm || 1} rules={rules} aspect={motif?.width_px ? motif.height_px / motif.width_px : 1} editable={editable}
                        onChange={(patch) => update(index, patch)} onRemove={() => onChange({ ...state, layers: layers.filter((_, at) => at !== index) })}
                        testId={`shop-layer-${available.key}-${index}`} />
                    ) : (
                      <TextLayer layer={layer} area={{ ...area, safe_margin_cm: available.safe_margin_cm }} rules={rules} canvas={view.gamertag_canvas} presets={textPresets} inks={view.name_inks || []} fonts={view.fonts || []}
                        kindLabel={KIND_SHORT[layer.kind] || layer.kind} editable={editable} problem={found?.problem || sampleProblems[index]}
                        onChange={(patch) => update(index, patch)} onRemove={() => onChange({ ...state, layers: layers.filter((_, at) => at !== index) })}
                        testId={`shop-layer-${available.key}-${index}`} />
                    )}
                    <SurfaceField layer={layer} info={infoFor(index)} labels={view.labels.layer_variants} editable={editable} stale={stale}
                      onChange={(patch) => update(index, patch)} testId={`shop-layer-${available.key}-${index}`} />
                    <AlignTools area={area} item={found} above={layerAbove(resolved, index)} layer={layer} editable={editable}
                      onChange={(patch) => update(index, patch)} testId={`shop-layer-${available.key}-${index}`} />
                    {found?.outside?.length > 0 && <p className="text-xs text-warn mt-2" role="alert" data-testid={`shop-layer-${available.key}-${index}-outside`}>Ragt {found.outside.join(" und ")} aus der Fläche - kleiner setzen oder zurück auf die Vorgabe.</p>}
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!editable || layers.length >= (view.limits?.max_layers || 6) || !motifPresets.length} onClick={() => add("motif")} className={SMALL_BTN} data-testid={`shop-area-add-motif-${available.key}`}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Motiv</button>
                {["gamertag", "both"].includes(personalization) && !layers.some((layer) => layer.kind === "gamertag") && <button type="button" disabled={!editable || !textPresets.length} onClick={() => add("gamertag")} className={SMALL_BTN} data-testid={`shop-area-add-gamertag-${available.key}`}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Gamertag</button>}
                {["member_number", "both"].includes(personalization) && !layers.some((layer) => layer.kind === "member_number") && <button type="button" disabled={!editable || !textPresets.length} onClick={() => add("member_number")} className={SMALL_BTN} data-testid={`shop-area-add-member_number-${available.key}`}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Vereinsnummer</button>}
                <button type="button" disabled={!editable || layers.length >= (view.limits?.max_layers || 6) || !textPresets.length} onClick={() => add("text")} className={SMALL_BTN} data-testid={`shop-area-add-text-${available.key}`}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Fester Text</button>
              </div>
              {sets.length > 0 && (
                <div className="space-y-1.5" data-testid={`shop-area-sets-${available.key}`}>
                  <div className="text-xs text-white/60">Vorlage mit einem Klick - ersetzt die Ebenen dieser Fläche:</div>
                  <div className="flex flex-wrap gap-2">
                    {sets.map((set) => (
                      <button key={set.key} type="button" disabled={!editable} onClick={() => applySet(set)} title={set.hint || undefined} className={SMALL_BTN} data-testid={`shop-area-set-${available.key}-${set.key}`}>
                        <LayoutTemplate className="w-3.5 h-3.5" aria-hidden="true" /> {set.label}
                      </button>
                    ))}
                  </div>
                  {setNotice && <p className="text-xs text-honor" role="status" data-testid={`shop-area-set-notice-${available.key}`}>{setNotice}</p>}
                </div>
              )}
              <div className="border-t border-white/10 pt-2">
                <div className="text-xs font-bold uppercase tracking-wider text-white/60 mb-1.5">Druckdateien je Farbe</div>
                <FileStates productId={view.product.id} row={savedRow} mode={savedRow?.mode || mode} editable={editable} busy={busy} onUpload={onUpload} />
              </div>
            </div>
          </div>
        </>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- Der ganze Schritt

export function TemplateStatus({ view, busy, run }) {
  const template = view.print_template;
  if (!view.product.printful) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="shop-template-status">
      <span className={!template?.loaded || template?.last_error ? "text-warn" : "text-white/60"}>
        {!template?.loaded ? "Noch keine Druckvorlage von Printful." : `Druckvorlage von Printful, abgeglichen ${viennaDateTime(template.checked_at)}.`}
        {template?.last_error ? ` Letzter Versuch gescheitert: ${template.last_error.detail}` : ""}
      </span>
      <button type="button" disabled={busy === "templates"} onClick={() => run("templates", () => api.post(`${BASE}/${view.product.id}/print-templates/refresh`, { reason: "" }),
        (next) => (next.template_result?.changed ? `Printful hat Maße geändert: ${next.template_result.changes.length} Flächen.` : next.template_result?.warning ? "Druckvorlagen abgeglichen – mit Warnung, siehe oben." : next.template_result?.ok ? "Druckvorlagen aktuell." : "Printful nicht erreichbar – letzter Stand bleibt."))}
        className={SMALL_BTN} data-testid="shop-template-refresh">
        <RefreshCw className={`w-3.5 h-3.5 ${busy === "templates" ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" /> Vorlagen neu laden
      </button>
      {template?.warning && <p className="basis-full text-honor inline-flex items-center gap-1" role="status" data-testid="shop-template-carried"><AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {template.warning}</p>}
      {template?.skipped?.length > 0 && (
        <ul className="basis-full text-warn space-y-0.5" data-testid="shop-template-skipped">{template.skipped.map((line) => <li key={line}>{line}</li>)}</ul>
      )}
      {template?.changes?.length > 0 && template?.changed_at && (
        <div className="basis-full border border-honor/40 bg-honor/10 rounded-sm p-2" role="status" data-testid="shop-template-changes">
          <div className="font-bold">Printful hat die Vorlage geändert ({viennaDateTime(template.changed_at)})</div>
          <ul className="mt-1 space-y-0.5">{template.changes.map((change) => <li key={change}>{change}</li>)}</ul>
          <p className="mt-1 text-white/60">Betroffene Druckdateien sind „veraltet“ - bitte neu erzeugen.</p>
        </div>
      )}
    </div>
  );
}

// Der gespeicherte Aufbau von Schritt 3 als Schlüssel (#2091, Review): nur wenn er sich ändert (Speichern, anderes
// Produkt oder Technik), beginnt der Schritt neu. Ein neuer `view` nach Abgleich, Motiv-Upload oder Erzeugen der
// Druckdateien lässt ungespeicherte Flächen stehen.
export function layoutKey(view) {
  return JSON.stringify([view.product.id, view.product.printful?.product_id ?? null, view.product.technique ?? null,
    (view.placements || []).map((row) => [row.key, row.mode || "layout", row.layers || [], !!row.motifs_hidden]), view.included_placement || null,
    view.product.print_surface || "garment"]);
}

export default function LayoutStep({ view, busy, run, ReasonedButton, ChoiceGroup }) {
  const { product } = view;
  const [draft, setDraft] = useState(() => draftFrom(view));
  const [included, setIncluded] = useState(view.included_placement || "");
  const colors = useMemo(() => product.offer?.colors || [], [product.offer]);
  const [previewColor, setPreviewColor] = useState(colors[0] || "");
  useEffect(() => { if (!colors.includes(previewColor)) setPreviewColor(colors[0] || ""); }, [colors, previewColor]);
  const codes = useMemo(() => Object.fromEntries((product.printful?.colors || []).map((color) => [color.name, color.code])), [product.printful]);
  // Angezeigt wird die deutsche Bezeichnung (#2105); Schlüssel bleibt der Printful-Name.
  const colorName = (color) => view.color_labels?.[color] || color;
  const motifsByKey = useMemo(() => Object.fromEntries((view.motif_options || []).map((motif) => [motif.key, motif])), [view.motif_options]);
  const sources = useMemo(() => savedSources(view), [view]);
  const infos = useMemo(() => planLayers(view), [view]);
  const backgrounds = useMemo(() => backgroundsOf(view), [view]);
  const savedSurface = product.print_surface || "garment";
  const [surface, setSurface] = useState(savedSurface);
  const savedRows = Object.fromEntries((view.placements || []).map((row) => [row.key, row]));
  const available = view.available_placements || [];
  const used = available.filter((row) => draft[row.key]);
  const payload = used.map((row) => ({ key: row.key, mode: draft[row.key].mode || "layout", layers: draft[row.key].layers.map(cleanLayer) }));
  // Was die Fläche blockiert - mit Namen der Flächen, damit klar ist, wo (Nachtrag #2141). Ein Motiv ohne Auswahl
  // zählt in beiden Arten; leer darf nur eine fertige Datei sein.
  const missingMotif = used.filter((row, at) => payload[at].layers.some((layer) => layer.kind === "motif" && !layer.motif.key));
  const emptyArea = used.filter((row, at) => payload[at].mode === "layout" && !payload[at].layers.length);
  // Ein fester Text (#2142) braucht Text.
  const missingText = used.filter((row, at) => payload[at].layers.some((layer) => layer.kind === "text" && !layer.text.trim()));
  const usedKeys = used.map((row) => row.key);
  const includedValue = usedKeys.includes(included) ? included : (usedKeys.includes("front") ? "front" : usedKeys[0] || null);
  const names = (rows) => rows.map((row) => `„${row.label}“`).join(", ");
  const blockedAreas = missingMotif.length ? missingMotif : missingText.length ? missingText : emptyArea;
  const blocked = !payload.length ? "Mindestens eine Fläche wählen."
    : missingMotif.length ? `Für jedes Motiv bitte ein Motiv aus der Liste wählen: ${names(missingMotif)}.`
      : missingText.length ? `Jeder feste Text braucht einen Text: ${names(missingText)}.`
        : emptyArea.length ? `Jede gewählte Fläche braucht ein Motiv oder einen Platzhalter: ${names(emptyArea)}.` : null;
  const areaProblem = (key) => (missingMotif.some((row) => row.key === key) ? "Hier fehlt die Auswahl eines Motivs."
    : missingText.some((row) => row.key === key) ? "Hier fehlt der Text eines festen Texts."
      : emptyArea.some((row) => row.key === key) ? "Hier fehlt ein Motiv oder ein Platzhalter - oder „Fertige Druckdatei als Hintergrund“ wählen." : null);
  const payloadJson = JSON.stringify({ placements: payload, print_surface: surface });
  const hiddenSaved = (view.placements || []).some((row) => row.motifs_hidden && (row.layers || []).some((layer) => layer.kind === "motif"));
  // `edited`: wirklich ungespeicherte Änderungen - nur sie sperren „Druckdateien erzeugen“. Ausgeblendete Motive von
  // vor #2141 machen nur das Speichern frei (ein veröffentlichtes Produkt kann nicht speichern, aber erzeugen).
  const edited = JSON.stringify(payload) !== JSON.stringify((view.placements || []).map((row) => ({ key: row.key, mode: row.mode || "layout", layers: (row.layers || []).map(cleanLayer) })))
    || includedValue !== (view.included_placement || null) || view.layout_converted || surface !== savedSurface;
  const changed = edited || hiddenSaved;
  const failedFiles = (view.placements || []).flatMap((row) => row.files || []).filter((state) => ["missing", "outdated"].includes(state.state));
  // Ungespeicherter Stand: der Server rechnet die Pläne (Fassung je Shirtfarbe, Bild, Seitenverhältnis) - eine Wahrheit
  // für Vorschau und Druck. Gedrosselt; bis die Antwort da ist, ist die Vorschau ausgegraut.
  const [draftPreview, setDraftPreview] = useState({ json: null, sources: null, infos: null, backgrounds: null, error: "" });
  const previewWanted = !!product.printful && available.length > 0 && changed && !blocked;
  useEffect(() => {
    if (!previewWanted) return undefined;
    let live = true;
    const timer = setTimeout(async () => {
      const body = JSON.parse(payloadJson);
      const layers = Object.fromEntries(body.placements.map((row) => [row.key, row.layers]));
      try {
        const { data } = await api.post(`${BASE}/${product.id}/layout/preview`, body);
        const rows = (data?.placements || []).map((row) => ({ ...row, layers: layers[row.key] || [] }));
        if (live) setDraftPreview({ json: payloadJson, sources: savedSources({ placements: rows }), infos: planLayers({ placements: rows }), backgrounds: backgroundsOf({ placements: rows }), error: "" });
      } catch (failure) {
        if (live) setDraftPreview({ json: payloadJson, sources: null, infos: null, backgrounds: null, error: formatRequestError(failure, "Die Vorschau lässt sich gerade nicht berechnen.") });
      }
    }, DRAFT_PREVIEW_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [previewWanted, payloadJson, product.id, product.printful]);
  const draftReady = previewWanted && draftPreview.json === payloadJson && !!draftPreview.sources;
  // Ungespeichert und noch nicht vom Server bestätigt: nur die Ebenen gedimmt, nie das Shirt (#2105). Ohne Berechnung
  // (nichts gewählt, blockiert) wird nichts gedimmt - es steht nur der Hinweis da.
  const pending = changed && !draftReady;
  const stale = previewWanted && !draftReady;
  const shownSources = draftReady ? draftPreview.sources : sources;
  const shownInfos = draftReady ? draftPreview.infos : infos;
  // Hintergründe hängen an Fläche und Farbe, nicht am Aufbau - bis die Antwort da ist, gelten die gespeicherten.
  const shownBackgrounds = draftReady ? { ...backgrounds, ...draftPreview.backgrounds } : backgrounds;
  if (!product.printful) return <p className="text-sm text-white/55" data-testid="shop-layout">Zuerst in Schritt 1 das Printful-Produkt laden.</p>;
  if (!available.length) return <div className="space-y-2" data-testid="shop-layout"><TemplateStatus view={view} busy={busy} run={run} /><p className="text-sm text-white/55">Ohne Druckvorlage von Printful lassen sich keine Flächen wählen.</p></div>;

  const onUpload = (placement, color, group, file, key) => {
    const form = new FormData();
    form.append("file", file);
    form.append("product_id", product.id);
    form.append("placement", placement);
    form.append("color", color);
    if (group && group !== "all") form.append("group", group);
    form.append("reason", "");
    // Die Hinweise des Servers mit dazu (verkleinert, mit den Ebenen erzeugt, am Muster prüfen).
    return run(`upload-${key}`, () => uploadApi.post("/admin/shop/print-files/upload", form),
      (next) => [`Datei für ${colorName(color)} geprüft und gespeichert.`, ...(next?.uploaded?.notes || [])].join(" "));
  };
  const jump = () => { if (blockedAreas[0]) scrollToArea(blockedAreas[0].key); };
  return (
    <div className="space-y-4" data-testid="shop-layout">
      <TemplateStatus view={view} busy={busy} run={run} />
      {view.layout_converted && <p className="text-xs text-honor" data-testid="shop-layout-converted">Aus den alten Zoll-Positionen umgerechnet - bitte prüfen und speichern.</p>}
      {view.layout_blocked?.length > 0 && (
        <div className="border border-live/50 bg-live/10 text-live rounded-sm p-2 text-xs" role="alert" data-testid="shop-layout-blocked">
          <div className="font-bold">Nicht bestellbar: diese alten Platzierungen lassen sich nicht abbilden. Bitte die Flächen hier neu setzen und speichern.</div>
          <ul className="mt-1 space-y-0.5">{view.layout_blocked.map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      {pending && (
        <p className="text-xs text-honor" role="status" data-testid="shop-layout-draft-preview">
          {draftPreview.error && draftPreview.json === payloadJson ? `Vorschau: ${draftPreview.error}` : blocked ? "Vorschau nach dem Speichern." : "Vorschau wird berechnet …"}
        </p>
      )}
      {available[0]?.technique && <p className="text-xs text-white/55" data-testid="shop-layout-technique">Flächen für {techniqueLabel(available[0].technique)} - die Technik wird in Schritt 2 gewählt.</p>}
      <p className="text-xs text-white/55 max-w-3xl">Je Fläche: Motiv, Position aus der Liste und Größe in cm. Die Website erzeugt die Druckdatei in der exakten Größe von Printful - das Motiv an seiner Stelle, der Rest durchsichtig. Positionen „vom Träger aus“: Brust rechts liegt von vorne gesehen links.</p>
      {colors.length > 0 && (
        <div className="space-y-1">
          <div className="text-sm text-white/70">Vorschau auf</div>
          <div role="radiogroup" aria-label="Shirtfarbe der Vorschau" className="flex flex-wrap gap-2">
            {colors.map((color) => (
              <button key={color} type="button" role="radio" aria-checked={previewColor === color} onClick={() => setPreviewColor(color)}
                className={`min-h-9 px-3 text-xs border rounded-sm inline-flex items-center gap-2 transition-colors duration-150 ${previewColor === color ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
                data-testid={`shop-preview-color-${color}`}>
                <span className="w-3.5 h-3.5 rounded-sm border border-white/25" style={{ backgroundColor: codes[color] }} aria-hidden="true" /> {colorName(color)}
              </button>
            ))}
          </div>
        </div>
      )}
      <ul className="space-y-3">
        {available.map((row) => (
          <PlacementCard key={row.key} view={view} available={row} state={draft[row.key]} savedRow={savedRows[row.key]} used={!!draft[row.key]}
            onToggle={(on) => setDraft((now) => {
              const next = { ...now };
              if (on) next[row.key] = { mode: "layout", layers: [] };
              else delete next[row.key];
              return next;
            })}
            onChange={(next) => setDraft((now) => ({ ...now, [row.key]: next }))}
            colors={colors} colorName={colorName} previewColor={previewColor} codes={codes} motifsByKey={motifsByKey} sources={shownSources}
            infos={shownInfos || {}} backgrounds={shownBackgrounds} problem={areaProblem(row.key)} stale={stale} editable={view.editable} busy={busy} onUpload={onUpload} />
        ))}
      </ul>
      <div className="space-y-1 max-w-xl">
        <label className="block text-sm"><span className="text-white/70">Untergrund gilt als</span>
          <select value={surface} disabled={!view.editable} onChange={(event) => setSurface(event.target.value)} className={SELECT} data-testid="shop-layout-surface">
            {Object.entries(view.labels.surfaces || { garment: "wie Printful-Farbe", light: "hell", dark: "dunkel" }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <p className="text-xs text-white/45">Entscheidet über die Fassung der Motive (hell oder dunkel) und die Farbe von Gamertag und Vereinsnummer, wo kein Hintergrund darunter liegt - etwa bei Allover mit Grundfarbe „weiß“. Liegt ein Hintergrund darunter, zählt dessen Helligkeit unter der Ebene.</p>
      </div>
      {blocked && blockedAreas.length > 0 && (
        <div className="border border-warn/50 bg-warn/10 rounded-sm p-2 text-xs space-y-1.5" role="alert" data-testid="shop-layout-blocked-areas">
          <p>{blocked}</p>
          <div className="flex flex-wrap gap-2">
            {blockedAreas.map((row) => (
              <button key={row.key} type="button" onClick={() => scrollToArea(row.key)} className={QUIET_BTN} data-testid={`shop-layout-jump-${row.key}`}>Zu „{row.label}“</button>
            ))}
          </div>
        </div>
      )}
      {usedKeys.length > 1 && (
        <div className="space-y-1">
          <div className="text-sm text-white/70">Im Grundpreis von Printful enthalten</div>
          <ChoiceGroup label="Im Grundpreis enthalten" testId="shop-layout-included" value={includedValue} onChange={setIncluded}
            options={used.map((row) => ({ value: row.key, label: row.label }))} />
          <p className="text-xs text-white/45">Jede weitere Fläche kostet ihren Aufpreis (etwa die Rückseite). Mit der Kostenschätzung im Testentwurf (#2062) gegenprüfen.</p>
        </div>
      )}
      <ReasonedButton id="shop-layout" label="Druckflächen speichern" busy={busy === "layout"} disabled={!view.editable || !!blocked || !changed}
        blockedHint={!view.editable ? "Erst zurückziehen (Schritt 5), dann die Druckflächen ändern." : blocked || "Noch nichts geändert."}
        onBlocked={view.editable ? jump : undefined}
        onSubmit={(reason) => run("layout", () => api.put(`${BASE}/${product.id}/layout`, { placements: payload, included_placement: includedValue, print_surface: surface, reason }), "Druckflächen gespeichert.")} />
      <div className="border-t border-white/10 pt-3 space-y-2" data-testid="shop-generate">
        <p className="text-xs text-white/55">{failedFiles.length ? `${failedFiles.length} Druckdatei${failedFiles.length === 1 ? "" : "en"} fehlen oder sind veraltet.` : "Alle Druckdateien sind aktuell."}</p>
        <ReasonedButton id="shop-generate" label="Druckdateien erzeugen" variant="secondary" busy={busy === "generate"} disabled={view.product.status === "archived" || edited}
          blockedHint={edited ? "Erst die Druckflächen speichern, dann erzeugen." : "Archiviert: erst wieder als Entwurf öffnen."}
          hint="Erzeugt je Fläche und Farbe nur, was fehlt oder veraltet ist - exakt in der Pixelgröße von Printful."
          onSubmit={(reason) => run("generate", () => api.post(`${BASE}/${product.id}/print-files`, { reason }), (next) => {
            const result = next.result || {};
            const failed = result.failed?.length || 0;
            return `${result.created?.length || 0} Druckdatei${result.created?.length === 1 ? "" : "en"} erzeugt${failed ? `, ${failed} nicht möglich - siehe Prüfung` : ""}.`;
          })} />
        <p className="text-xs text-white/45 inline-flex items-center gap-1"><Wand2 className="w-3 h-3" aria-hidden="true" /> Motive kommen aus dem Reiter „Designs“.</p>
      </div>
    </div>
  );
}
