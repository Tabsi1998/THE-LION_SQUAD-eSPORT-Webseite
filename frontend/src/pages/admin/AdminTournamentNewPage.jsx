import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { normalizeDateTimeFields } from "@/lib/datetime";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { TOURNAMENT_FORMAT_OPTIONS } from "@/lib/tournamentLabels";
import { gameOptionLabel } from "@/lib/gameLabels";
import { RULE_PRESETS, ruleModeSummary, rulePresetKey, rulePresetWarnings } from "@/lib/tournamentRulePresets";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

const CREATE_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
];

const EVENT_MODE_OPTIONS = [["online", "Online"], ["local", "Vor Ort"], ["hybrid", "Hybrid"]];
const RESULT_ENTRY_MODE_OPTIONS = [["", "Automatisch passend"], ["staff_only", "Nur Turnierleitung"], ["player_confirmed", "Beide Parteien melden"], ["hybrid", "Hybrid"]];
const SCHEDULE_MODE_OPTIONS = [["", "Automatisch passend"], ["fixed_by_staff", "Fix durch Turnierleitung"], ["player_proposal", "Teilnehmer schlagen vor"], ["hybrid", "Hybrid"]];

const PRIZE_GROUP_OPTIONS = [
  ["overall", "Gesamtwertung"],
  ["winner", "Gewinner-Bracket"],
  ["loser", "Loser-Bracket"],
  ["special", "Sonderpreis"],
];
const BRONZE_FORMATS = new Set(["single_elim"]);

function dateFromInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildPlanningWarnings(form, isTeam) {
  const warnings = [];
  const minParticipants = Number(form.min_participants || 0);
  const maxParticipants = Number(form.max_participants || 0);
  const start = dateFromInput(form.start_date);
  const end = dateFromInput(form.end_date);
  const registrationFrom = dateFromInput(form.registration_open_from);
  const registrationUntil = dateFromInput(form.registration_open_until);
  const checkinFrom = dateFromInput(form.check_in_from);
  const checkinUntil = dateFromInput(form.check_in_until);

  if (minParticipants && maxParticipants && minParticipants > maxParticipants) {
    warnings.push(`${isTeam ? "Min Teams" : "Min Spieler"} ist groesser als ${isTeam ? "Max Teams" : "Max Spieler"}.`);
  }
  if (start && end && end < start) warnings.push("Das Ende liegt vor dem Start.");
  if (registrationFrom && registrationUntil && registrationUntil < registrationFrom) warnings.push("Die Anmeldung endet vor ihrer Oeffnung.");
  if (checkinFrom && checkinUntil && checkinUntil < checkinFrom) warnings.push("Der Check-in endet vor seiner Oeffnung.");
  if (registrationUntil && start && registrationUntil > start) warnings.push("Die Anmeldung endet nach dem Turnierstart.");
  if (checkinUntil && start && checkinUntil > start) warnings.push("Der Check-in endet nach dem Turnierstart.");
  if (form.status === "scheduled" && !form.start_date) warnings.push("Angekuendigte Turniere sollten eine Startzeit haben.");
  if (form.twitch_enabled && !String(form.twitch_channel || "").trim()) warnings.push("Twitch ist aktiv, aber kein Kanal ist eingetragen.");
  return warnings;
}

