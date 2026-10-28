/**
 * Navigation-Editor (Phase F.2): Reihenfolge, Namen und Sichtbarkeit der Menüpunkte und ihrer Unterpunkte. Seit #2122
 * mit „Liga“, Pflichtnamen und „Zurücksetzen“; eigene Menüpunkte gibt es bewusst nicht (Entscheidung NW7).
 */
import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { SkeletonList } from "@/components/tls/Skeleton";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { toast } from "sonner";
import {
  Save, Eye, EyeOff, ChevronUp, ChevronDown, RotateCcw, ChevronRight, ChevronDownIcon, Undo2,
} from "lucide-react";

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

/** Haupt- und Unterpunkte nach ihrer gespeicherten Reihenfolge. */
export function sortNavItems(items) {
  return [...(items || [])].sort(byOrder).map((item) => (item.children?.length ? { ...item, children: [...item.children].sort(byOrder) } : item));
}

/** Die Reihenfolge zum Speichern (#2122 NW6): je Hauptpunkt und je Unterpunkt die Stelle - sonst springt sie zurück. */
export function withOrder(items) {
  return items.map((item, index) => ({
    ...item,
    order: index,
    ...(item.children ? { children: item.children.map((child, childIndex) => ({ ...child, order: childIndex })) } : {}),
  }));
}

/** Menüpunkte ohne Namen (#2122 NW7) - gespeichert wird erst, wenn jeder einen hat. */
export function missingLabels(items) {
  const missing = [];
  for (const item of items || []) {
    if (!String(item.label || "").trim()) missing.push(item.key);
    for (const child of item.children || []) if (!String(child.label || "").trim()) missing.push(child.key);
  }
  return missing;
}

// Hinweise zu einzelnen Einträgen: was die Website zusätzlich entscheidet.
const ENTRY_NOTES = {
  league: "Erscheint nur, solange eine Season sichtbar ist.",
  chats: "Nur für Angemeldete.",
};

