import { useCallback, useEffect, useState } from "react";
import { api, formatApiError, resolveMediaUrl } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { DolibarrSourceBlock, dolibarrLocked, useDolibarrSource } from "@/components/tls/DolibarrSourceBlock";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { ExternalLink, Handshake, Pencil, Plus, Trash2 } from "lucide-react";

// Partner: Liste und Seitenblatt (#435). Seit der Partnerseite (#469) hat jeder Partner eine eigene
// Adresse (/partners/<slug>), Kanäle (Discord, Twitch, YouTube, X, Instagram, TikTok), einen Text
// „Über den Partner“ und Tools/Projekte; aus Dolibarr (#405) kommen Name und Art, der Rest bleibt hier.

export const emptyPartner = {
  name: "", slug: "", logo_url: "", link: "", description: "", kind: "verein", is_active: true, order_index: 0,
  about: "", since: "", discord_invite: "", discord_guild_id: "", twitch_channel: "",
  youtube_url: "", x_url: "", instagram_url: "", tiktok_url: "", tools: [],
};

const emptyTool = () => ({ id: "", title: "", url: "", description: "", image_url: "", embed: false });

// Null aus der Datenbank wird zum leeren Feld; Tools bekommen alle Felder.
export function formFromPartner(partner) {
  const form = { ...emptyPartner };
  for (const [key, value] of Object.entries(partner || {})) {
    if (key === "tools") continue;
    form[key] = value === null || value === undefined ? (emptyPartner[key] ?? "") : value;
  }
  form.tools = (Array.isArray(partner?.tools) ? partner.tools : []).map((tool) => ({
    ...emptyTool(), ...tool, description: tool.description || "", image_url: tool.image_url || "", embed: Boolean(tool.embed),
  }));
  return form;
}

// Leere Tool-Zeilen (weder Titel noch Adresse) gehen nicht mit; alles andere prüft der Server.
export function partnerPayload(form) {
  const tools = (form.tools || []).filter((tool) => String(tool.title || "").trim() || String(tool.url || "").trim());
  return { ...form, tools };
}

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
          <p className="mt-2 text-white/60 text-sm max-w-xl">Befreundete Vereine, Veranstalter und Communitys. Jeder Partner hat eine eigene Seite mit Kanälen, Twitch-Live, Discord, Tools und gemeinsamen News.</p>
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
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {p.slug && (
                <a href={`/partners/${p.slug}`} target="_blank" rel="noreferrer" data-testid={`partner-page-${p.id}`} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">
                  Seite ansehen <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {p.link && <a href={p.link} target="_blank" rel="noreferrer" className="text-white/45 hover:text-white truncate max-w-full">{p.link}</a>}
            </div>
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
  const [form, setForm] = useState(() => formFromPartner(partner));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = partnerPayload(form);
      if (isNew) await api.post("/partners", payload);
      else await api.patch(`/partners/${partner.id}`, payload);
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
      <TextField label="Website" value={form.link} onChange={(v) => set("link", v)} placeholder="https://…" testId="partner-link" />
      <FormGrid>
        <TextField label="Typ" value={form.kind} onChange={(v) => set("kind", v)} placeholder="Verein, Messe, Community" testId="partner-kind" {...lock("kind")} />
        <TextField label="Reihenfolge" type="number" value={form.order_index} onChange={(v) => set("order_index", Number(v) || 0)} testId="partner-order" />
      </FormGrid>
      <CheckField label="Aktiv" checked={form.is_active !== false} onChange={(v) => set("is_active", v)} testId="partner-active" />
      <TextAreaField label="Kurzbeschreibung" value={form.description} onChange={(v) => set("description", v)} testId="partner-description" hint="Steht in der Partnerliste und im Kopf der Partnerseite." />

      <FormSection title="Partnerseite" hint={`Eigene Seite unter /partners/${form.slug || "…"} – Adresse, „seit“ und der längere Text.`} plain testId="partner-page-section">
        <FormGrid>
          <TextField label="Adresse (Slug)" value={form.slug} onChange={(v) => set("slug", v)} placeholder="wird aus dem Namen gebildet" testId="partner-slug" hint={isNew ? "" : "Die alte Adresse leitet weiter."} />
          <TextField label="Partner seit" value={form.since} onChange={(v) => set("since", v)} placeholder="2025" testId="partner-since" />
        </FormGrid>
        <TextAreaField label="Über den Partner" rows={5} value={form.about} onChange={(v) => set("about", v)} testId="partner-about" hint="Längerer Text für die Partnerseite; Absätze bleiben erhalten." />
      </FormSection>

      <FormSection title="Kanäle" hint="Für „x gerade online“ muss der Partner in seinem Discord das Widget einschalten (Server-Einstellungen → Widget); Twitch-Live läuft über die Twitch-App der Website (Verbindungen → Twitch)." plain testId="partner-channels-section">
        <FormGrid>
          <TextField label="Discord-Einladung" value={form.discord_invite} onChange={(v) => set("discord_invite", v)} placeholder="discord.gg/…" testId="partner-discord-invite" />
          <TextField label="Discord-Server-ID" value={form.discord_guild_id} onChange={(v) => set("discord_guild_id", v)} placeholder="123456789012345678" testId="partner-discord-guild" />
          <TextField label="Twitch-Kanal" value={form.twitch_channel} onChange={(v) => set("twitch_channel", v)} placeholder="pineapps" testId="partner-twitch-channel" />
          <TextField label="YouTube" value={form.youtube_url} onChange={(v) => set("youtube_url", v)} placeholder="https://youtube.com/@…" testId="partner-youtube" />
          <TextField label="X (Twitter)" value={form.x_url} onChange={(v) => set("x_url", v)} placeholder="https://x.com/…" testId="partner-x" />
          <TextField label="Instagram" value={form.instagram_url} onChange={(v) => set("instagram_url", v)} placeholder="https://instagram.com/…" testId="partner-instagram" />
          <TextField label="TikTok" value={form.tiktok_url} onChange={(v) => set("tiktok_url", v)} placeholder="https://tiktok.com/@…" testId="partner-tiktok" />
        </FormGrid>
      </FormSection>

      <FormSection title="Tools & Projekte" hint="Seiten des Partners, zum Beispiel ein TFT-Dashboard. „Einbetten“ zeigt die Seite direkt auf der Partnerseite – nur, wenn die Seite des Partners das zulässt." plain testId="partner-tools-section">
        <ToolsEditor tools={form.tools} onChange={(tools) => set("tools", tools)} />
      </FormSection>
    </AdminSheet>
  );
}