export default function AdminTournamentNewPage() {
  const nav = useNavigate();
  const [games, setGames] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({
    title: "", slug: "", description: "", game_id: "",
    platform: "", event_id: "", format: "single_elim", format_label: "",
    team_mode: "solo", team_size: 1,
    max_participants: 16, min_participants: 2,
    registration_enabled: true, is_invite_only: false, block_club_member_registration: false,
    registration_open_from: "", registration_open_until: "",
    check_in_from: "", check_in_until: "",
    start_date: "", end_date: "",
    status: "draft",
    site_banner_enabled: false,
    auto_start_enabled: false,
    event_mode: "online", result_entry_mode: "", schedule_mode: "",
    best_of: 1, bronze_match: false, seeding_mode: "random",
    is_public: true, rules: "", prize_pool: "",
    banner_url: "",
    prize_places: [
      { group: "overall", place: 1, label: "1. Platz", value: "" },
      { group: "overall", place: 2, label: "2. Platz", value: "" },
      { group: "overall", place: 3, label: "3. Platz", value: "" },
    ],
    twitch_channel: "", twitch_enabled: false, show_chat: false,
    location: "", stream_link: "", discord_link: "",
  });
  const [saving, setSaving] = useState(false);
  const isTeam = form.team_mode === "team";
  const planningWarnings = buildPlanningWarnings(form, isTeam);

  const loadSources = useCallback(() => {
    api.get("/games").then(({ data }) => setGames(data));
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data));
  }, []);
  useEffect(() => { loadSources(); }, [loadSources]);
  useApiInvalidation(loadSources, ["games", "events"]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const applyRulePreset = (preset) => setForm((f) => ({ ...f, ...preset.values }));
  const setTeamMode = (value) => setForm((f) => ({ ...f, team_mode: value, team_size: value === "solo" ? 1 : Math.max(2, Number(f.team_size) || 2) }));
  const setFormat = (value) => setForm((f) => ({ ...f, format: value, bronze_match: BRONZE_FORMATS.has(value) ? f.bronze_match : false }));
  const addPrizeTop3 = (group) => set("prize_places", [
    ...(form.prize_places || []),
    ...[1, 2, 3].map((place) => ({ group, place, label: `${place}. Platz`, value: "" })),
  ]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form };
      payload.team_mode = payload.team_mode === "solo" ? "solo" : "team";
      payload.team_size = payload.team_mode === "solo" ? 1 : Number(payload.team_size || 2);
      payload.format_label = (payload.format_label || "").trim() || null;
      if (!payload.result_entry_mode) payload.result_entry_mode = null;
      if (!payload.schedule_mode) payload.schedule_mode = null;
      if (!BRONZE_FORMATS.has(payload.format)) payload.bronze_match = false;
      if (!payload.event_id) delete payload.event_id;
      normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "check_in_from", "check_in_until", "start_date", "end_date"]);
      // Filter empty prize places
      payload.prize_places = (payload.prize_places || [])
        .filter((p) => p.value && p.value.trim())
        .map((p) => ({
          group: p.group || "overall",
          place: p.place === "last" ? "last" : Number(p.place) || 0,
          label: p.label || (p.place === "last" ? "Letzter Platz" : `Platz ${p.place}`),
          value: p.value,
        }));
      if (payload.prize_places.length === 0) payload.prize_places = null;
      const { data } = await api.post("/tournaments", payload);
      toast.success(data?.auto_generated_bracket?.match_count
        ? `Turnier erstellt. Vorschau mit ${data.auto_generated_bracket.match_count} Spielen angelegt.`
        : "Turnier erstellt.");
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
          <Select label="Spiel *" value={form.game_id} onChange={(v) => set("game_id", v)} options={[["", "— auswählen —"], ...games.map((g) => [g.id, gameOptionLabel(g)])]} required testId="new-tr-game" />
        </Row>
        <Row>
          <Select label="Format" value={form.format} onChange={setFormat} options={TOURNAMENT_FORMAT_OPTIONS} testId="new-tr-format" />
          <Field label="Format-Anzeigename" value={form.format_label} onChange={(v) => set("format_label", v)} placeholder="z.B. Gamers Heaven F1 Heat" testId="new-tr-format-label" />
          <Select label="Teilnahme" value={form.team_mode} onChange={setTeamMode} options={[["solo", "Einzelspieler"], ["team", "Team"]]} testId="new-tr-mode" />
        </Row>
        <Row>
          {isTeam && <Field label="Spieler pro Team" type="number" min="2" max="6" value={form.team_size} onChange={(v) => set("team_size", Number(v))} testId="new-tr-team-size" />}
          <Field label={isTeam ? "Max Teams" : "Max Spieler"} type="number" value={form.max_participants} onChange={(v) => set("max_participants", Number(v))} testId="new-tr-max" />
          <Field label={isTeam ? "Min Teams" : "Min Spieler"} type="number" value={form.min_participants} onChange={(v) => set("min_participants", Number(v))} testId="new-tr-min" />
        </Row>
        <div className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Zeitplan & Anmeldung</div>
          <Row>
            <Select label="Veröffentlichung" value={form.status} onChange={(v) => set("status", v)} options={CREATE_STATUS_OPTIONS} testId="new-tr-status" />
            <Field label="Start Event/Turnier" type="datetime-local" value={form.start_date} onChange={(v) => set("start_date", v)} testId="new-tr-start" />
            <Field label="Anmeldung endet" type="datetime-local" value={form.registration_open_until} onChange={(v) => set("registration_open_until", v)} testId="new-tr-reg-until" />
          </Row>
          <div className="border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-3 text-xs text-white/55">
            Anmeldung und Check-in koennen zeitgesteuert wechseln. Live-Start und echte Matchstarts bleiben standardmaessig bei der Turnierleitung.
          </div>
          <Row>
            <Select label="Austragung" value={form.event_mode} onChange={(v) => set("event_mode", v)} options={EVENT_MODE_OPTIONS} testId="new-tr-event-mode" />
            <Select label="Ergebniserfassung" value={form.result_entry_mode || ""} onChange={(v) => set("result_entry_mode", v || null)} options={RESULT_ENTRY_MODE_OPTIONS} testId="new-tr-result-entry-mode" />
            <Select label="Terminplanung" value={form.schedule_mode || ""} onChange={(v) => set("schedule_mode", v || null)} options={SCHEDULE_MODE_OPTIONS} testId="new-tr-schedule-mode" />
          </Row>
          <RulePresetPicker form={form} onApply={applyRulePreset} />
          <div className="border border-white/10 bg-black/20 rounded-sm p-3 text-xs text-white/55">
            Vor-Ort-Turniere werden standardmaessig durch die Turnierleitung gewertet und geplant. Online-Turniere erlauben standardmaessig Ergebnisberichte beider Parteien und Terminvorschlaege.
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" checked={form.registration_enabled} onChange={(e) => set("registration_enabled", e.target.checked)} data-testid="new-tr-reg-enabled" className="accent-[#29B6E8] mt-1" />
              <span>Öffentliche Anmeldung grundsätzlich erlauben</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" checked={form.site_banner_enabled} onChange={(e) => set("site_banner_enabled", e.target.checked)} data-testid="new-tr-site-banner" className="accent-[#FFD700] mt-1" />
              <span>Automatisches Turnier-Hinweisbanner für dieses Turnier anzeigen</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-white/75 sm:col-span-2">
              <input type="checkbox" checked={form.auto_start_enabled} onChange={(e) => set("auto_start_enabled", e.target.checked)} data-testid="new-tr-auto-start" className="accent-[#29B6E8] mt-1" />
              <span>Turnier anhand Start-/Endzeit automatisch live/beendet schalten. Für Vor-Ort-Turniere ausgeschaltet lassen.</span>
            </label>
          </div>
          <Details title="Weitere Zeiten und Sonderfälle">
            <Row>
              <Field label="Ende Event/Turnier" type="datetime-local" value={form.end_date} onChange={(v) => set("end_date", v)} testId="new-tr-end" />
              <Field label="Anmeldung öffnet" type="datetime-local" value={form.registration_open_from} onChange={(v) => set("registration_open_from", v)} testId="new-tr-reg-from" />
              <Field label="Check-in öffnet" type="datetime-local" value={form.check_in_from} onChange={(v) => set("check_in_from", v)} testId="new-tr-checkin-from" />
              <Field label="Check-in endet" type="datetime-local" value={form.check_in_until} onChange={(v) => set("check_in_until", v)} testId="new-tr-checkin-until" />
            </Row>
            <label className="mt-3 flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" checked={form.is_invite_only} onChange={(e) => set("is_invite_only", e.target.checked)} data-testid="new-tr-invite-only" className="accent-[#29B6E8] mt-1" />
              <span>Nur Einladung/manuelle Teilnehmer, keine öffentliche Anmeldung</span>
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm text-white/75">
              <input type="checkbox" checked={form.block_club_member_registration} onChange={(e) => set("block_club_member_registration", e.target.checked)} data-testid="new-tr-block-members" className="accent-[#FFD700] mt-1" />
              <span>Vereinsmitglieder von der Selbstanmeldung ausschließen, z.B. wenn wir das Turnier für externe Teilnehmer veranstalten</span>
            </label>
          </Details>
        </div>
        <Details title="Darstellung und Regeln">
          <Row>
            <Field label="Slug (URL)" value={form.slug} onChange={(v) => set("slug", autoSlug(v))} required testId="new-tr-slug" />
            <Field label="Plattform" value={form.platform} onChange={(v) => set("platform", v)} placeholder="z.B. Nintendo Switch" testId="new-tr-platform" />
            <Select label="Event" value={form.event_id || ""} onChange={(v) => set("event_id", v)} options={[["", "— keins —"], ...events.map((e) => [e.id, e.name])]} testId="new-tr-event" />
          </Row>
          <Textarea label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="new-tr-description" />
          <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} label="Turnier-Banner" testId="new-tr-banner-upload" variant="wide" allowLibrary />
          <Textarea label="Regeln" value={form.rules} onChange={(v) => set("rules", v)} testId="new-tr-rules" />
        </Details>
        <Details title="Spieloptionen">
          <Row>
            <Field label="Best of" type="number" value={form.best_of} onChange={(v) => set("best_of", Number(v))} testId="new-tr-bestof" />
            <Select label="Seeding" value={form.seeding_mode} onChange={(v) => set("seeding_mode", v)} options={[["random", "Zufall"], ["manual", "Manuell"], ["ranking", "Ranking"]]} testId="new-tr-seeding" />
          </Row>
          {BRONZE_FORMATS.has(form.format) && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.bronze_match} onChange={(e) => set("bronze_match", e.target.checked)} data-testid="new-tr-bronze" className="accent-[#29B6E8]" />
              <span>Spiel um Platz 3 ermitteln</span>
            </label>
          )}
        </Details>

        {/* Structured Prize Places */}
        <Details title="Preise">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#FFD700]">Preise (strukturiert)</div>
              <div className="text-xs text-white/50 mt-0.5">Jede Zeile erscheint als eigene Preis-Karte auf der Turnierseite.</div>
            </div>
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => addPrizeTop3("winner")} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">+ Gewinner Top 3</button>
              <button type="button" onClick={() => addPrizeTop3("loser")} className="text-xs font-bold uppercase tracking-wider text-[#CD7F32] hover:text-white">+ Loser Top 3</button>
              <button type="button" onClick={() => set("prize_places", [...form.prize_places, { group: "overall", place: form.prize_places.length + 1, label: `Platz ${form.prize_places.length + 1}`, value: "" }])} data-testid="new-tr-prize-add" className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">+ Platz hinzufügen</button>
              <button type="button" onClick={() => set("prize_places", [...form.prize_places, { group: "overall", place: "last", label: "Letzter Platz", value: "" }])} data-testid="new-tr-prize-last" className="text-xs font-bold uppercase tracking-wider text-[#FFD700] hover:text-white">+ Letzter Platz</button>
            </div>
          </div>
          {form.prize_places.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <select value={p.group || "overall"} onChange={(e) => {
                const np = [...form.prize_places]; np[i] = { ...p, group: e.target.value }; set("prize_places", np);
              }} className="col-span-12 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
                {PRIZE_GROUP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={p.place} onChange={(e) => {
                const np = [...form.prize_places]; np[i] = { ...p, place: e.target.value === "last" ? "last" : Number(e.target.value) || 1 }; set("prize_places", np);
              }} data-testid={`new-tr-prize-place-${i}`} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
                {[1,2,3,4,5,6,7,8].map((n) => <option key={n} value={n}>{n}.</option>)}
                <option value="last">Letzter</option>
              </select>
              <input value={p.label || ""} onChange={(e) => {
                const np = [...form.prize_places]; np[i] = { ...p, label: e.target.value }; set("prize_places", np);
              }} data-testid={`new-tr-prize-label-${i}`} className="col-span-4 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Label (z.B. Champion)" />
              <input value={p.value || ""} onChange={(e) => {
                const np = [...form.prize_places]; np[i] = { ...p, value: e.target.value }; set("prize_places", np);
              }} data-testid={`new-tr-prize-value-${i}`} className="col-span-5 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Preis (z.B. 100 €)" />
              <button type="button" onClick={() => set("prize_places", form.prize_places.filter((_, j) => j !== i))} data-testid={`new-tr-prize-remove-${i}`} className="col-span-1 text-white/40 hover:text-[#FF3B30] text-center py-2">✕</button>
            </div>
          ))}
          <Textarea label="Fallback Text (freier Preis-Text, falls nicht strukturiert)" value={form.prize_pool} onChange={(v) => set("prize_pool", v)} testId="new-tr-prizes" />
        </Details>

        {/* Streaming + Links */}
        <Details title="Streaming und externe Links">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#9146FF]">Streaming &amp; Verweise</div>
          <Row>
            <Field label="Twitch-Kanal" value={form.twitch_channel} onChange={(v) => set("twitch_channel", v)} testId="new-tr-twitch" placeholder="the_lion_squad_esports" />
            <Field label="Ort" value={form.location} onChange={(v) => set("location", v)} testId="new-tr-location" placeholder="z.B. Gamers Heaven · Bregenz" />
          </Row>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.twitch_enabled} onChange={(e) => set("twitch_enabled", e.target.checked)} data-testid="new-tr-twitch-enabled" className="accent-[#9146FF]" />
            <span>Twitch-Player auf Turnierseite einbetten</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.show_chat} onChange={(e) => set("show_chat", e.target.checked)} data-testid="new-tr-chat-enabled" className="accent-[#9146FF]" />
            <span>Turnier-Chat für Teilnehmer anzeigen</span>
          </label>
          <Row>
            <Field label="Externer Stream-Verweis" value={form.stream_link} onChange={(v) => set("stream_link", v)} testId="new-tr-stream" placeholder="https://…" />
            <Field label="Discord-Einladung" value={form.discord_link} onChange={(v) => set("discord_link", v)} testId="new-tr-discord" placeholder="https://discord.com/invite/…" />
          </Row>
        </Details>
        {planningWarnings.length > 0 && (
          <div className="rounded-sm border border-[#FFD700]/30 bg-[#FFD700]/5 p-4 text-sm text-[#FFD700]" data-testid="new-tr-planning-warnings">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="space-y-1">
                <div className="text-[11px] font-bold uppercase tracking-widest">Planung pruefen</div>
                {planningWarnings.map((warning) => <div key={warning}>{warning}</div>)}
              </div>
            </div>
          </div>
        )}
        <button disabled={saving} data-testid="new-tr-submit" className="px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
          {saving ? "Erstelle …" : "Turnier erstellen"}
        </button>
      </form>
    </AdminLayout>
  );
}

