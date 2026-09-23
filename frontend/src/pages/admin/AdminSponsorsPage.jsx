import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { GermanDateField } from "@/components/tls/GermanDateField";
import { DolibarrSourceBlock, dolibarrLocked, useDolibarrSource } from "@/components/tls/DolibarrSourceBlock";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Plus, Trash2, Upload, Pencil } from "lucide-react";

const TIERS = ["main", "platinum", "gold", "silver", "bronze"];
const TIER_LABELS = { main: "Hauptsponsor", platinum: "Platin", gold: "Gold", silver: "Silber", bronze: "Bronze" };
const TIER_COLORS = { main: "text-[#29B6E8]", platinum: "text-[#E5E4E2]", gold: "text-[#FFD700]", silver: "text-white/80", bronze: "text-[#CD7F32]" };
const CONTRACT_STATUSES = ["active", "planned", "paused", "expired", "cancelled"];
const CONTRACT_LABELS = { active: "Aktiv", planned: "Geplant", paused: "Pausiert", expired: "Abgelaufen", cancelled: "Gekündigt", inactive: "Inaktiv" };
const STATUS_CLASSES = {
  active: "bg-[#00FF88]/10 text-[#00FF88]",
  planned: "bg-[#29B6E8]/10 text-[#29B6E8]",
  paused: "bg-[#FFD700]/10 text-[#FFD700]",
  expired: "bg-white/10 text-white/60",
  cancelled: "bg-[#FF3B30]/10 text-[#FF3B30]",
  inactive: "bg-[#FF3B30]/10 text-[#FF3B30]",
};
const TIER_DEFAULTS = {
  main: { show_on_home: true, show_on_footer: true, show_on_events: false, show_on_tv: true, show_on_pdf: true, show_in_emails: true },
  platinum: { show_on_home: false, show_on_footer: true, show_on_events: false, show_on_tv: true, show_on_pdf: false, show_in_emails: false },
  gold: { show_on_home: false, show_on_footer: true, show_on_events: false, show_on_tv: false, show_on_pdf: false, show_in_emails: false },
  silver: { show_on_home: false, show_on_footer: true, show_on_events: false, show_on_tv: false, show_on_pdf: false, show_in_emails: false },
  bronze: { show_on_home: false, show_on_footer: false, show_on_events: false, show_on_tv: false, show_on_pdf: false, show_in_emails: false },
};

const PLACEMENT_LABELS = [
  ["show_on_home", "Home"],
  ["show_on_footer", "Footer"],
  ["show_on_events", "Events"],
  ["show_on_tv", "TV"],
  ["show_on_pdf", "PDF"],
  ["show_in_emails", "E-Mail"],
];

function effectiveSponsorStatus(sponsor) {
  if (sponsor?.effective_status) return sponsor.effective_status;
  if (sponsor?.is_active === false) return "inactive";
  const status = sponsor?.contract_status || "active";
  if (status === "paused" || status === "cancelled") return status;
  const today = new Date().toISOString().slice(0, 10);
  if (sponsor?.contract_start && sponsor.contract_start > today) return "planned";
  if (sponsor?.contract_end && sponsor.contract_end < today) return "expired";
  return status === "expired" || status === "planned" ? "active" : status;
}

function formatDate(value) {
  if (!value) return "";
  return String(value).slice(0, 10).split("-").reverse().join(".");
}

