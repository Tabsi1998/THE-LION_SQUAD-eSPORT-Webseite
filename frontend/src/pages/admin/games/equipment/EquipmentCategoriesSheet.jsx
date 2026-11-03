// Kategorien der Ausrüstung je Spiel (#2218): Name und Art (Waffe, Aufsatz, sonstige). Die Kennung bleibt beim Umbenennen; eine
// Kategorie mit Einträgen lässt sich nicht entfernen und ihre Art nicht ändern - der Server sagt es, die Oberfläche sperrt es vorab.
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { categoriesPayload, categoriesProblem, ROLE_LABELS } from "@/lib/loadoutBans";
import { toast } from "sonner";

const ICON_BUTTON = "p-1.5 rounded-sm text-white/60 hover:text-[#29B6E8] disabled:opacity-30 disabled:hover:text-white/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";
const ROLE_OPTIONS = Object.entries(ROLE_LABELS);

export function EquipmentCategoriesSheet({ game, categories, suggested = [], limit = 20, onClose, onSaved }) {
  const [rows, setRows] = useState(() => (categories.length ? categories : suggested).map((row) => ({ ...row, count: row.count || 0 })));
  const [saving, setSaving] = useState(false);
  const set = (index, key, value) => setRows((list) => list.map((row, position) => (position === index ? { ...row, [key]: value } : row)));
  const move = (index, delta) => setRows((list) => {
    const next = [...list];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    return next;
  });
  const problem = categoriesProblem(rows);

  const submit = async (event) => {
    event.preventDefault();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/games/${game.id}/equipment/categories`, { categories: categoriesPayload(rows) });
      toast.success("Kategorien gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title="Kategorien" eyebrow={game.name} onClose={onClose} onSubmit={submit} saving={saving} size="lg"
      submitTestId="equipment-categories-save" testId="equipment-categories-sheet">
      <p className="text-sm text-white/65">
        Die Art entscheidet, was geht: An einer <strong className="text-white">Waffe</strong> lassen sich einzelne Aufsätze sperren, ein
        <strong className="text-white"> Aufsatz</strong> passt zu Waffen, alles andere ist <strong className="text-white">sonstige Ausrüstung</strong>.
      </p>
      {!categories.length && suggested.length ? (
        <p className="text-xs text-[#29B6E8]" data-testid="equipment-categories-suggested">Vorschlag – passe Namen an oder entferne, was das Spiel nicht hat. Gespeichert wird erst mit „Speichern“.</p>
      ) : null}
      <ol className="space-y-2" data-testid="equipment-categories-list">
        {rows.map((row, index) => (
          <li key={row.key || `neu-${index}`} className="flex flex-wrap items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] p-2 sm:flex-nowrap" data-testid="equipment-category-row">
            <input value={row.label} maxLength={40} onChange={(event) => set(index, "label", event.target.value)} aria-label={`Name der Kategorie ${index + 1}`}
              className="min-w-0 flex-1 basis-40 rounded-sm border border-white/15 bg-[#121212] px-2.5 py-1.5 text-sm text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]" />
            <select value={row.role} disabled={row.count > 0} onChange={(event) => set(index, "role", event.target.value)} aria-label={`Art der Kategorie ${index + 1}`}
              title={row.count > 0 ? "Hat schon Einträge – die Art bleibt." : undefined}
              className="rounded-sm border border-white/15 bg-[#121212] px-2 py-1.5 text-sm text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
              {ROLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-white/55">{row.count ? `${row.count} Eintr.` : "leer"}</span>
            <span className="flex shrink-0 items-center">
              <button type="button" className={ICON_BUTTON} onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${row.label || "Kategorie"} nach oben`}><ArrowUp className="h-4 w-4" /></button>
              <button type="button" className={ICON_BUTTON} onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label={`${row.label || "Kategorie"} nach unten`}><ArrowDown className="h-4 w-4" /></button>
              <button type="button" className={ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live")} disabled={row.count > 0}
                onClick={() => setRows((list) => list.filter((_, position) => position !== index))}
                title={row.count > 0 ? "Hat noch Einträge – erst die Einträge löschen." : "Entfernen"} aria-label={`${row.label || "Kategorie"} entfernen`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </span>
          </li>
        ))}
      </ol>
      {problem ? <p className="text-sm text-warn" role="alert">{problem}</p> : null}
      <button type="button" onClick={() => setRows((list) => [...list, { label: "", role: "item", count: 0 }])} disabled={rows.length >= limit}
        data-testid="equipment-category-add" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
        <Plus className="h-3.5 w-3.5" /> Kategorie
      </button>
    </AdminSheet>
  );
}
