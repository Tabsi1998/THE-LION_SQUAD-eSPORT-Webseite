import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Pencil, X as XIcon } from "lucide-react";

const TIERS = ["main", "platinum", "gold", "silver", "bronze"];
const TIER_LABELS = { main: "Hauptsponsor", platinum: "Platin", gold: "Gold", silver: "Silber", bronze: "Bronze" };
const TIER_COLORS = { main: "text-[#29B6E8]", platinum: "text-[#E5E4E2]", gold: "text-[#FFD700]", silver: "text-white/80", bronze: "text-[#CD7F32]" };

export default function AdminSponsorsPage() {
  const [list, setList] = useState([]);
  const [events, setEvents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [normalizing, setNormalizing] = useState(false);
  const [imageAudit, setImageAudit] = useState(null);

  const load = useCallback(async () => {
    const { data } = await api.get("/sponsors/admin");
    setList(data);
    api.get("/events").then(({ data }) => setEvents(data || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["sponsors", "uploads"]);

  const del = async (id) => {
    if (!window.confirm("Sponsor wirklich löschen?")) return;
    await api.delete(`/sponsors/${id}`);
    toast.success("Sponsor gelöscht.");
    load();
  };

  const migrate = async () => {
    if (!window.confirm("Externe Bilder JETZT lokal speichern? (Sponsoren, News, Events, Galerie, Avatare)")) return;
    setMigrating(true);
    try {
      const { data } = await api.post("/uploads/migrate-external-images");
      const total = Object.values(data.summary || {}).reduce((s, v) => s + (v.updated || 0), 0);
      toast.success(`${total} Bilder lokal gespeichert.`);
      auditImages();
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
    setMigrating(false);
  };

  const auditImages = async () => {
    setAuditing(true);
    try {
      const { data } = await api.get("/uploads/audit-images");
      setImageAudit(data);
      const s = data.summary || {};
      toast.success(`Bilder geprüft: ${s.local_ok || 0} ok, ${s.legacy_local || 0} alte URLs, ${s.missing_file || 0} fehlend, ${s.external || 0} extern.`);
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Bildprüfung fehlgeschlagen."); }
    setAuditing(false);
  };

  const normalizeImages = async () => {
    if (!window.confirm("Alte lokale Bild-URLs jetzt auf /api/static/uploads/... normalisieren?")) return;
    setNormalizing(true);
    try {
      const { data } = await api.post("/uploads/normalize-image-urls");
      setImageAudit(data);
      toast.success(`${data.summary?.normalized || 0} Bild-URLs normalisiert.`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Normalisierung fehlgeschlagen."); }
    setNormalizing(false);
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Partner</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Sponsoren</h1>
          <p className="mt-2 text-white/60 text-sm max-w-xl">
            Standard: <strong className="text-[#29B6E8]">Hauptsponsor</strong>, <strong className="text-[#E5E4E2]">Platin</strong> und <strong className="text-[#FFD700]">Gold</strong> erscheinen auf Startseite + Footer · <strong>Silber</strong> im Footer · <strong>Bronze</strong> nur auf der Sponsorenseite. Die Häkchen im Formular überschreiben diesen Standard.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={auditImages} disabled={auditing} data-testid="sponsor-audit-images-btn" className="px-4 py-2.5 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-[#FFD700] hover:text-[#FFD700] disabled:opacity-50 text-xs">
            {auditing ? "Prüfe…" : "Bilder prüfen"}
          </button>
          <button onClick={normalizeImages} disabled={normalizing} data-testid="sponsor-normalize-images-btn" className="px-4 py-2.5 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-[#29B6E8] hover:text-[#29B6E8] disabled:opacity-50 text-xs">
            {normalizing ? "Repariere…" : "URLs reparieren"}
          </button>
          <button onClick={migrate} disabled={migrating} data-testid="sponsor-migrate-btn" className="px-4 py-2.5 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-[#29B6E8] hover:text-[#29B6E8] disabled:opacity-50 text-xs">
            <Upload className="w-4 h-4" /> {migrating ? "Migriere…" : "Bilder migrieren"}
          </button>
          <button onClick={() => setCreating(true)} data-testid="sponsor-new-btn" className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Neuer Sponsor</button>
        </div>
      </div>

      {imageAudit?.summary && (
        <div className="mb-6 border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/50 mb-3">Bildprüfung</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
            {[
              ["OK", imageAudit.summary.local_ok],
              ["Alte URLs", imageAudit.summary.legacy_local],
              ["Repariert", imageAudit.summary.normalized],
              ["Extern", imageAudit.summary.external],
              ["Datei fehlt", imageAudit.summary.missing_file],
              ["Ungültig", imageAudit.summary.invalid_local],
              ["Sonstige", imageAudit.summary.other],
            ].map(([label, value]) => (
              <div key={label} className="border border-white/10 rounded-sm px-3 py-2">
                <div className="text-white/45 uppercase tracking-wider font-bold">{label}</div>
                <div className="font-display text-lg text-white mt-1">{value || 0}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((s) => (
          <div key={s.id} className="border border-white/10 rounded-sm bg-[#121212] p-5" data-testid={`sponsor-card-${s.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                {s.logo_url ? (
                  <img src={resolveMediaUrl(s.logo_url)} alt={s.name} className="w-14 h-14 object-contain rounded-sm bg-black/20 p-1" />
                ) : (
                  <div className="w-14 h-14 rounded-sm bg-[#29B6E8]/10 border border-[#29B6E8]/30 flex items-center justify-center font-display font-bold text-[#29B6E8]">
                    {s.name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <div className={`text-[10px] uppercase tracking-widest font-bold ${TIER_COLORS[s.tier] || "text-white/60"}`}>{TIER_LABELS[s.tier] || s.tier || "—"}</div>
                  <div className="font-heading text-lg font-bold truncate">{s.name}</div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {s.show_on_home && <span className="text-[9px] px-1.5 py-0.5 bg-[#29B6E8]/15 text-[#29B6E8] rounded-sm font-bold uppercase tracking-widest">Home</span>}
                    {s.show_on_footer && <span className="text-[9px] px-1.5 py-0.5 bg-white/10 text-white/70 rounded-sm font-bold uppercase tracking-widest">Footer</span>}
                    {s.show_on_events && <span className="text-[9px] px-1.5 py-0.5 bg-[#FFD700]/15 text-[#FFD700] rounded-sm font-bold uppercase tracking-widest">Events</span>}
                    {s.is_active === false && <span className="text-[9px] px-1.5 py-0.5 bg-[#FF3B30]/15 text-[#FF3B30] rounded-sm font-bold uppercase tracking-widest">Inaktiv</span>}
                  </div>
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
          events={events}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </AdminLayout>
  );
}

function SponsorForm({ sponsor, events = [], onClose, onSaved }) {
  const [form, setForm] = useState({
    name: sponsor?.name || "", logo_url: sponsor?.logo_url || "",
    link: sponsor?.link || "", description: sponsor?.description || "",
    tier: sponsor?.tier && ["main","platinum","gold","silver","bronze"].includes(sponsor.tier) ? sponsor.tier : "bronze",
    is_active: sponsor?.is_active !== false,
    show_on_home: sponsor?.show_on_home,
    show_on_footer: sponsor?.show_on_footer,
    show_on_events: sponsor?.show_on_events,
    event_ids: sponsor?.event_ids || [],
    order_index: sponsor?.order_index ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

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
        <Field label="Name" value={form.name} onChange={(v) => set("name", v)} required testId="sponsor-name" />
        <ImageUpload value={form.logo_url} onChange={(v) => set("logo_url", v)} label="Logo" testId="sponsor-logo" variant="square" endpoint="/uploads/sponsor-logo" allowLibrary />
        <Field label="Link (URL)" value={form.link} onChange={(v) => set("link", v)} testId="sponsor-link" placeholder="https://…" />
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Tier</div>
            <select value={form.tier} onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value, show_on_home: undefined, show_on_footer: undefined, show_on_events: undefined }))} data-testid="sponsor-tier" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm">
              {TIERS.map((t) => <option key={t} value={t}>{TIER_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Reihenfolge</div>
            <input type="number" value={form.order_index ?? 0} onChange={(e) => set("order_index", parseInt(e.target.value, 10) || 0)} data-testid="sponsor-order" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
          </label>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.is_active !== false} onChange={(e) => set("is_active", e.target.checked)} data-testid="sponsor-active" className="accent-[#29B6E8]" />
            Aktiv
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.show_on_home === true || (form.show_on_home === undefined && ["main", "platinum", "gold"].includes(form.tier))} onChange={(e) => set("show_on_home", e.target.checked)} data-testid="sponsor-show-home" className="accent-[#29B6E8]" />
            Auf Home
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.show_on_footer === true || (form.show_on_footer === undefined && ["main", "platinum", "gold", "silver"].includes(form.tier))} onChange={(e) => set("show_on_footer", e.target.checked)} data-testid="sponsor-show-footer" className="accent-[#29B6E8]" />
            Im Footer
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={form.show_on_events === true || (form.show_on_events === undefined && ["main", "platinum", "gold"].includes(form.tier))} onChange={(e) => set("show_on_events", e.target.checked)} data-testid="sponsor-show-events" className="accent-[#FFD700]" />
            Events
          </label>
        </div>
        {events.length > 0 && (
          <div className="border border-white/10 rounded-sm p-3 bg-[#0A0A0A]">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">Nur bestimmte Events</div>
            <div className="max-h-28 overflow-y-auto space-y-1">
              {events.map((ev) => (
                <label key={ev.id} className="flex items-center gap-2 text-xs text-white/70">
                  <input
                    type="checkbox"
                    checked={(form.event_ids || []).includes(ev.id)}
                    onChange={(e) => set("event_ids", e.target.checked ? [...(form.event_ids || []), ev.id] : (form.event_ids || []).filter((id) => id !== ev.id))}
                    className="accent-[#FFD700]"
                  />
                  {ev.name}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[10px] text-white/40">Leer lassen = Sponsor darf bei allen eigenen Events genutzt werden.</p>
          </div>
        )}
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Beschreibung</div>
          <textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} data-testid="sponsor-description" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
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
