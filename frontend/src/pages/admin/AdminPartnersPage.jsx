import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Handshake, Pencil, Plus, Trash2, X } from "lucide-react";

const emptyPartner = {
  name: "",
  logo_url: "",
  link: "",
  description: "",
  kind: "verein",
  is_active: true,
  order_index: 0,
};

export default function AdminPartnersPage() {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get("/partners/admin");
    setList(data || []);
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["partners", "uploads"]);

  const remove = async (id) => {
    if (!await confirm({ title: "Partner löschen?", description: "Der Partner wird dauerhaft aus der Partnerseite entfernt.", confirmLabel: "Löschen" })) return;
    await api.delete(`/partners/${id}`);
    toast.success("Partner gelöscht.");
    load();
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verein</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Partner</h1>
          <p className="mt-2 text-white/60 text-sm max-w-xl">Befreundete Vereine, Veranstalter und Communitys für die öffentliche Partnerseite.</p>
        </div>
        <button onClick={() => setEditing(emptyPartner)} className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Neuer Partner
        </button>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((p) => (
          <div key={p.id} className="border border-white/10 rounded-sm bg-[#121212] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {p.logo_url ? (
                  <img src={resolveMediaUrl(p.logo_url)} alt={p.name} className="w-14 h-14 object-contain rounded-sm bg-black/20 p-1" />
                ) : (
                  <div className="w-14 h-14 rounded-sm bg-[#29B6E8]/10 border border-[#29B6E8]/30 flex items-center justify-center text-[#29B6E8]">
                    <Handshake className="w-6 h-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">{p.kind || "Partner"}</div>
                  <div className="font-heading text-lg font-bold truncate">{p.name}</div>
                  {p.is_active === false && <div className="text-[10px] uppercase tracking-widest text-[#FF3B30] font-bold">Inaktiv</div>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing(p)} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => remove(p.id)} className="p-1.5 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            {p.description && <p className="mt-3 text-sm text-white/60 line-clamp-2">{p.description}</p>}
            {p.link && <a href={p.link} target="_blank" rel="noreferrer" className="mt-3 block text-xs text-[#29B6E8] hover:underline truncate">{p.link}</a>}
          </div>
        ))}
        {list.length === 0 && <div className="col-span-full text-center py-16 text-white/40 font-display tracking-widest">NOCH KEINE PARTNER</div>}
      </div>

      {editing && <PartnerForm partner={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </AdminLayout>
  );
}

function PartnerForm({ partner, onClose, onSaved }) {
  const isNew = !partner.id;
  const [form, setForm] = useState({ ...emptyPartner, ...partner });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) await api.post("/partners", form);
      else await api.patch(`/partners/${partner.id}`, form);
      toast.success("Gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-[#121212] border border-white/10 rounded-sm max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-xl font-bold uppercase">{isNew ? "Neuer Partner" : "Partner bearbeiten"}</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <Field label="Name" value={form.name} onChange={(v) => set("name", v)} required />
        <ImageUpload value={form.logo_url} onChange={(v) => set("logo_url", v)} label="Logo" testId="partner-logo" variant="square" endpoint="/uploads/logo" allowLibrary />
        <Field label="Link" value={form.link} onChange={(v) => set("link", v)} placeholder="https://…" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Typ" value={form.kind} onChange={(v) => set("kind", v)} placeholder="Verein, Messe, Community" />
          <Field label="Reihenfolge" type="number" value={form.order_index} onChange={(v) => set("order_index", Number(v) || 0)} />
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_active !== false} onChange={(e) => set("is_active", e.target.checked)} className="accent-[#29B6E8]" />
          Aktiv
        </label>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Beschreibung</div>
          <textarea rows={3} value={form.description || ""} onChange={(e) => set("description", e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
        </label>
        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{saving ? "Speichere…" : "Speichern"}</button>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm">Abbrechen</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, required, placeholder, type = "text" }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}
