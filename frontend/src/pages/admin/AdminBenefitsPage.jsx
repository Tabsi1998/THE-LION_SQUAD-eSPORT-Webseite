import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, FieldLabel, TextAreaField, TextField } from "@/components/tls/FormFields";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Plus, Trash2, Gift } from "lucide-react";

const TYPE_LABELS = {
  ordinary: "Ordentlich",
  supporting: "Unterstützend",
  honorary: "Ehrenmitglied",
  youth: "Jugend",
  guest: "Gast",
  former: "Ehemalig",
};

export default function AdminBenefitsPage() {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null); // null | {} | object
  const [meta, setMeta] = useState({ types: [] });
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const { data } = await api.get("/membership/benefits/all");
    setList(data);
  }, []);
  useEffect(() => { load(); api.get("/membership/meta").then(({ data }) => setMeta(data)).catch(() => {}); }, [load]);
  useApiInvalidation(load, ["membership"]);

  const remove = async (id) => {
    if (!await confirm({
      title: "Mitgliedervorteil löschen?",
      description: "Dieser Vorteil wird aus dem Mitgliederbereich entfernt.",
      confirmLabel: "Löschen",
    })) return;
    try { await api.delete(`/membership/benefits/${id}`); toast.success("Gelöscht."); load(); }
    catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">VEREIN</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Mitgliedervorteile</h1>
        </div>
        <button onClick={() => setEditing({})} data-testid="benefits-new" className="inline-flex items-center gap-2 px-4 py-2 bg-[#FFD700] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#e8c200] transition">
          <Plus className="w-3.5 h-3.5" /> Neuer Vorteil
        </button>
      </div>

      {list.length === 0 ? (
        <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
          <Gift className="w-10 h-10 mx-auto opacity-40 mb-4" />
          <div className="font-heading font-bold text-lg">Noch keine Mitgliedervorteile</div>
          <div className="text-sm mt-2">Lege den ersten Vorteil an.</div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {list.map((b) => (
            <div key={b.id} className={`border rounded-sm bg-[#121212] p-5 ${b.is_active ? "border-white/10" : "border-white/5 opacity-60"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  {b.category && <div className="text-[10px] uppercase tracking-widest text-[#FFD700]/70">{b.category}</div>}
                  <h3 className="font-heading font-black uppercase">{b.title}</h3>
                </div>
                {!b.is_active && <span className="text-[10px] text-white/40 uppercase">inaktiv</span>}
              </div>
              {b.description && <p className="mt-2 text-sm text-white/65 line-clamp-3">{b.description}</p>}
              <div className="mt-4 flex gap-2">
                <button onClick={() => setEditing(b)} data-testid={`benefit-edit-${b.id}`} className="text-xs uppercase tracking-wider font-bold px-3 py-1 border border-[#FFD700]/40 text-[#FFD700] rounded-sm hover:bg-[#FFD700]/10">Bearbeiten</button>
                <button onClick={() => remove(b.id)} data-testid={`benefit-delete-${b.id}`} className="text-xs uppercase tracking-wider font-bold px-3 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm hover:bg-[#FF3B30]/10 inline-flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <BenefitModal benefit={editing} meta={meta} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </AdminLayout>
  );
}

function BenefitModal({ benefit, meta, onClose, onSaved }) {
  const isNew = !benefit?.id;
  const [form, setForm] = useState({
    title: benefit.title || "",
    description: benefit.description || "",
    category: benefit.category || "",
    image_url: benefit.image_url || "",
    link_url: benefit.link_url || "",
    valid_from: benefit.valid_from || "",
    valid_until: benefit.valid_until || "",
    visible_for_membership_types: benefit.visible_for_membership_types || [],
    is_active: benefit.is_active ?? true,
    order_index: benefit.order_index ?? 0,
  });
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (isNew) await api.post("/membership/benefits", form);
      else await api.patch(`/membership/benefits/${benefit.id}`, form);
      toast.success("Gespeichert.");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSaving(false);
  };

  const toggleType = (t) => {
    set("visible_for_membership_types", form.visible_for_membership_types.includes(t)
      ? form.visible_for_membership_types.filter((x) => x !== t)
      : [...form.visible_for_membership_types, t]);
  };

  // Seitenblatt statt Fenster (#435).
  return (
    <AdminSheet title={isNew ? "Neuer Vorteil" : "Vorteil bearbeiten"} eyebrow="Mitglieder" accent="#FFD700" onClose={onClose} onSubmit={submit} saving={saving} submitTestId="benefit-save" testId="benefit-sheet">
      <TextField label="Titel" value={form.title} onChange={(v) => set("title", v)} required testId="benefit-title" />
      <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} rows={3} testId="benefit-desc" />
      <FormGrid>
        <TextField label="Kategorie" value={form.category} onChange={(v) => set("category", v)} placeholder="Rabatt, Partner, Event…" testId="benefit-cat" />
        <TextField label="Sortierung" type="number" value={form.order_index} onChange={(v) => set("order_index", parseInt(v) || 0)} testId="benefit-order" />
      </FormGrid>
      <ImageUpload value={form.image_url} onChange={(v) => set("image_url", v)} label="Bild" testId="benefit-image" variant="wide" allowLibrary />
      <TextField label="Link URL" value={form.link_url} onChange={(v) => set("link_url", v)} placeholder="https://…" testId="benefit-link" />
      <FormGrid>
        <GermanDateField id="benefit-valid-from" label="Gültig von" value={form.valid_from?.slice(0, 10) || ""} onChange={(v) => set("valid_from", v)} testId="benefit-valid-from" allowFuture />
        <GermanDateField id="benefit-valid-until" label="Gültig bis" value={form.valid_until?.slice(0, 10) || ""} onChange={(v) => set("valid_until", v)} testId="benefit-valid-until" allowFuture />
      </FormGrid>
      <FieldLabel label="Sichtbar für Mitgliedsarten (leer = alle)">
        <div className="flex flex-wrap gap-2">
          {meta.types.map((t) => (
            <button key={t} type="button" onClick={() => toggleType(t)} className={`text-xs px-3 py-1.5 rounded-sm border ${form.visible_for_membership_types.includes(t) ? "border-[#FFD700] bg-[#FFD700]/15 text-[#FFD700]" : "border-white/15 text-white/50"}`}>
              {TYPE_LABELS[t] || t}
            </button>
          ))}
        </div>
      </FieldLabel>
      <CheckField label="Aktiv (für Mitglieder sichtbar)" checked={form.is_active} onChange={(v) => set("is_active", v)} accent="#FFD700" testId="benefit-active" />
    </AdminSheet>
  );
}