function Row({ children }) { return <div className="grid md:grid-cols-2 gap-4">{children}</div>; }
function Details({ title, children }) {
  return (
    <details className="border border-white/10 bg-[#121212] rounded-sm p-4 group">
      <summary className="cursor-pointer select-none text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">{title}</summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
  );
}
function Field({ label, value, onChange, type = "text", required, placeholder, testId, min, max }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input type={type} min={min} max={max} value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={required} placeholder={placeholder} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2 rounded-sm text-white focus:outline-none" />
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
    <div className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <MarkdownEditor value={value || ""} onChange={onChange} rows={5} testId={testId} />
    </div>
  );
}

function RulePresetPicker({ form, onApply }) {
  const activeKey = rulePresetKey(form);
  const warnings = rulePresetWarnings(form);
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
      <div className="flex flex-wrap gap-2">
        {RULE_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onApply(preset)}
            className={`px-3 py-2 border rounded-sm text-xs uppercase tracking-wider font-bold ${activeKey === preset.key ? "border-[#29B6E8] bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/60 hover:text-white"}`}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="mt-2 text-xs text-white/55">{ruleModeSummary(form)}</div>
      {warnings.length > 0 && <div className="mt-2 text-xs text-[#FFD700]">{warnings.join(" ")}</div>}
    </div>
  );
}