export default function AdminSponsorsPage() {
  const [list, setList] = useState([]);
  const [events, setEvents] = useState([]);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [normalizing, setNormalizing] = useState(false);
  const [clearingMissing, setClearingMissing] = useState(false);
  const [imageAudit, setImageAudit] = useState(null);
  const confirm = useConfirm();
  // Sponsoren aus Dolibarr (#405): Schalter, Stand und welche Felder Dolibarr führt.
  const [dolibarrSource, setDolibarrSource] = useDolibarrSource();

  const load = useCallback(async () => {
    const { data } = await api.get("/sponsors/admin");
    setList(data);
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["sponsors", "uploads"]);

  const del = async (id) => {
    if (!await confirm({ title: "Sponsor löschen?", description: "Der Sponsor wird dauerhaft entfernt.", confirmLabel: "Löschen" })) return;
    await api.delete(`/sponsors/${id}`);
    toast.success("Sponsor gelöscht.");
    load();
  };

  const migrate = async () => {
    if (!await confirm({ title: "Externe Bilder lokal speichern?", description: "Externe Bild-URLs werden heruntergeladen und durch lokale Upload-URLs ersetzt.", confirmLabel: "Migrieren", tone: "info" })) return;
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
    if (!await confirm({ title: "Bild-URLs reparieren?", description: "Alte lokale Bildpfade werden auf /api/static/uploads/... normalisiert.", confirmLabel: "Reparieren", tone: "info" })) return;
    setNormalizing(true);
    try {
      const { data } = await api.post("/uploads/normalize-image-urls");
      setImageAudit(data);
      toast.success(`${data.summary?.normalized || 0} Bild-URLs normalisiert.`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Normalisierung fehlgeschlagen."); }
    setNormalizing(false);
  };

  const clearMissingImages = async () => {
    if (!await confirm({ title: "Fehlende Bilder leeren?", description: "Bildfelder, die auf nicht mehr vorhandene Upload-Dateien zeigen, werden geleert.", confirmLabel: "Bereinigen" })) return;
    setClearingMissing(true);
    try {
      const { data } = await api.post("/uploads/clear-missing-image-refs");
      setImageAudit(data);
      toast.success(`${data.summary?.cleared_missing || 0} kaputte Bild-Verknüpfung(en) geleert.`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Bereinigung fehlgeschlagen."); }
    setClearingMissing(false);
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Partner</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Sponsoren</h1>
          <p className="mt-2 text-white/60 text-sm max-w-xl">
            Tier steuert Größe und Reihenfolge. Vertragsstatus und Laufzeit entscheiden, ob ein Sponsor öffentlich ausgespielt wird; die Haken entscheiden die Platzierungen.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={auditImages} disabled={auditing} data-testid="sponsor-audit-images-btn" className="px-4 py-2.5 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-[#FFD700] hover:text-[#FFD700] disabled:opacity-50 text-xs">
            {auditing ? "Prüfe…" : "Bilder prüfen"}
          </button>
          <button onClick={normalizeImages} disabled={normalizing} data-testid="sponsor-normalize-images-btn" className="px-4 py-2.5 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-[#29B6E8] hover:text-[#29B6E8] disabled:opacity-50 text-xs">
            {normalizing ? "Repariere…" : "URLs reparieren"}
          </button>
          <button onClick={clearMissingImages} disabled={clearingMissing} data-testid="sponsor-clear-missing-images-btn" className="px-4 py-2.5 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-[#FF3B30] hover:text-[#FF3B30] disabled:opacity-50 text-xs">
            {clearingMissing ? "Bereinige…" : "Fehlende leeren"}
          </button>
          <button onClick={migrate} disabled={migrating} data-testid="sponsor-migrate-btn" className="px-4 py-2.5 border border-white/20 text-white/80 font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 hover:border-[#29B6E8] hover:text-[#29B6E8] disabled:opacity-50 text-xs">
            <Upload className="w-4 h-4" /> {migrating ? "Migriere…" : "Bilder migrieren"}
          </button>
          <button onClick={() => setCreating(true)} data-testid="sponsor-new-btn" className="px-5 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Plus className="w-4 h-4" /> Neuer Sponsor</button>
        </div>
      </div>

      <DolibarrSourceBlock source={dolibarrSource} onChange={setDolibarrSource} onSynced={load} kind="sponsors" />

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
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase tracking-widest ${STATUS_CLASSES[effectiveSponsorStatus(s)] || STATUS_CLASSES.inactive}`}>
                      {CONTRACT_LABELS[effectiveSponsorStatus(s)] || effectiveSponsorStatus(s)}
                    </span>
                    {s.show_on_home && <span className="text-[9px] px-1.5 py-0.5 bg-[#29B6E8]/15 text-[#29B6E8] rounded-sm font-bold uppercase tracking-widest">Home</span>}
                    {s.show_on_footer && <span className="text-[9px] px-1.5 py-0.5 bg-white/10 text-white/70 rounded-sm font-bold uppercase tracking-widest">Footer</span>}
                    {s.show_on_events && <span className="text-[9px] px-1.5 py-0.5 bg-[#FFD700]/15 text-[#FFD700] rounded-sm font-bold uppercase tracking-widest">Events</span>}
                    {s.show_on_tv && <span className="text-[9px] px-1.5 py-0.5 bg-[#9F7AEA]/15 text-[#BFA6FF] rounded-sm font-bold uppercase tracking-widest">TV</span>}
                    {s.show_on_pdf && <span className="text-[9px] px-1.5 py-0.5 bg-[#29B6E8]/15 text-[#8EE6FF] rounded-sm font-bold uppercase tracking-widest">PDF</span>}
                    {s.show_in_emails && <span className="text-[9px] px-1.5 py-0.5 bg-[#18C29C]/15 text-[#18C29C] rounded-sm font-bold uppercase tracking-widest">E-Mail</span>}
                    {s.is_active === false && <span className="text-[9px] px-1.5 py-0.5 bg-[#FF3B30]/15 text-[#FF3B30] rounded-sm font-bold uppercase tracking-widest">Inaktiv</span>}
                    {s.source === "dolibarr" && <span className="text-[9px] px-1.5 py-0.5 bg-[#29B6E8]/15 text-[#29B6E8] rounded-sm font-bold uppercase tracking-widest" data-testid={`sponsor-dolibarr-${s.id}`}>Dolibarr</span>}
                  </div>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing(s)} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => del(s.id)} className="p-1.5 text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
            {(s.contract_start || s.contract_end || s.contact_name) && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-white/45">
                {(s.contract_start || s.contract_end) && (
                  <div>Vertrag: {formatDate(s.contract_start) || "offen"} bis {formatDate(s.contract_end) || "offen"}</div>
                )}
                {s.contact_name && <div>Ansprechpartner: {s.contact_name}</div>}
              </div>
            )}
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
          locked={dolibarrLocked(dolibarrSource, editing, dolibarrSource?.locked?.sponsors || [])}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSaved={() => { setEditing(null); setCreating(false); load(); }}
        />
      )}
    </AdminLayout>
  );
}

function SponsorForm({ sponsor, events = [], locked = new Set(), onClose, onSaved }) {
  const initialTier = sponsor?.tier && ["main","platinum","gold","silver","bronze"].includes(sponsor.tier) ? sponsor.tier : "bronze";
  const initialDefaults = TIER_DEFAULTS[initialTier] || TIER_DEFAULTS.bronze;
  const [form, setForm] = useState({
    name: sponsor?.name || "", logo_url: sponsor?.logo_url || "",
    link: sponsor?.link || "", description: sponsor?.description || "",
    tier: initialTier,
    is_active: sponsor?.is_active !== false,
    contract_status: sponsor?.contract_status || "active",
    contract_start: sponsor?.contract_start || "",
    contract_end: sponsor?.contract_end || "",
    contact_name: sponsor?.contact_name || "",
    contact_email: sponsor?.contact_email || "",
    contact_phone: sponsor?.contact_phone || "",
    internal_notes: sponsor?.internal_notes || "",
    show_on_home: sponsor ? sponsor?.show_on_home === true : initialDefaults.show_on_home,
    show_on_footer: sponsor ? sponsor?.show_on_footer === true : initialDefaults.show_on_footer,
    show_on_events: sponsor ? sponsor?.show_on_events === true : initialDefaults.show_on_events,
    show_on_tv: sponsor ? sponsor?.show_on_tv === true : initialDefaults.show_on_tv,
    show_on_pdf: sponsor ? sponsor?.show_on_pdf === true : initialDefaults.show_on_pdf,
    show_in_emails: sponsor ? sponsor?.show_in_emails === true : initialDefaults.show_in_emails,
    event_ids: sponsor?.event_ids || [],
    order_index: sponsor?.order_index ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const [placementsTouched, setPlacementsTouched] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setPlacement = (k, v) => {
    setPlacementsTouched(true);
    set(k, v);
  };
  const applyTierDefaults = (tier = form.tier) => {
    const defaults = TIER_DEFAULTS[tier] || TIER_DEFAULTS.bronze;
    setForm((f) => ({ ...f, ...defaults }));
    setPlacementsTouched(false);
  };
  const setTier = (tier) => {
    const defaults = TIER_DEFAULTS[tier] || TIER_DEFAULTS.bronze;
    setForm((f) => ({ ...f, tier, ...(!placementsTouched ? defaults : {}) }));
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

  // Aus Dolibarr geführte Felder (#405) sind gesperrt und sagen es; der Server ignoriert sie ohnehin.
  const lock = (field) => (locked.has(field) ? { disabled: true, hint: "aus Dolibarr" } : {});

  // Seitenblatt statt Fenster (#435): Sponsor, Vertrag und Kontakt, Sichtbarkeit, Texte als
  // Abschnitte; die Karten der Liste bleiben daneben sichtbar.
  return (
    <AdminSheet title={sponsor ? "Sponsor bearbeiten" : "Neuer Sponsor"} eyebrow="Verein" size="lg" onClose={onClose} onSubmit={save} saving={saving} submitTestId="sponsor-save" testId="sponsor-sheet">
      {locked.size > 0 && (
        <p className="text-xs text-[#29B6E8] border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm px-3 py-2" data-testid="sponsor-locked-hint">
          Dieser Sponsor kommt aus Dolibarr: Name, Stufe, Laufzeit, E-Mail und Telefon werden dort gepflegt. Logo, Link, Platzierungen, Reihenfolge, Ansprechpartner und Texte bleiben hier.
        </p>
      )}
      <FormSection title="Sponsor">
        <FormGrid>
          <TextField label="Name" value={form.name} onChange={(v) => set("name", v)} required testId="sponsor-name" {...lock("name")} />
          <TextField label="Link (URL)" value={form.link} onChange={(v) => set("link", v)} testId="sponsor-link" placeholder="https://…" />
        </FormGrid>
        <ImageUpload value={form.logo_url} onChange={(v) => set("logo_url", v)} label="Logo" testId="sponsor-logo" variant="square" endpoint="/uploads/sponsor-logo" allowLibrary />
        <FormGrid>
          <SelectField label="Tier" value={form.tier} onChange={setTier} options={TIERS.map((t) => [t, TIER_LABELS[t]])} testId="sponsor-tier" {...lock("tier")} />
          <TextField label="Reihenfolge" type="number" value={form.order_index ?? 0} onChange={(v) => set("order_index", parseInt(v, 10) || 0)} testId="sponsor-order" />
        </FormGrid>
      </FormSection>

      <FormSection title="Vertrag und Kontakt" hint="Vertragsstatus und Laufzeit entscheiden, ob der Sponsor öffentlich ausgespielt wird.">
        <FormGrid cols={3}>
          <SelectField label="Vertragsstatus" value={form.contract_status} onChange={(v) => set("contract_status", v)} options={CONTRACT_STATUSES.map((status) => [status, CONTRACT_LABELS[status]])} testId="sponsor-contract-status" />
          <GermanDateField id="sponsor-contract-start" label="Start" value={(form.contract_start || "").slice(0, 10)} onChange={(v) => set("contract_start", v)} testId="sponsor-contract-start" allowFuture {...lock("contract_start")} />
          <GermanDateField id="sponsor-contract-end" label="Ende" value={(form.contract_end || "").slice(0, 10)} onChange={(v) => set("contract_end", v)} testId="sponsor-contract-end" allowFuture {...lock("contract_end")} />
        </FormGrid>
        <FormGrid cols={3}>
          <TextField label="Ansprechpartner" value={form.contact_name} onChange={(v) => set("contact_name", v)} testId="sponsor-contact-name" />
          <TextField label="Kontakt E-Mail" type="email" value={form.contact_email} onChange={(v) => set("contact_email", v)} testId="sponsor-contact-email" {...lock("contact_email")} />
          <TextField label="Telefon" value={form.contact_phone} onChange={(v) => set("contact_phone", v)} testId="sponsor-contact-phone" {...lock("contact_phone")} />
        </FormGrid>
      </FormSection>

      <FormSection title="Sichtbarkeit" hint="Haken entscheiden live. Tier-Standard ist nur eine schnelle Vorlage.">
        <div className="flex justify-end">
          <button type="button" onClick={() => applyTierDefaults()} className="px-3 py-1.5 border border-[#29B6E8]/40 text-[#29B6E8] text-[10px] font-bold uppercase tracking-wider rounded-sm hover:bg-[#29B6E8]/10">
            Tier-Standard
          </button>
        </div>
        <FormGrid cols={3}>
          <CheckField label="Aktiv" checked={form.is_active !== false} onChange={(v) => set("is_active", v)} testId="sponsor-active" />
          <CheckField label="Auf Home" checked={form.show_on_home === true} onChange={(v) => setPlacement("show_on_home", v)} testId="sponsor-show-home" />
          <CheckField label="Im Footer" checked={form.show_on_footer === true} onChange={(v) => setPlacement("show_on_footer", v)} testId="sponsor-show-footer" />
          <CheckField label="Events" checked={form.show_on_events === true} onChange={(v) => setPlacement("show_on_events", v)} testId="sponsor-show-events" accent="#FFD700" />
          <CheckField label="TV / Anzeige" checked={form.show_on_tv === true} onChange={(v) => setPlacement("show_on_tv", v)} testId="sponsor-show-tv" accent="#9F7AEA" />
          <CheckField label="PDFs" checked={form.show_on_pdf === true} onChange={(v) => setPlacement("show_on_pdf", v)} testId="sponsor-show-pdf" />
          <CheckField label="E-Mails" checked={form.show_in_emails === true} onChange={(v) => setPlacement("show_in_emails", v)} testId="sponsor-show-emails" accent="#18C29C" />
        </FormGrid>
        {events.length > 0 && (
          <div className="border border-white/10 rounded-sm p-3 bg-[#0A0A0A]">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">Nur bestimmte Events</div>
            <div className="max-h-28 overflow-y-auto space-y-1">
              {events.map((ev) => (
                <CheckField
                  key={ev.id}
                  label={ev.name}
                  checked={(form.event_ids || []).includes(ev.id)}
                  onChange={(checked) => set("event_ids", checked ? [...(form.event_ids || []), ev.id] : (form.event_ids || []).filter((id) => id !== ev.id))}
                  accent="#FFD700"
                />
              ))}
            </div>
            <p className="mt-2 text-[10px] text-white/40">Nur relevant, wenn „Events” aktiv ist. Leer lassen = bei allen eigenen Events erlaubt.</p>
          </div>
        )}
        <SponsorPlacementPreview sponsor={form} />
      </FormSection>

      <FormSection title="Texte">
        <TextAreaField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} rows={2} testId="sponsor-description" />
        <TextAreaField label="Interne Notizen" value={form.internal_notes} onChange={(v) => set("internal_notes", v)} rows={2} testId="sponsor-internal-notes" />
      </FormSection>
    </AdminSheet>
  );
}

function SponsorPlacementPreview({ sponsor }) {
  const status = effectiveSponsorStatus(sponsor);
  const enabled = PLACEMENT_LABELS.filter(([key]) => sponsor[key] === true);
  const visible = sponsor.is_active !== false && status === "active";
  return (
    <div className="border border-white/10 rounded-sm bg-[#080808] p-3" data-testid="sponsor-placement-preview">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Vorschau Ausspielung</div>
          <p className="mt-1 text-[10px] text-white/40">
            Öffentlich sichtbar nur bei aktivem Vertrag innerhalb der Laufzeit.
          </p>
        </div>
        <span className={`text-[9px] px-2 py-1 rounded-sm font-bold uppercase tracking-widest ${visible ? STATUS_CLASSES.active : STATUS_CLASSES[status] || STATUS_CLASSES.inactive}`}>
          {visible ? "Wird ausgespielt" : "Nicht öffentlich"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {enabled.length ? enabled.map(([key, label]) => (
          <span key={key} className="text-[10px] px-2 py-1 border border-white/10 text-white/70 rounded-sm uppercase tracking-wider font-bold">{label}</span>
        )) : (
          <span className="text-xs text-white/35">Keine Platzierung aktiv.</span>
        )}
      </div>
    </div>
  );
}

