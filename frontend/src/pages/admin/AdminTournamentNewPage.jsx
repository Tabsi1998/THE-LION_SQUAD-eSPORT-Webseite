import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { normalizeDateTimeFields } from "@/lib/datetime";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";

const FORMATS = [
  ["single_elim", "Single Elimination"],
  ["double_elim", "Double Elimination"],
  ["round_robin", "Round Robin"],
  ["swiss", "Swiss (Struktur, Matches manuell)"],
  ["groups", "Group Stage"],
  ["ffa", "Free For All"],
  ["battle_royale", "Battle Royale"],
  ["league", "Liga"],
  ["time_trial", "Time Trial"],
  ["grand_prix", "Grand Prix"],
];

export default function AdminTournamentNewPage() {
  const nav = useNavigate();
  const [games, setGames] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({
    title: "", slug: "", description: "", game_id: "",
    platform: "", event_id: "", format: "single_elim",
    team_mode: "solo", team_size: 1,
    max_participants: 16, min_participants: 2,
    registration_enabled: true, is_invite_only: false,
    registration_open_from: "", registration_open_until: "",
    check_in_from: "", check_in_until: "",
    start_date: "", end_date: "",
    status: "draft",
    best_of: 1, bronze_match: false, seeding_mode: "random",
    is_public: true, rules: "", prize_pool: "",
    banner_url: "",
    prize_places: [
      { place: 1, label: "1. Platz", value: "" },
      { place: 2, label: "2. Platz", value: "" },
      { place: 3, label: "3. Platz", value: "" },
    ],
    twitch_channel: "", twitch_enabled: false,
    location: "", stream_link: "", discord_link: "",
  });
  const [saving, setSaving] = useState(false);

  const loadSources = useCallback(() => {
    api.get("/games").then(({ data }) => setGames(data));
    api.get("/events").then(({ data }) => setEvents(data));
  }, []);
  useEffect(() => { loadSources(); }, [loadSources]);
  useApiInvalidation(loadSources, ["games", "events"]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.event_id) delete payload.event_id;
      normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "check_in_from", "check_in_until", "start_date", "end_date"]);
      // Filter empty prize places
      payload.prize_places = (payload.prize_places || [])
        .filter((p) => p.value && p.value.trim())
        .map((p) => ({ place: p.place === "last" ? "last" : Number(p.place) || 0, label: p.label || (p.place === "last" ? "Letzter Platz" : `Platz ${p.place}`), value: p.value }));
      if (payload.prize_places.length === 0) payload.prize_places = null;
      const { data } = await api.post("/tournaments", payload);
      toast.success("Turnier erstellt.");
      nav(`/admin/tournaments/${data.id}`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally { setSaving(false); }
  };

  const autoSlug = (title) => (title || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

  return (
    <AdminLayout>
      <div className="mb-6">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Wizard</span>
        <h1 className="font-heading text-3xl md:text-4xl font-black uppercase">Neues Turnier</h1>
      </div>
      <form onSubmit={submit} className="max-w-3xl space-y-5">
        <Row>
          <Field label="Titel" value={form.title} onChange={(v) => { set("title", v); if (!form.slug) set("slug", autoSlug(v)); }} required testId="new-tr-title" />
          <Field label="Slug (URL)" value={form.slug} onChange={(v) => set("slug", autoSlug(v))} required testId="new-tr-slug" />
        </Row>
        <Textarea label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="new-tr-description" />
        <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} label="Turnier-Banner" testId="new-tr-banner-upload" variant="wide" allowLibrary />
        <div className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Zeitplan & Anmeldung</div>
          <Row>
            <Select label="Initialer Status" value={form.status} onChange={(v) => set("status", v)} options={[
              ["draft", "Entwurf"],
              ["scheduled", "Warten auf Registrierung/Event"],
              ["registration_open", "Anmeldung offen"],
              ["registration_closed", "Anmeldung geschlossen"],
              ["live", "Live"],
            ]} testId="new-tr-status" />
            <Field label="Start Event/Turnier" type="datetime-local" value={form.start_date} onChange={(v) => set("start_date", v)} testId="new-tr-start" />
            <Field label="Ende Event/Turnier" type="datetime-local" value={form.end_date} onChange={(v) => set("end_date", v)} testId="new-tr-end" />
            <Field label="Anmeldung öffnet" type="datetime-local" value={form.registration_open_from} onChange={(v) => set("registration_open_from", v)} testId="new-tr-reg-from" />
            <Field label="Anmeldung endet" type="datetime-local" value={form.registration_open_until} onChange={(v) => set("registration_open_until", v)} testId="new-tr-reg-until" />
            <Field label="Check-in öffnet" type="datetime-local" value={form.check_in_from} onChange={(v) => set("check_in_from", v)} testId="new-tr-checkin-from" />
            <Field label="Check-in endet" type="datetime-local" value={form.check_in_until} onChange={(v) => set("check_in_until", v)} testId="new-tr-checkin-until" />
          </Row>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" checked={form.registration_enabled} onChange={(e) => set("registration_enabled", e.target.checked)} data-testid="new-tr-reg-enabled" className="accent-[#29B6E8] mt-1" />
              <span>Öffentliche Anmeldung grundsätzlich erlauben</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" checked={form.is_invite_only} onChange={(e) => set("is_invite_only", e.target.checked)} data-testid="new-tr-invite-only" className="accent-[#29B6E8] mt-1" />
              <span>Nur Einladung/manuelle Teilnehmer, keine öffentliche Anmeldung</span>
            </label>
          </div>
        </div>
        <Row>
          <Select label="Spiel *" value={form.game_id} onChange={(v) => set("game_id", v)} options={[["", "— auswählen —"], ...games.map((g) => [g.id, g.name])]} required testId="new-tr-game" />
          <Select label="Format" value={form.format} onChange={(v) => set("format", v)} options={FORMATS} testId="new-tr-format" />
        </Row>
        <Row>
          <Field label="Plattform" value={form.platform} onChange={(v) => set("platform", v)} placeholder="z.B. Nintendo Switch" testId="new-tr-platform" />
          <Select label="Event" value={form.event_id || ""} onChange={(v) => set("event_id", v)} options={[["", "— keins —"], ...events.map((e) => [e.id, e.name])]} testId="new-tr-event" />
        </Row>
        <Row>
          <Select label="Modus" value={form.team_mode} onChange={(v) => set("team_mode", v)} options={[["solo", "Solo"], ["duo", "Duo"], ["team", "Team"], ["squad", "Squad"]]} testId="new-tr-mode" />
          <Field label="Teamgröße" type="number" value={form.team_size} onChange={(v) => set("team_size", Number(v))} testId="new-tr-team-size" />
        </Row>
        <Row>
          <Field label="Max Teilnehmer" type="number" value={form.max_participants} onChange={(v) => set("max_participants", Number(v))} testId="new-tr-max" />
          <Field label="Min Teilnehmer" type="number" value={form.min_participants} onChange={(v) => set("min_participants", Number(v))} testId="new-tr-min" />
        </Row>
        <Row>
          <Field label="Best of" type="number" value={form.best_of} onChange={(v) => set("best_of", Number(v))} testId="new-tr-bestof" />
          <Select label="Seeding" value={form.seeding_mode} onChange={(v) => set("seeding_mode", v)} options={[["random", "Zufall"], ["manual", "Manuell"], ["ranking", "Ranking"]]} testId="new-tr-seeding" />
        </Row>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.bronze_match} onChange={(e) => set("bronze_match", e.target.checked)} data-testid="new-tr-bronze" className="accent-[#29B6E8]" />
          <span>Bronze Match (Platz 3 ermitteln)</span>
        </label>
        <Textarea label="Regeln" value={form.rules} onChange={(v) => set("rules", v)} testId="new-tr-rules" />

        {/* Structured Prize Places */}
        <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Preise (strukturiert)</div>
              <div className="text-xs text-white/50 mt-0.5">Jede Zeile erscheint als eigene Preis-Karte auf der Turnierseite.</div>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => set("prize_places", [...form.prize_places, { place: form.prize_places.length + 1, label: `Platz ${form.prize_places.length + 1}`, value: "" }])} data-testid="new-tr-prize-add" className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">+ Platz hinzufügen</button>
              <button type="button" onClick={() => set("prize_places", [...form.prize_places, { place: "last", label: "Letzter Platz", value: "" }])} data-testid="new-tr-prize-last" className="text-xs font-bold uppercase tracking-wider text-[#FFD700] hover:text-white">+ Letzter Platz</button>
            </div>
          </div>
          {form.prize_places.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <select value={p.place} onChange={(e) => {
                const np = [...form.prize_places]; np[i] = { ...p, place: e.target.value === "last" ? "last" : Number(e.target.value) || 1 }; set("prize_places", np);
              }} data-testid={`new-tr-prize-place-${i}`} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
                {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}.</option>)}
                <option value="last">Letzter</option>
              </select>
              <input value={p.label || ""} onChange={(e) => {
                const np = [...form.prize_places]; np[i] = { ...p, label: e.target.value }; set("prize_places", np);
              }} data-testid={`new-tr-prize-label-${i}`} className="col-span-4 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Label (z.B. Champion)" />
              <input value={p.value || ""} onChange={(e) => {
                const np = [...form.prize_places]; np[i] = { ...p, value: e.target.value }; set("prize_places", np);
              }} data-testid={`new-tr-prize-value-${i}`} className="col-span-5 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Preis (z.B. 100 €)" />
              <button type="button" onClick={() => set("prize_places", form.prize_places.filter((_, j) => j !== i))} data-testid={`new-tr-prize-remove-${i}`} className="col-span-1 text-white/40 hover:text-[#FF3B30] text-center py-2">✕</button>
            </div>
          ))}
          <Textarea label="Fallback Text (freier Preis-Text, falls nicht strukturiert)" value={form.prize_pool} onChange={(v) => set("prize_pool", v)} testId="new-tr-prizes" />
        </div>

        {/* Streaming + Links */}
        <div className="border border-[#9146FF]/20 bg-[#9146FF]/5 rounded-sm p-4 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#9146FF]">Streaming &amp; Links</div>
          <Row>
            <Field label="Twitch Channel" value={form.twitch_channel} onChange={(v) => set("twitch_channel", v)} testId="new-tr-twitch" placeholder="the_lion_squad_esports" />
            <Field label="Location" value={form.location} onChange={(v) => set("location", v)} testId="new-tr-location" placeholder="z.B. Gamers Heaven · Bregenz" />
          </Row>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.twitch_enabled} onChange={(e) => set("twitch_enabled", e.target.checked)} data-testid="new-tr-twitch-enabled" className="accent-[#9146FF]" />
            <span>Twitch-Player auf Turnierseite einbetten</span>
          </label>
          <Row>
            <Field label="Externer Stream-Link" value={form.stream_link} onChange={(v) => set("stream_link", v)} testId="new-tr-stream" placeholder="https://…" />
            <Field label="Discord Invite" value={form.discord_link} onChange={(v) => set("discord_link", v)} testId="new-tr-discord" placeholder="https://discord.com/invite/…" />
          </Row>
        </div>
        <button disabled={saving} data-testid="new-tr-submit" className="px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
          {saving ? "Erstelle …" : "Turnier erstellen"}
        </button>
      </form>
    </AdminLayout>
  );
}

function Row({ children }) { return <div className="grid md:grid-cols-2 gap-4">{children}</div>; }
function Field({ label, value, onChange, type = "text", required, placeholder, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none" />
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