function ToolsEditor({ tools, onChange }) {
  const update = (index, patch) => onChange(tools.map((tool, i) => (i === index ? { ...tool, ...patch } : tool)));
  const remove = (index) => onChange(tools.filter((_, i) => i !== index));
  return (
    <div className="space-y-3" data-testid="partner-tools">
      {tools.map((tool, index) => (
        <div key={tool.id || `neu-${index}`} className="border border-white/10 rounded-sm p-3 space-y-3 bg-[#0A0A0A]" data-testid={`partner-tool-${index}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Eintrag {index + 1}</span>
            <button type="button" onClick={() => remove(index)} data-testid={`partner-tool-remove-${index}`} aria-label="Eintrag entfernen" className="text-white/40 hover:text-[#FF3B30]"><Trash2 className="w-4 h-4" /></button>
          </div>
          <FormGrid>
            <TextField label="Titel" value={tool.title} onChange={(v) => update(index, { title: v })} placeholder="TFT Dashboard" testId={`partner-tool-title-${index}`} />
            <TextField label="Adresse" value={tool.url} onChange={(v) => update(index, { url: v })} placeholder="https://…" testId={`partner-tool-url-${index}`} />
          </FormGrid>
          <TextAreaField label="Beschreibung" rows={2} value={tool.description} onChange={(v) => update(index, { description: v })} testId={`partner-tool-description-${index}`} />
          <ImageUpload value={tool.image_url} onChange={(v) => update(index, { image_url: v })} label="Bild (optional)" testId={`partner-tool-image-${index}`} variant="wide" allowLibrary />
          <CheckField label="Auf der Partnerseite einbetten" checked={tool.embed} onChange={(v) => update(index, { embed: v })} testId={`partner-tool-embed-${index}`} hint="Bleibt der Rahmen leer, lässt die Seite das Einbetten nicht zu – dann bleibt der Link." />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...tools, emptyTool()])} data-testid="partner-tool-add" className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 rounded-sm text-[10px] font-bold uppercase tracking-wider text-white/70 hover:text-[#29B6E8] hover:border-[#29B6E8]/60">
        <Plus className="w-3.5 h-3.5" /> Tool oder Projekt hinzufügen
      </button>
    </div>
  );
}
