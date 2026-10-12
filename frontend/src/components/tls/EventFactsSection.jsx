import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { HIGHLIGHT_ICONS } from "@/lib/eventPage";

// Verwaltung des Fakten-Kastens (#1346) und des Kopfbilds (#1273): „Mitbringen“ als eine Zeile je Punkt, bis zu sechs
// Highlights (Symbol aus der festen Liste + kurzer Text) und wie das Kopfbild steht (Foto füllt, Logo klein auf Fläche)
// mit Fokuspunkt per Klick ins Bild. Die Grenzen prüft der Server noch einmal (services/event_facts.py).

export const HIGHLIGHTS_MAX = 6;
export const BRING_ALONG_MAX = 8;

export function bringToText(list) {
  return (list || []).join("\n");
}

export function textToBring(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function highlightsToForm(list) {
  return (list || []).map((entry) => ({ icon: entry.icon || "star", text: entry.text || "" }));
}

export function formToHighlights(rows) {
  return (rows || []).map((row) => ({ icon: row.icon, text: String(row.text || "").trim() })).filter((row) => row.text);
}

const ICON_OPTIONS = Object.entries(HIGHLIGHT_ICONS);

export function EventFactsSection({ bringText, onBringText, highlights, onHighlights }) {
  const lines = textToBring(bringText);
  const update = (index, patch) => onHighlights(highlights.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  const move = (index, delta) => {
    const next = [...highlights];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row);
    onHighlights(next);
  };
  return (
    <div className="space-y-5" data-testid="event-facts-admin">
      <label className="block">
        <span className="block text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Mitbringen – eine Zeile je Punkt</span>
        <textarea value={bringText} onChange={(ev) => onBringText(ev.target.value)} rows={4} data-testid="event-bring-along"
          placeholder={"eigener Controller\nKopfhörer"} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
        <span className={`block mt-1 text-xs ${lines.length > BRING_ALONG_MAX ? "text-[#FF6B6B]" : "text-white/40"}`}>
          {lines.length} von höchstens {BRING_ALONG_MAX} Zeilen · steht im Fakten-Kasten oben auf der Event-Seite.
        </span>
      </label>
      <div>
        <div className="text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Highlights – Kacheln über dem Text (statt Emoji-Überschriften)</div>
        <ul className="space-y-2" data-testid="event-highlights-admin">
          {highlights.map((row, index) => (
            <li key={`${index}-${row.icon}`} className="flex flex-wrap items-center gap-2">
              <select value={row.icon} onChange={(ev) => update(index, { icon: ev.target.value })} aria-label={`Symbol für Highlight ${index + 1}`}
                data-testid={`event-highlight-icon-${index}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
                {ICON_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <input value={row.text} onChange={(ev) => update(index, { text: ev.target.value })} maxLength={60} aria-label={`Text für Highlight ${index + 1}`}
                data-testid={`event-highlight-text-${index}`} placeholder="z.B. Switch-Stationen" className="flex-1 min-w-[12rem] bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <span className="inline-flex gap-1">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Nach oben" className="p-1.5 text-white/60 hover:text-white disabled:opacity-30"><ArrowUp className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === highlights.length - 1} aria-label="Nach unten" className="p-1.5 text-white/60 hover:text-white disabled:opacity-30"><ArrowDown className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => onHighlights(highlights.filter((_, at) => at !== index))} aria-label="Highlight entfernen" data-testid={`event-highlight-remove-${index}`} className="p-1.5 text-white/60 hover:text-[#FF6B6B]"><Trash2 className="w-3.5 h-3.5" /></button>
              </span>
            </li>
          ))}
        </ul>
        {highlights.length < HIGHLIGHTS_MAX ? (
          <button type="button" onClick={() => onHighlights([...highlights, { icon: "star", text: "" }])} data-testid="event-highlight-add"
            className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#9F7AEA] hover:text-white">
            <Plus className="w-3.5 h-3.5" /> Highlight hinzufügen
          </button>
        ) : <p className="mt-2 text-xs text-white/40">Höchstens {HIGHLIGHTS_MAX} Highlights.</p>}
      </div>
    </div>
  );
}

const BANNER_STYLE_LABELS = [["auto", "Automatisch erkennen"], ["photo", "Foto – füllt das Banner"], ["logo", "Logo – klein auf einer Fläche"]];

export function EventBannerFields({ url, style, focusX, focusY, onChange }) {
  if (!url) return null;
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    onChange({ banner_focus_x: Math.round(((event.clientX - box.left) / box.width) * 100), banner_focus_y: Math.round(((event.clientY - box.top) / box.height) * 100) });
  };
  return (
    <div className="space-y-3" data-testid="event-banner-fields">
      <label className="block">
        <span className="block text-[11px] uppercase tracking-widest text-white/50 font-bold mb-1.5">Kopfbild zeigen als</span>
        <select value={style || "auto"} onChange={(ev) => onChange({ banner_style: ev.target.value })} data-testid="event-banner-style"
          className="w-full sm:w-auto bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
          {BANNER_STYLE_LABELS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span className="block mt-1 text-xs text-white/40">Dasselbe Bild steht auf der Event-Karte. „Automatisch“: Bilder mit durchsichtigem Hintergrund oder wenigen Farben gelten als Logo.</span>
      </label>
      {style !== "logo" ? (
        <div>
          <div className="text-xs text-white/55 mb-1">Fokuspunkt: ins Bild klicken – dieser Punkt bleibt beim Zuschneiden sichtbar ({focusX} % / {focusY} %).</div>
          <button type="button" onClick={pick} className="relative block w-full max-w-md overflow-hidden rounded-sm cursor-crosshair" data-testid="event-banner-focus" aria-label="Fokuspunkt setzen">
            <img src={resolveMediaUrl(url)} alt="" className="block w-full h-auto" />
            <span className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-[#29B6E8]/70 pointer-events-none" style={{ left: `${focusX}%`, top: `${focusY}%` }} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
