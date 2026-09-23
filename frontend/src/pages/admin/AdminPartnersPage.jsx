import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { DolibarrSourceBlock, dolibarrLocked, useDolibarrSource } from "@/components/tls/DolibarrSourceBlock";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Handshake, Pencil, Plus, Trash2 } from "lucide-react";

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
  // Partner aus Dolibarr (#405): derselbe Schalter wie bei den Sponsoren.
  const [dolibarrSource, setDolibarrSource] = useDolibarrSource();

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
        <button onClick={() => setEditing(emptyPartner)} data-testid="partner-new" className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Neuer Partner
        </button>
      </div>

      <DolibarrSourceBlock source={dolibarrSource} onChange={setDolibarrSource} onSynced={load} kind="partners" />

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
                  {p.source === "dolibarr" && <div className="text-[10px] uppercase tracking-widest text-[#29B6E8]/80 font-bold" data-testid={`partner-dolibarr-${p.id}`}>Aus Dolibarr</div>}
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

      {editing && <PartnerForm partner={editing} locked={dolibarrLocked(dolibarrSource, editing, dolibarrSource?.locked?.partners || [])} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </AdminLayout>
  );
}

function PartnerForm({ partner, locked = new Set(), onClose, onSaved }) {
  const isNew = !partner.id;
  const lock = (field) => (locked.has(field) ? { disabled: true, hint: "aus Dolibarr" } : {});
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

  // Seitenblatt statt Fenster (#435): die Liste bleibt daneben sichtbar.
  return (
    <AdminSheet title={isNew ? "Neuer Partner" : "Partner bearbeiten"} eyebrow="Verein" onClose={onClose} onSubmit={save} saving={saving} submitTestId="partner-save" testId="partner-sheet">
      <TextField label="Name" value={form.name} onChange={(v) => set("name", v)} required testId="partner-name" {...lock("name")} />
      <ImageUpload value={form.logo_url} onChange={(v) => set("logo_url", v)} label="Logo" testId="partner-logo" variant="square" endpoint="/uploads/logo" allowLibrary />
      <TextField label="Link" value={form.link} onChange={(v) => set("link", v)} placeholder="https://…" testId="partner-link" />
      <FormGrid>
        <TextField label="Typ" value={form.kind} onChange={(v) => set("kind", v)} placeholder="Verein, Messe, Community" testId="partner-kind" {...lock("kind")} />
        <TextField label="Reihenfolge" type="number" value={form.order_index} onChange={(v) => set("order_index", Number(v) || 0)} testId="partner-order" />
      </FormGrid>
      <CheckField label="Aktiv" checked={form.is_active !== false} onChange={(v) => set("is_active", v)} testId="partner-active" />
      <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="partner-description" />
    </AdminSheet>
  );
}
