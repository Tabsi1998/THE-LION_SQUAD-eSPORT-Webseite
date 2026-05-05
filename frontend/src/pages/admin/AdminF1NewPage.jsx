import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { normalizeDateTimeFields } from "@/lib/datetime";
import { toast } from "sonner";

export default function AdminF1NewPage() {
  const nav = useNavigate();
  const [form, setForm] = useState({
    title: "", slug: "", description: "",
    vehicle: "", weather: "", assists_allowed: "",
    controller_type: "", platform: "", banner_url: "",
    unlimited_attempts: true, max_attempts: 0,
    registration_enabled: true, registration_open_from: "", registration_open_until: "",
    start_date: "", end_date: "", status: "draft",
    is_championship: false,
    twitch_channel: "", twitch_enabled: false,
    prize_places: [],
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (payload.unlimited_attempts) payload.max_attempts = null;
      normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "start_date", "end_date"]);
      payload.prize_places = (payload.prize_places || [])
        .filter((p) => p.value && p.value.trim())
        .map((p) => ({ place: Number(p.place) || 0, label: p.label || `Platz ${p.place}`, value: p.value }));
      if (payload.prize_places.length === 0) payload.prize_places = null;
      const { data } = await api.post("/f1/challenges", payload);
      toast.success("Challenge erstellt.");
      nav(`/admin/f1/${data.id}`);
    } catch (err) { toast.error(formatApiError(err.response?.data?.detail)); }
    setSaving(false);
  };

  const autoSlug = (t) => (t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Fast Lap</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Neue Challenge</h1>
      <form onSubmit={submit} className="max-w-2xl space-y-4">
        <Field label="Titel" value={form.title} onChange={(v) => { set("title", v); if (!form.slug) set("slug", autoSlug(v)); }} required testId="f1-new-title" />
        <Field label="Slug (URL)" value={form.slug} onChange={(v) => set("slug", autoSlug(v))} required testId="f1-new-slug" />
        <Textarea label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="f1-new-description" />
        <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} label="Challenge-Banner" testId="f1-new-banner-upload" variant="wide" allowLibrary />
        <div className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Zeitplan & Einreichung</div>
          <div className="grid md:grid-cols-2 gap-4">
            <Select label="Initialer Status" value={form.status} onChange={(v) => set("status", v)} options={[
              ["draft", "Entwurf"],
              ["scheduled", "Warten auf Registrierung/Event"],
              ["registration_open", "Einreichung offen"],
              ["registration_closed", "Einreichung geschlossen"],
              ["live", "Live"],
            ]} testId="f1-new-status" />
            <Field label="Start Challenge/Event" type="datetime-local" value={form.start_date} onChange={(v) => set("start_date", v)} testId="f1-new-start" />
            <Field label="Ende Challenge/Event" type="datetime-local" value={form.end_date} onChange={(v) => set("end_date", v)} testId="f1-new-end" />
            <Field label="Einreichung öffnet" type="datetime-local" value={form.registration_open_from} onChange={(v) => set("registration_open_from", v)} testId="f1-new-reg-from" />
            <Field label="Einreichung endet" type="datetime-local" value={form.registration_open_until} onChange={(v) => set("registration_open_until", v)} testId="f1-new-reg-until" />
          </div>
          <label className="flex items-start gap-2 text-sm text-white/75">
            <input type="checkbox" checked={form.registration_enabled} onChange={(e) => set("registration_enabled", e.target.checked)} data-testid="f1-new-reg-enabled" className="accent-[#29B6E8] mt-1" />
            <span>Zeiten/Einreichungen grundsätzlich erlauben</span>
          </label>
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Fahrzeug" value={form.vehicle} onChange={(v) => set("vehicle", v)} testId="f1-new-vehicle" />
          <Field label="Wetter" value={form.weather} onChange={(v) => set("weather", v)} testId="f1-new-weather" />
          <Field label="Fahrhilfen" value={form.assists_allowed} onChange={(v) => set("assists_allowed", v)} testId="f1-new-assists" />
          <Field label="Controller-Typ" value={form.controller_type} onChange={(v) => set("controller_type", v)} testId="f1-new-controller" />
          <Field label="Plattform" value={form.platform} onChange={(v) => set("platform", v)} testId="f1-new-platform" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="f1-new-championship" checked={form.is_championship} onChange={(e) => set("is_championship", e.target.checked)} className="accent-[#29B6E8]" />
          <span>Championship (mehrere Strecken + Punkte pro Platz)</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" data-testid="f1-new-unlimited" checked={form.unlimited_attempts} onChange={(e) => set("unlimited_attempts", e.target.checked)} className="accent-[#29B6E8]" />
          <span>Unbegrenzte Versuche</span>
        </label>
        {!form.unlimited_attempts && <Field label="Max Versuche" type="number" value={form.max_attempts} onChange={(v) => set("max_attempts", Number(v))} testId="f1-new-max-attempts" />}

        <div className="border border-[#9146FF]/20 bg-[#9146FF]/5 rounded-sm p-4 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#9146FF]">Streaming</div>
          <Field label="Twitch Channel" value={form.twitch_channel} onChange={(v) => set("twitch_channel", v)} testId="f1-new-twitch" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.twitch_enabled} onChange={(e) => set("twitch_enabled", e.target.checked)} data-testid="f1-new-twitch-enabled" className="accent-[#9146FF]" />
            <span>Twitch-Player auf F1-Seite einbetten</span>
          </label>
        </div>

        <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Preise (strukturiert)</div>
              <div className="text-xs text-white/50 mt-0.5">z.B. Tagessieger Samstag / Sonntag</div>
            </div>
            <button type="button" onClick={() => set("prize_places", [...(form.prize_places || []), { place: (form.prize_places?.length || 0) + 1, label: "", value: "" }])} data-testid="f1-new-prize-add" className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">+ Platz hinzufügen</button>
          </div>
          {(form.prize_places || []).map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input type="number" min="1" value={p.place} onChange={(e) => { const np=[...form.prize_places]; np[i]={...p,place:Number(e.target.value)||1}; set("prize_places",np); }} data-testid={`f1-new-prize-place-${i}`} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm tabular-nums" placeholder="#" />
              <input value={p.label || ""} onChange={(e) => { const np=[...form.prize_places]; np[i]={...p,label:e.target.value}; set("prize_places",np); }} data-testid={`f1-new-prize-label-${i}`} className="col-span-4 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Label" />
              <input value={p.value || ""} onChange={(e) => { const np=[...form.prize_places]; np[i]={...p,value:e.target.value}; set("prize_places",np); }} data-testid={`f1-new-prize-value-${i}`} className="col-span-5 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Preis" />
              <button type="button" onClick={() => set("prize_places", form.prize_places.filter((_, j) => j !== i))} data-testid={`f1-new-prize-remove-${i}`} className="col-span-1 text-white/40 hover:text-[#FF3B30] text-center py-2">✕</button>
            </div>
          ))}
        </div>

        <button disabled={saving} data-testid="f1-new-submit" className="px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
          {saving ? "Erstelle…" : "Challenge erstellen"}
        </button>
      </form>
    </AdminLayout>
  );
}

function Field({ label, value, onChange, type = "text", required, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none" />
    </label>
  );
}
function Select({ label, value, onChange, options, required, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} required={required} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
function Textarea({ label, value, onChange, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none" />
    </label>
  );
}