export default function AdminNavPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState({});
  const confirm = useConfirm();
  const missing = missingLabels(items);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/nav");
      setItems(sortNavItems(data.items));
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Fehler beim Laden");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["nav"]);

  const reset = async () => {
    if (!await confirm({
      title: "Navigation zurücksetzen?",
      description: "Reihenfolge, Namen und Sichtbarkeit kommen wie in der Vorgabe zurück. Deine Änderungen am Menü gehen verloren.",
      confirmLabel: "Zurücksetzen",
      tone: "danger",
    })) return;
    setSaving(true);
    try {
      const { data } = await api.post("/admin/nav/reset");
      setItems(sortNavItems(data?.items));
      toast.success("Navigation zurückgesetzt");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Zurücksetzen hat nicht geklappt");
    }
    setSaving(false);
  };

  const save = async () => {
    if (missing.length) {
      toast.error("Jeder Menüpunkt braucht einen Namen.");
      return;
    }
    setSaving(true);
    try {
      await api.put("/admin/nav", { items: withOrder(items) });
      toast.success("Navigation gespeichert");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Speichern fehlgeschlagen");
    }
    setSaving(false);
  };

  const toggleVisible = (idx, childIdx = null) => {
    setItems((prev) => {
      const next = [...prev];
      if (childIdx === null) {
        next[idx] = { ...next[idx], visible: !(next[idx].visible !== false) };
      } else {
        const children = [...(next[idx].children || [])];
        children[childIdx] = { ...children[childIdx], visible: !(children[childIdx].visible !== false) };
        next[idx] = { ...next[idx], children };
      }
      return next;
    });
  };

  const updateLabel = (idx, value, childIdx = null) => {
    setItems((prev) => {
      const next = [...prev];
      if (childIdx === null) {
        next[idx] = { ...next[idx], label: value };
      } else {
        const children = [...(next[idx].children || [])];
        children[childIdx] = { ...children[childIdx], label: value };
        next[idx] = { ...next[idx], children };
      }
      return next;
    });
  };

  const move = (idx, dir) => {
    setItems((prev) => {
      const next = [...prev];
      const tgt = idx + dir;
      if (tgt < 0 || tgt >= next.length) return prev;
      [next[idx], next[tgt]] = [next[tgt], next[idx]];
      return next;
    });
  };

  const moveChild = (parentIdx, idx, dir) => {
    setItems((prev) => {
      const next = [...prev];
      const children = [...(next[parentIdx].children || [])];
      const tgt = idx + dir;
      if (tgt < 0 || tgt >= children.length) return prev;
      [children[idx], children[tgt]] = [children[tgt], children[idx]];
      next[parentIdx] = { ...next[parentIdx], children };
      return next;
    });
  };

  const toggleExpand = (key) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Content</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Navigation</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">
        Reihenfolge, Namen und Sichtbarkeit des Menüs der Website. Die Unterpunkte eines Menüs siehst du nach dem Aufklappen.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={saving || loading || missing.length > 0}
          data-testid="nav-save"
          className="px-5 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Save className="w-3.5 h-3.5" /> {saving ? "Speichere…" : "Speichern"}
        </button>
        <button
          onClick={load}
          disabled={loading}
          data-testid="nav-reload"
          className="px-3 py-2 border border-white/10 hover:bg-white/5 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Verwerfen
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={loading || saving}
          data-testid="nav-reset"
          className="px-3 py-2 border border-white/10 hover:bg-white/5 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 disabled:opacity-50"
        >
          <Undo2 className="w-3.5 h-3.5" /> Zurücksetzen
        </button>
        <span className="text-xs text-white/40 ml-auto">{items.length} Hauptpunkte</span>
      </div>
      {missing.length > 0 && (
        <p role="alert" className="mt-3 text-xs text-[#FF6B6B]" data-testid="nav-missing-label">Jeder Menüpunkt braucht einen Namen – ein Feld ist leer.</p>
      )}

      {loading ? (
        <SkeletonList rows={5} className="mt-6" label="Lade Navigation" />
      ) : (
        <div className="mt-6 space-y-2" data-testid="nav-list">
          {items.map((it, idx) => {
            const visible = it.visible !== false;
            const hasChildren = (it.children || []).length > 0;
            const isExpanded = expanded[it.key];
            return (
              <div
                key={it.key}
                data-testid={`nav-row-${it.key}`}
                className={`border rounded-sm transition ${
                  visible ? "border-white/10 bg-[#121212]" : "border-white/5 bg-[#0E0E0E] opacity-60"
                }`}
              >
                <div className="flex items-center gap-2 p-3">
                  <div className="flex flex-col">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="p-0.5 text-white/40 hover:text-white disabled:opacity-30"
                      aria-label={`${it.label || "Eintrag"} nach oben`}
                    ><ChevronUp className="w-3.5 h-3.5" /></button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === items.length - 1}
                      className="p-0.5 text-white/40 hover:text-white disabled:opacity-30"
                      aria-label={`${it.label || "Eintrag"} nach unten`}
                    ><ChevronDown className="w-3.5 h-3.5" /></button>
                  </div>
                  {hasChildren && (
                    <button
                      onClick={() => toggleExpand(it.key)}
                      className="text-white/50 hover:text-white"
                      aria-label={`${it.label || "Eintrag"} ${isExpanded ? "zuklappen" : "aufklappen"}`}
                      aria-expanded={Boolean(isExpanded)}
                    >
                      {isExpanded ? <ChevronDownIcon className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  )}
                  <input
                    value={it.label || ""}
                    onChange={(e) => updateLabel(idx, e.target.value)}
                    data-testid={`nav-label-${it.key}`}
                    aria-label={`Name des Menüpunkts ${it.to || ""}`.trim()}
                    aria-invalid={!String(it.label || "").trim() || undefined}
                    required
                    className={`min-w-0 flex-1 bg-[#0A0A0A] border rounded-sm px-3 py-1.5 text-sm font-semibold ${String(it.label || "").trim() ? "border-white/10" : "border-[#FF6B6B]"}`}
                  />
                  {it.to && (
                    <span className="hidden md:inline text-[11px] text-white/30 font-mono truncate max-w-[180px]">{it.to}</span>
                  )}
                  <button
                    onClick={() => toggleVisible(idx)}
                    data-testid={`nav-toggle-${it.key}`}
                    className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 ${
                      visible ? "text-[#00FF88] bg-[#00FF88]/10" : "text-white/40 bg-white/5"
                    }`}
                  >
                    {visible ? <><Eye className="w-3 h-3" /> Sichtbar</> : <><EyeOff className="w-3 h-3" /> Versteckt</>}
                  </button>
                </div>

                {hasChildren && isExpanded && (
                  <div className="border-t border-white/5 px-3 pb-3 pt-2 ml-8 space-y-1.5" data-testid={`nav-children-${it.key}`}>
                    {it.children.map((c, cIdx) => {
                      const cVisible = c.visible !== false;
                      return (
                        <div
                          key={c.key}
                          className={`flex items-center gap-2 p-2 rounded-sm ${
                            cVisible ? "bg-[#0A0A0A]" : "bg-[#0A0A0A]/50 opacity-60"
                          }`}
                          data-testid={`nav-child-${it.key}-${c.key}`}
                        >
                          <div className="flex flex-col">
                            <button
                              onClick={() => moveChild(idx, cIdx, -1)}
                              disabled={cIdx === 0}
                              aria-label={`${c.label || "Unterpunkt"} nach oben`}
                              className="p-0.5 text-white/40 hover:text-white disabled:opacity-30"
                            ><ChevronUp className="w-3 h-3" /></button>
                            <button
                              onClick={() => moveChild(idx, cIdx, 1)}
                              disabled={cIdx === it.children.length - 1}
                              aria-label={`${c.label || "Unterpunkt"} nach unten`}
                              className="p-0.5 text-white/40 hover:text-white disabled:opacity-30"
                            ><ChevronDown className="w-3 h-3" /></button>
                          </div>
                          <div className="min-w-0 flex-1">
                            <input
                              value={c.label || ""}
                              onChange={(e) => updateLabel(idx, e.target.value, cIdx)}
                              data-testid={`nav-label-${it.key}-${c.key}`}
                              aria-label={`Name des Unterpunkts ${c.to || ""}`.trim()}
                              aria-invalid={!String(c.label || "").trim() || undefined}
                              required
                              className={`w-full bg-[#121212] border rounded-sm px-2.5 py-1 text-xs ${String(c.label || "").trim() ? "border-white/10" : "border-[#FF6B6B]"}`}
                            />
                            {ENTRY_NOTES[c.key] && <span className="mt-0.5 block text-[10px] text-white/45" data-testid={`nav-note-${c.key}`}>{ENTRY_NOTES[c.key]}</span>}
                          </div>
                          {c.to && <span className="hidden md:inline text-[10px] text-white/30 font-mono truncate max-w-[160px]">{c.to}</span>}
                          <button
                            onClick={() => toggleVisible(idx, cIdx)}
                            className={`px-2 py-1 text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 ${
                              cVisible ? "text-[#00FF88] bg-[#00FF88]/10" : "text-white/40 bg-white/5"
                            }`}
                          >
                            {cVisible ? <><Eye className="w-2.5 h-2.5" /> Sichtbar</> : <><EyeOff className="w-2.5 h-2.5" /> Versteckt</>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-8 p-4 border border-[#FFD700]/30 bg-[#FFD700]/5 rounded-sm text-xs text-white/70">
        <strong className="text-[#FFD700]">Hinweis:</strong> Versteckte Einträge stehen nicht im Menü der Website. Die Seiten selbst bleiben erreichbar – nur der Link im Menü fällt weg. Eigene Menüpunkte gibt es bewusst nicht; jede Seite hat ihren festen Platz.
      </div>
    </AdminLayout>
  );
}
