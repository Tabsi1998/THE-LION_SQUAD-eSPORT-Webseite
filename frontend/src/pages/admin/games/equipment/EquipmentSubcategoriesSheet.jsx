// Unterkategorien einer Kategorie der Ausrüstung (docs/LIGA.md, C.4 #2287): anlegen, umbenennen, ordnen, entfernen - gespeichert wird
// die ganze Liste mit „Speichern“. Die Kennung bleibt beim Umbenennen und wird nie neu vergeben; eine Unterkategorie mit Einträgen lässt
// sich nicht entfernen (der Server sagt es, die Oberfläche sperrt es vorab). Symbol optional aus dem eigenen Upload, wie das Bild eines
// Eintrags. Der Vorschlag je Art (nur Gattungsbegriffe) fügt nur hinzu, was fehlt, gespeichert erst auf Knopfdruck.
import { useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Sparkles, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { SubcategoryIcon } from "@/components/tls/league/LoadoutBansView";
import { useOptionalAuth } from "@/context/AuthContext";
import { mediaPropsFor } from "@/lib/mediaAccess";
import { missingSuggestions, subcategoriesPayload, subcategoriesProblem } from "@/lib/loadoutBans";
import { toast } from "sonner";
import { useReportDirty } from "./useReportDirty";

const ICON_BUTTON = "p-1.5 rounded-sm text-white/60 hover:text-[#29B6E8] disabled:opacity-30 disabled:hover:text-white/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]";
const ROLE_EXAMPLES = { weapon: "etwa Sturmgewehr, Schrotflinte, Pistole", attachment: "etwa Mündung, Optik, Magazin", item: "etwa nach Einsatzzweck" };

export function EquipmentSubcategoriesSheet({ game, category, counts = {}, suggested = [], limit = 30, onClose, onSaved, onDirtyChange }) {
  const user = useOptionalAuth()?.user;
  const [initial] = useState(() => (category.subcategories || []).map((row) => ({ ...row, icon_url: row.icon_url || "" })));
  const [rows, setRows] = useState(initial);
  const [iconOpen, setIconOpen] = useState(null);
  const [saving, setSaving] = useState(false);
  useReportDirty(JSON.stringify(rows) !== JSON.stringify(initial), onDirtyChange);
  const set = (index, patch) => setRows((list) => list.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  const move = (index, delta) => setRows((list) => {
    const next = [...list];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    return next;
  });
  const missing = missingSuggestions(rows, suggested);
  const problem = subcategoriesProblem(rows);
  const full = rows.length >= limit;

  const addSuggestions = () => setRows((list) => [...list, ...missing.slice(0, Math.max(0, limit - list.length)).map((label) => ({ label, icon_url: "" }))]);
  const submit = async (event) => {
    event.preventDefault();
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      await api.put(`/games/${game.id}/equipment/categories/${category.key}/subcategories`, { subcategories: subcategoriesPayload(rows) });
      toast.success("Unterkategorien gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={`Unterkategorien · ${category.label}`} eyebrow={game.name} onClose={onClose} onSubmit={submit} saving={saving} size="lg"
      submitTestId="equipment-subcategories-save" testId="equipment-subcategories-sheet">
      <p className="text-sm text-white/65">
        Ordne die Einträge in Klassen ({ROLE_EXAMPLES[category.role] || ROLE_EXAMPLES.item}). Die Sperrliste einer Season kann eine ganze
        Klasse sperren – auch Einträge, die später dazukommen. {category.role === "weapon" ? "Aufsätze lassen sich ganzen Waffenklassen zuordnen." : ""}
      </p>
      {missing.length ? (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-[#29B6E8]/30 bg-[#29B6E8]/5 px-3 py-2" data-testid="equipment-subcategories-suggestion">
          <p className="min-w-0 flex-1 basis-56 text-xs text-white/75">
            Vorschlag: {missing.join(", ")}. Passe Namen danach an oder entferne, was das Spiel nicht hat.
          </p>
          <button type="button" onClick={addSuggestions} disabled={full} data-testid="equipment-subcategories-suggest"
            className="tls-btn tls-btn--quiet inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Vorschlag einfügen
          </button>
        </div>
      ) : null}
      {rows.length ? (
        <ol className="space-y-2" data-testid="equipment-subcategories-list">
          {rows.map((row, index) => {
            const count = row.key ? counts[row.key] || 0 : 0;
            const name = row.label || `Unterkategorie ${index + 1}`;
            return (
              <li key={row.key || `neu-${index}`} className="rounded-sm border border-white/10 bg-[#0A0A0A] p-2" data-testid="equipment-subcategory-row">
                <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                  <button type="button" onClick={() => setIconOpen(iconOpen === index ? null : index)} aria-expanded={iconOpen === index}
                    aria-label={`Symbol für ${name}`} title="Symbol (optional)"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-sm border border-white/15 bg-[#121212] text-white/50 hover:border-[#29B6E8]/60 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]">
                    {row.icon_url ? <SubcategoryIcon src={row.icon_url} className="h-6 w-6" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                  </button>
                  <input value={row.label} maxLength={40} onChange={(event) => set(index, { label: event.target.value })} aria-label={`Name der Unterkategorie ${index + 1}`}
                    className="min-w-0 flex-1 basis-40 rounded-sm border border-white/15 bg-[#121212] px-2.5 py-1.5 text-sm text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8]" />
                  <span className="w-20 shrink-0 text-right text-[11px] tabular-nums text-white/55">{count ? `${count} Eintr.` : "leer"}</span>
                  <span className="flex shrink-0 items-center">
                    <button type="button" className={ICON_BUTTON} onClick={() => move(index, -1)} disabled={index === 0} aria-label={`${name} nach oben`}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className={ICON_BUTTON} onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label={`${name} nach unten`}><ArrowDown className="h-4 w-4" /></button>
                    <button type="button" className={ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live")} disabled={count > 0}
                      onClick={() => { setIconOpen(null); setRows((list) => list.filter((_, position) => position !== index)); }}
                      title={count > 0 ? "Hat noch Einträge – erst verschieben." : "Entfernen"} aria-label={`${name} entfernen`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </span>
                </div>
                {iconOpen === index ? (
                  <div className="mt-2 border-t border-white/10 pt-2">
                    <ImageUpload value={row.icon_url} onChange={(value) => set(index, { icon_url: value || "" })} label="Symbol (quadratisch, optional)"
                      variant="square" crop="square" allowLibrary testId={`equipment-subcategory-icon-${index}`} {...mediaPropsFor(user)} />
                    <p className="mt-1 text-xs text-white/45">Steht vor dem Namen in der Sperrliste und im Regelwerk.</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="rounded-sm border border-dashed border-white/15 px-3 py-4 text-sm text-white/60" data-testid="equipment-subcategories-empty">
          Noch keine Unterkategorie. Ohne bleibt die Liste wie bisher – alle Einträge stehen direkt unter „{category.label}“.
        </p>
      )}
      {problem ? <p className="text-sm text-warn" role="alert">{problem}</p> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setRows((list) => [...list, { label: "", icon_url: "" }])} disabled={full}
          data-testid="equipment-subcategory-add" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
          <Plus className="h-3.5 w-3.5" /> Unterkategorie
        </button>
        <span className="text-[11px] text-white/50 tabular-nums">{rows.length} von höchstens {limit}</span>
      </div>
    </AdminSheet>
  );
}
