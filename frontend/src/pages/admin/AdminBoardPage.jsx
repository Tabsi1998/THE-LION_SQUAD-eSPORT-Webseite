import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Plus, Crown, EyeOff, Eye, GripVertical } from "lucide-react";

export default function AdminBoardPage() {
  const [positions, setPositions] = useState([]);
  const [members, setMembers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const [p, u] = await Promise.all([api.get("/board"), api.get("/board/assignable-users")]);
    setPositions(p.data);
    setMembers(u.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["board", "membership"]);

  const toggle = async (p) => {
    try { await api.patch(`/board/${p.id}`, { is_active: !p.is_active }); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };
  const assign = async (p, field, uid) => {
    try { await api.patch(`/board/${p.id}`, { [field]: uid || "" }); toast.success("Zuweisung aktualisiert"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };
  const del = async (p) => {
    if (!await confirm({
      title: "Vorstandsposition löschen?",
      description: `Position "${p.title_male}" wirklich löschen?`,
      confirmLabel: "Löschen",
    })) return;
    try { await api.delete(`/board/${p.id}`); toast.success("Gelöscht"); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Phase D · Verein</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Vorstand</h1>
          <p className="mt-2 text-white/60 text-sm max-w-xl">
            Aktiviere/deaktiviere Positionen, weise redaktionelle Vereinsmitglieder zu und ergänze eigene Funktionen. Geschlechter-spezifischer Titel (Obmann/Obfrau) wird automatisch aus dem Profil-Geschlecht abgeleitet.
          </p>
        </div>
        <button onClick={() => setCreating(true)} data-testid="board-new-btn" className="px-5 py-2.5 bg-[#FFD700] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Eigene Position</button>
      </div>

      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3 w-10"></th>
                <th className="text-left px-4 py-3">Position</th>
                <th className="text-left px-4 py-3">Vereinsmitglied</th>
                <th className="text-left px-4 py-3">Stellvertreter</th>
                <th className="text-left px-4 py-3">Aktiv</th>
                <th className="text-right px-4 py-3">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {positions.map((p) => (
                <tr key={p.id} data-testid={`board-row-${p.slug}`} className={!p.is_active ? "opacity-50" : ""}>
                  <td className="px-4 py-3 text-white/30"><GripVertical className="w-4 h-4" /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Crown className="w-4 h-4 text-[#FFD700] shrink-0" />
                      <div>
                        <div className="font-semibold">{p.title_male}{p.title_female ? ` / ${p.title_female}` : ""}</div>
                        <div className="text-xs text-white/40">{p.is_default ? "Standard · " : ""}{p.allow_deputy ? "Mit Stv." : "Ohne Stv."}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <select value={p.user_id || ""} onChange={(e) => assign(p, "user_id", e.target.value)} data-testid={`board-assign-${p.slug}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm text-xs min-w-[180px]">
                      <option value="">— offen —</option>
                      {members.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    {p.allow_deputy ? (
                      <select value={p.deputy_user_id || ""} onChange={(e) => assign(p, "deputy_user_id", e.target.value)} data-testid={`board-deputy-${p.slug}`} className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm text-xs min-w-[180px]">
                        <option value="">— optional —</option>
                        {members.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                      </select>
                    ) : <span className="text-white/30 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggle(p)} data-testid={`board-toggle-${p.slug}`} className={`text-xs uppercase tracking-wider font-bold inline-flex items-center gap-1 ${p.is_active ? "text-[#00FF88]" : "text-white/40"}`}>
                      {p.is_active ? <><Eye className="w-3 h-3" /> Aktiv</> : <><EyeOff className="w-3 h-3" /> Inaktiv</>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditing(p)} className="text-[#29B6E8] hover:underline mr-3 text-xs">Bearbeiten</button>
                    {!p.is_default && <button onClick={() => del(p)} className="text-[#FF3B30] hover:underline text-xs">Löschen</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(creating || editing) && (
        <BoardForm position={editing} onClose={() => { setEditing(null); setCreating(false); }} onSaved={load} />
      )}
    </AdminLayout>
  );
}

function BoardForm({ position, onClose, onSaved }) {
  const isNew = !position;
  const [form, setForm] = useState({
    title_male: position?.title_male || "",
    title_female: position?.title_female || "",
    description: position?.description || "",
    allow_deputy: position?.allow_deputy ?? true,
    order_index: position?.order_index ?? 99,
    is_active: position?.is_active ?? true,
    slug: position?.slug || "",
  });
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) await api.post("/board", form);
      else await api.patch(`/board/${position.id}`, form);
      toast.success("Gespeichert");
      onSaved();
      onClose();
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail) || "Fehler"); }
    setSaving(false);
  };

  // Seitenblatt statt Fenster (#435).
  return (
    <AdminSheet title={isNew ? "Neue Position" : "Position bearbeiten"} eyebrow="Vorstand" accent="#FFD700" onClose={onClose} onSubmit={save} saving={saving} submitTestId="board-save" testId="board-sheet">
      <TextField label="Bezeichnung (männlich)" value={form.title_male} onChange={(v) => setForm({ ...form, title_male: v })} testId="board-title-m" required />
      <TextField label="Bezeichnung (weiblich, optional)" value={form.title_female || ""} onChange={(v) => setForm({ ...form, title_female: v })} testId="board-title-f" />
      <TextAreaField label="Beschreibung (optional)" value={form.description || ""} onChange={(v) => setForm({ ...form, description: v })} testId="board-desc" />
      <FormGrid>
        <CheckField label="Stellvertreter erlaubt" checked={form.allow_deputy} onChange={(v) => setForm({ ...form, allow_deputy: v })} testId="board-allow-deputy" accent="#FFD700" />
        <CheckField label="Aktiv" checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} testId="board-active" accent="#FFD700" />
      </FormGrid>
    </AdminSheet>
  );
}
