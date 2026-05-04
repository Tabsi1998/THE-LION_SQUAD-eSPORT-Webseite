import { useEffect, useState, useRef } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Pencil, X as XIcon } from "lucide-react";

const TIERS = ["gold", "silver", "bronze", "standard"];

export default function AdminSponsorsPage() {
  const [list, setList] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    const { data } = await api.get("/sponsors");
    setList(data);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const del = async (id) => {
    if (!confirm("Sponsor wirklich löschen?")) return;
    await api.delete(`/sponsors/${id}`);
    toast.success("Sponsor gelöscht.");
    load();
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Partner</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Sponsoren</h1>
          <p className="mt-2 text-white/60 text-sm max-w-xl">Logos und Links verwalten. Sponsoren erscheinen als Slider auf der Startseite, im TV-Modus und im Footer.</p>
        </div>
        <button onClick={() => setCreating(true)} data-testid="sponsor-new-btn" className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Neuer Sponsor</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((s) => (
          <div key={s.id} className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid={`sponsor-card-${s.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                {s.logo_url ? (
                  <img src={s.logo_url} alt={s.name} className="w-14 h-14 object-contain rounded-sm bg-white/5 p-2 border border-white/10" />
                ) : (
                  <div className="w-14 h-14 rounded-sm bg-[#29B6E8]/10 border border-[#29B6E8]/30 flex items-center justify-center font-display font-bold text-[#29B6E8]">
                    {s.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className={`text-[10px] uppercase tracking-widest font-bold ${s.tier === "gold" ? "text-[#FFD700]" : s.tier === "silver" ? "text-white/70" : s.tier === "bronze" ? "text-[#CD7F32]" : "text-[#29B6E8]"}`}>{s.tier || "—"}</div>
                  <div className="font-heading text-lg font-bold truncate">{s.name}</div>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing(s)} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => del(s.id)} className="p-1.5 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            {s.description && <p className="mt-3 text-sm text-white/60 line-clamp-2">{s.description}</p>}
            {s.link && <a href={s.link} target="_blank" rel="noreferrer" className="mt-3 block text-xs text-[#29B6E8] hover:underline truncate">{s.link}</a>}
          </div>
        ))}
        {list.length === 0 && <div className="col-span-full text-center py-16 text-white/40 font-display tracking-widest">NOCH KEINE SPONSOREN</div>}
      </div>

      {(editing || creating) && (
        <SponsorForm
          sponsor={editing || null}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </AdminLayout>
  );
}

function SponsorForm({ sponsor, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: sponsor?.name || "", logo_url: sponsor?.logo_url || "",
    link: sponsor?.link || "", description: sponsor?.description || "",
    tier: sponsor?.tier || "standard",
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const uploadLogo = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post("/uploads/sponsor-logo", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm((f) => ({ ...f, logo_url: data.url }));
      toast.success("Logo hochgeladen.");
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Upload fehlgeschlagen"); }
    setUploading(false);
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (sponsor) await api.patch(`/sponsors/${sponsor.id}`, form);
      else await api.post("/sponsors", form);
      toast.success("Gespeichert.");
      onSaved();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} className="bg-[#121212] border border-white/10 rounded-sm max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-xl font-bold uppercase">{sponsor ? "Sponsor bearbeiten" : "Neuer Sponsor"}</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white"><XIcon className="w-4 h-4" /></button>
        </div>
        <Field label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required testId="sponsor-name" />
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Logo</div>
          <div className="flex items-start gap-3">
            {form.logo_url ? (
              <img src={form.logo_url} alt="" className="w-16 h-16 object-contain bg-white/5 border border-white/10 rounded-sm p-1 shrink-0" />
            ) : (
              <div className="w-16 h-16 bg-[#0A0A0A] border border-dashed border-white/20 rounded-sm shrink-0" />
            )}
            <div className="flex-1 space-y-2">
              <input value={form.logo_url} onChange={(e) => setForm({ ...form, logo_url: e.target.value })} placeholder="URL oder hochladen" data-testid="sponsor-logo-url" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} data-testid="sponsor-logo-file" />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="sponsor-logo-upload-btn" className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 border border-[#29B6E8]/40 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#29B6E8]/10 disabled:opacity-50">
                <Upload className="w-3.5 h-3.5" /> {uploading ? "Lade hoch…" : "Bild hochladen"}
              </button>
            </div>
          </div>
          <p className="text-xs text-white/40 mt-1">PNG/JPG/WebP/SVG bis 5 MB.</p>
        </div>
        <Field label="Link (URL)" value={form.link} onChange={(v) => setForm({ ...form, link: v })} testId="sponsor-link" placeholder="https://…" />
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Tier</div>
          <select value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} data-testid="sponsor-tier" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Beschreibung</div>
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="sponsor-description" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
        </label>
        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={saving} data-testid="sponsor-save" className="flex-1 px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
            {saving ? "Speichere…" : "Speichern"}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm">Abbrechen</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, value, onChange, required, placeholder, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
    </label>
  );
}
