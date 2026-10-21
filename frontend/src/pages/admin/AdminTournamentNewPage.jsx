import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { presetFor } from "@/lib/tournamentGuide";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminFormPage, FormActions, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { PartnerPicker } from "@/components/tls/PartnerPicker";
import { EventMembershipLine } from "@/pages/admin/event/EventProgramPanel";
import { CheckField, FieldLabel, SelectField, TextField } from "@/components/tls/FormFields";
import { ADVANCEMENT_MODE_OPTIONS, DRAW_SHOW_MINUTES_DEFAULT, DRAW_SHOW_MINUTES_HINT, GRAND_FINAL_FORMATS, GRAND_FINAL_HINT, GRAND_FINAL_OPTIONS, HEAT_REBUILD_FORMATS, HEAT_REBUILD_HINT, HEAT_REBUILD_OPTIONS, advancementModeHint, drawShowMinutesPayload } from "./tournament/shared";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { MarkdownEditor } from "@/components/tls/MarkdownEditor";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { TOURNAMENT_FORMAT_OPTIONS } from "@/lib/tournamentLabels";
import { gameOptionLabel } from "@/lib/gameLabels";
import { RULE_PRESETS, ruleModeSummary, rulePresetKey, rulePresetWarnings } from "@/lib/tournamentRulePresets";
import { dateWarnings } from "@/lib/tournamentDateWarnings";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";

const CREATE_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
];

const EVENT_MODE_OPTIONS = [["online", "Online"], ["local", "Vor Ort"], ["hybrid", "Hybrid"]];
const RESULT_ENTRY_MODE_OPTIONS = [["", "Automatisch (online melden Spieler, vor Ort die Turnierleitung)"], ["staff_only", "Nur Turnierleitung"], ["player_confirmed", "Beide Parteien melden"], ["hybrid", "Hybrid"]];
const SCHEDULE_MODE_OPTIONS = [["", "Automatisch (online abstimmen, vor Ort fix)"], ["fixed_by_staff", "Fix durch Turnierleitung"], ["player_proposal", "Teilnehmer schlagen vor"], ["hybrid", "Hybrid"]];

const PRIZE_GROUP_OPTIONS = [
  ["overall", "Gesamtwertung"],
  ["winner", "Gewinner-Bracket"],
  ["loser", "Loser-Bracket"],
  ["special", "Sonderpreis"],
];
const BRONZE_FORMATS = new Set(["single_elim"]);

function buildPlanningWarnings(form, isTeam) {
  const warnings = [];
  const minParticipants = Number(form.min_participants || 0);
  const maxParticipants = Number(form.max_participants || 0);

  if (minParticipants && maxParticipants && minParticipants > maxParticipants) {
    warnings.push(`${isTeam ? "Min Teams" : "Min Spieler"} ist größer als ${isTeam ? "Max Teams" : "Max Spieler"}.`);
  }
  // Die Zeiten prüft dieselbe Regel wie beim Bearbeiten (#1938).
  warnings.push(...dateWarnings(form));
  if (form.status === "scheduled" && !form.start_date) warnings.push("Angekündigte Turniere sollten eine Startzeit haben.");
  if (form.twitch_enabled && !String(form.twitch_channel || "").trim()) warnings.push("Twitch ist aktiv, aber kein Kanal ist eingetragen.");
  return warnings;
}

// Turnier anlegen (#368, #434): links das Turnier, die Spielweise und alles Aufklappbare, rechts
// die Zeiten und die Planungshinweise, unten die feststehende Speichern-Leiste.
export default function AdminTournamentNewPage() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  // Voreinstellung aus dem Leitfaden (#368): setzt nur Format, Teamgröße, Best-of und die
  // Spielregel-Vorgabe - alles bleibt änderbar, der Rest des Formulars ist wie immer.
  const preset = presetFor(searchParams.get("preset") || "");
  const [games, setGames] = useState([]);
  const [partners, setPartners] = useState([]);
  // „+ Turnier in diesem Event“ (#1371): mit ?event= kommt die Vorbelegung vom Event, angelegt wird im Event.
  const eventId = searchParams.get("event") || "";
  const [event, setEvent] = useState(null);
  const [form, setForm] = useState(() => ({
    title: "", slug: "", description: "", game_id: "", partner_ids: [],
    platform: "", format: "single_elim", format_label: "",
    team_mode: "solo", team_size: 1,
    max_participants: 16, min_participants: 2,
    registration_enabled: true, is_invite_only: false, block_club_member_registration: false, requires_event_registration: false, discord_registration: true,
    registration_open_from: "", registration_open_until: "",
    check_in_from: "", check_in_until: "",
    start_date: "", end_date: "",
    status: "draft",
    site_banner_enabled: false,
    discord_skip: false,
    auto_start_enabled: false,
    event_mode: "online", result_entry_mode: "", schedule_mode: "",
    best_of: 1, bronze_match: false, grand_final_mode: "reset", heat_rebuild_mode: "suggest", seeding_mode: "random", advancement_mode: "fixed", draw_show_minutes: "",
    is_public: true, rules: "", prize_pool: "",
    banner_url: "",
    prize_places: [
      { group: "overall", place: 1, label: "1. Platz", value: "" },
      { group: "overall", place: 2, label: "2. Platz", value: "" },
      { group: "overall", place: 3, label: "3. Platz", value: "" },
    ],
    twitch_channel: "", twitch_enabled: false, show_chat: false,
    location: "", stream_link: "", discord_link: "",
    ...(preset?.values || {}),
  }));
  const [saving, setSaving] = useState(false);
  const isTeam = form.team_mode === "team";
  const planningWarnings = buildPlanningWarnings(form, isTeam);

  const loadSources = useCallback(() => {
    api.get("/games").then(({ data }) => setGames(data));
    api.get("/partners").then(({ data }) => setPartners(Array.isArray(data) ? data : [])).catch(() => setPartners([]));
  }, []);
  useEffect(() => { loadSources(); }, [loadSources]);
  useApiInvalidation(loadSources, ["games"]);
  useEffect(() => {
    if (!eventId) return;
    api.get(`/events/${encodeURIComponent(eventId)}/program`).then(({ data }) => {
      setEvent(data?.event || null);
      const defaults = data?.defaults?.tournament || {};
      setForm((current) => ({
        ...current,
        ...(defaults.start_date ? { start_date: toDateTimeLocalInput(defaults.start_date) } : {}),
        ...(defaults.location ? { location: defaults.location } : {}),
        ...(Array.isArray(defaults.partner_ids) ? { partner_ids: defaults.partner_ids } : {}),
        ...(typeof defaults.discord_skip === "boolean" ? { discord_skip: defaults.discord_skip } : {}),
        ...(typeof defaults.discord_registration === "boolean" ? { discord_registration: defaults.discord_registration } : {}),
        ...(defaults.event_mode ? { event_mode: defaults.event_mode } : {}),
      }));
    }).catch(() => toast.error("Das Event ließ sich nicht laden – das Turnier wird ohne Event angelegt."));
  }, [eventId]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const applyRulePreset = (preset) => setForm((f) => ({ ...f, ...preset.values }));
  const setTeamMode = (value) => setForm((f) => ({ ...f, team_mode: value, team_size: value === "solo" ? 1 : Math.max(2, Number(f.team_size) || 2) }));
  const setFormat = (value) => setForm((f) => ({ ...f, format: value, bronze_match: BRONZE_FORMATS.has(value) ? f.bronze_match : false }));
  const addPrizeTop3 = (group) => set("prize_places", [
    ...(form.prize_places || []),
    ...[1, 2, 3].map((place) => ({ group, place, label: `${place}. Platz`, value: "" })),
  ]);
  const updatePrize = (index, patch) => {
    const next = [...form.prize_places];
    next[index] = { ...next[index], ...patch };
    set("prize_places", next);
  };

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
      if (!event) payload.requires_event_registration = false;
      // Show-Auslosung (#1590): leer heißt Vorgabe; die Minuten zählen nur in diesem Modus.
      payload.draw_show_minutes = payload.advancement_mode === "draw_show" ? drawShowMinutesPayload(payload.draw_show_minutes) : null;
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
      const { data } = await api.post(event ? `/events/${encodeURIComponent(event.id)}/tournaments` : "/tournaments", payload);
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
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);

  return (
    <AdminLayout>
      <AdminFormPage
        eyebrow="Turniere"
        title="Neues Turnier"
        intro="Titel und Spiel genügen zum Anlegen. Alles Weitere lässt sich danach in Ruhe einstellen — das Turnier startet als Entwurf und ist noch nicht öffentlich."
        backTo={event ? `/admin/events/${event.id}` : "/admin/tournaments"}
        backLabel={event ? event.name : "Turniere"}
        onSubmit={submit}
        testId="new-tr-form"
        headerExtra={(preset || event) && (
          <>
            {event && (
              <div className="mt-3 border border-[#9F7AEA]/40 bg-[#9F7AEA]/5 rounded-sm px-4 py-3 text-sm max-w-2xl" data-testid="new-tr-event-hint">
                Neues Turnier in <strong className="text-white">{event.name}</strong>{event.window ? ` (${event.window})` : ""}. Ort, Tag, Partner und Discord-Einstellungen sind vom Event übernommen – der Tag muss im Event liegen.
              </div>
            )}
            {preset && (
              <div className="mt-3 border border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm px-4 py-3 text-sm max-w-2xl" data-testid="new-tr-preset-hint">
                Voreinstellung <strong className="text-white">„{preset.label}“</strong> aus dem <Link to="/admin/tournament-guide#turnierformen" className="text-[#29B6E8] hover:underline">Leitfaden</Link> übernommen: Format, Teilnahme, Best of und die Spielregel-Vorgabe sind gesetzt – alles bleibt änderbar.
              </div>
            )}
          </>
        )}
        aside={(
          <>
            <FormSection title="Wann" hint="Anmeldung und Check-in wechseln zeitgesteuert. Der Live-Start bleibt bei der Turnierleitung, solange du unten nichts anderes einstellst.">
              <SelectField label="Veröffentlichung" value={form.status} onChange={(v) => set("status", v)} options={CREATE_STATUS_OPTIONS} testId="new-tr-status" />
              <TextField label="Start Event/Turnier" type="datetime-local" value={form.start_date} onChange={(v) => set("start_date", v)} testId="new-tr-start" />
              <TextField label="Anmeldung endet" type="datetime-local" value={form.registration_open_until} onChange={(v) => set("registration_open_until", v)} testId="new-tr-reg-until" />
              <FormSection title="Weitere Zeiten und Sonderfälle" collapsible plain>
                <TextField label="Ende Event/Turnier" type="datetime-local" value={form.end_date} onChange={(v) => set("end_date", v)} testId="new-tr-end" />
                <TextField label="Anmeldung öffnet" type="datetime-local" value={form.registration_open_from} onChange={(v) => set("registration_open_from", v)} testId="new-tr-reg-from" />
                <TextField label="Check-in öffnet" type="datetime-local" value={form.check_in_from} onChange={(v) => set("check_in_from", v)} testId="new-tr-checkin-from" />
                <TextField label="Check-in endet" type="datetime-local" value={form.check_in_until} onChange={(v) => set("check_in_until", v)} testId="new-tr-checkin-until" />
                <CheckField label="Nur Einladung/manuelle Teilnehmer, keine öffentliche Anmeldung" checked={form.is_invite_only} onChange={(v) => set("is_invite_only", v)} testId="new-tr-invite-only" />
                <CheckField label="Anmeldung über Discord erlauben (/anmelden und Knopf unter der Ankündigung)" checked={form.discord_registration} onChange={(v) => set("discord_registration", v)} testId="new-tr-discord-registration" accent="#5865F2" />
                <CheckField label="Vereinsmitglieder von der Selbstanmeldung ausschließen, z.B. wenn wir das Turnier für externe Teilnehmer veranstalten" checked={form.block_club_member_registration} onChange={(v) => set("block_club_member_registration", v)} testId="new-tr-block-members" accent="#FFD700" />
                {event && <CheckField label="Anmeldung nur mit Event-Anmeldung – wer nicht beim Event angemeldet ist, kann sich nicht anmelden (Teams: so viele Spieler wie die Teamgröße)" checked={form.requires_event_registration} onChange={(v) => set("requires_event_registration", v)} testId="new-tr-event-gate" accent="#29B6E8" />}
              </FormSection>
            </FormSection>
            {planningWarnings.length > 0 && (
              <div className="rounded-sm border border-[#FFD700]/30 bg-[#FFD700]/5 p-4 text-sm text-[#FFD700]" data-testid="new-tr-planning-warnings">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold uppercase tracking-widest">Planung prüfen</div>
                    {planningWarnings.map((warning) => <div key={warning}>{warning}</div>)}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        actions={<FormActions submitLabel="Turnier erstellen" savingLabel="Erstelle …" saving={saving} submitTestId="new-tr-submit" cancelTo={event ? `/admin/events/${event.id}` : "/admin/tournaments"} icon={null} />}
      >
        <FormSection title="Das Turnier" hint="Mehr als das braucht es nicht zum Anlegen — alles Weitere lässt sich danach in Ruhe einstellen.">
          <FormGrid>
            <TextField label="Titel" value={form.title} onChange={(v) => { set("title", v); if (!form.slug) set("slug", autoSlug(v)); }} required testId="new-tr-title" />
            <SelectField label="Spiel" value={form.game_id} onChange={(v) => set("game_id", v)} options={[["", "— auswählen —"], ...games.map((g) => [g.id, gameOptionLabel(g)])]} required testId="new-tr-game" />
          </FormGrid>
          <FormGrid>
            <SelectField label="Format" value={form.format} onChange={setFormat} options={TOURNAMENT_FORMAT_OPTIONS} testId="new-tr-format" />
            <SelectField label="Teilnahme" value={form.team_mode} onChange={setTeamMode} options={[["solo", "Einzelspieler"], ["team", "Team"]]} testId="new-tr-mode" />
          </FormGrid>
          <FormGrid cols={3}>
            {isTeam && <TextField label="Spieler pro Team" type="number" min="2" max="6" value={form.team_size} onChange={(v) => set("team_size", Number(v))} testId="new-tr-team-size" />}
            <TextField label={isTeam ? "Max Teams" : "Max Spieler"} type="number" value={form.max_participants} onChange={(v) => set("max_participants", Number(v))} testId="new-tr-max" />
            <TextField label={isTeam ? "Min Teams" : "Min Spieler"} type="number" value={form.min_participants} onChange={(v) => set("min_participants", Number(v))} testId="new-tr-min" />
          </FormGrid>
        </FormSection>

        <FormSection title="Wie gespielt wird">
          {/* Die drei Auswahllisten dahinter standen bisher direkt darüber - drei
              Listen und drei Knöpfe für dieselben drei Werte. Jetzt entscheidet
              man einmal und weicht nur ab, wenn man es wirklich braucht. */}
          <RulePresetPicker form={form} onApply={applyRulePreset} />
          <FormSection title="Abweichend einstellen" collapsible plain>
            <FormGrid cols={3}>
              <SelectField label="Austragung" value={form.event_mode} onChange={(v) => set("event_mode", v)} options={EVENT_MODE_OPTIONS} testId="new-tr-event-mode" />
              <SelectField label="Ergebniserfassung" value={form.result_entry_mode || ""} onChange={(v) => set("result_entry_mode", v || null)} options={RESULT_ENTRY_MODE_OPTIONS} testId="new-tr-result-entry-mode" />
              <SelectField label="Terminplanung" value={form.schedule_mode || ""} onChange={(v) => set("schedule_mode", v || null)} options={SCHEDULE_MODE_OPTIONS} testId="new-tr-schedule-mode" />
            </FormGrid>
          </FormSection>
          <FormGrid>
            <CheckField label="Öffentliche Anmeldung grundsätzlich erlauben" checked={form.registration_enabled} onChange={(v) => set("registration_enabled", v)} testId="new-tr-reg-enabled" />
            <CheckField label="Automatisches Turnier-Hinweisbanner für dieses Turnier anzeigen" checked={form.site_banner_enabled} onChange={(v) => set("site_banner_enabled", v)} testId="new-tr-site-banner" accent="#FFD700" />
            <CheckField label="Ohne Discord" hint="Keine Meldung, kein Thread, kein Bracket und kein Termin im Discord – etwa für Probe- oder interne Turniere." checked={form.discord_skip} onChange={(v) => set("discord_skip", v)} testId="new-tr-discord-skip" accent="#5865F2" />
            <CheckField label="Turnier anhand Start-/Endzeit automatisch live/beendet schalten. Für Vor-Ort-Turniere ausgeschaltet lassen." checked={form.auto_start_enabled} onChange={(v) => set("auto_start_enabled", v)} testId="new-tr-auto-start" className="md:col-span-2" />
          </FormGrid>
        </FormSection>

        <FormSection title="Darstellung und Regeln" collapsible>
          <FormGrid>
            <TextField label="Slug (URL)" value={form.slug} onChange={(v) => set("slug", autoSlug(v))} required testId="new-tr-slug" />
            <TextField label="Plattform" value={form.platform} onChange={(v) => set("platform", v)} placeholder="z.B. Nintendo Switch" testId="new-tr-platform" />
          </FormGrid>
          <EventMembershipLine eventId={event?.id} events={event ? [event] : []} testId="new-tr-event" />
          <TextField label="Format-Anzeigename" value={form.format_label} onChange={(v) => set("format_label", v)} placeholder="z.B. Gamers Heaven F1 Heat" testId="new-tr-format-label" />
          <MarkdownField label="Beschreibung" value={form.description} onChange={(v) => set("description", v)} testId="new-tr-description" />
          <ImageUpload value={form.banner_url} onChange={(v) => set("banner_url", v)} label="Turnier-Banner" testId="new-tr-banner-upload" variant="wide" allowLibrary />
          <MarkdownField label="Regeln" value={form.rules} onChange={(v) => set("rules", v)} testId="new-tr-rules" />
          <PartnerPicker partners={partners} value={form.partner_ids} onChange={(v) => set("partner_ids", v)} testPrefix="new-tr-partner" hint="Das Turnier erscheint auf der Partnerseite unter „Gemeinsam“, und die Turnierseite nennt den Partner." />
        </FormSection>

        <FormSection title="Spieloptionen" collapsible>
          <FormGrid>
            <TextField label="Best of" type="number" value={form.best_of} onChange={(v) => set("best_of", Number(v))} testId="new-tr-bestof" />
            <SelectField label="Seeding" value={form.seeding_mode} onChange={(v) => set("seeding_mode", v)} options={[["random", "Zufall"], ["manual", "Manuell"], ["ranking", "Ranking"]]} testId="new-tr-seeding" />
          </FormGrid>
          {/* Weiterkommen in vier Modi (#1548, #1590): fester Baum, Auslosung nach der Runde, Show, sofort zufällig. */}
          <SelectField label="Weiterkommen (Gegner der nächsten Runde)" value={form.advancement_mode} onChange={(v) => set("advancement_mode", v)} options={ADVANCEMENT_MODE_OPTIONS} hint={<span data-testid="new-tr-advancement-hint">{advancementModeHint(form.advancement_mode)}</span>} testId="new-tr-advancement" />
          {form.advancement_mode === "draw_show" && (
            <TextField label="Show-Auslosung: Erinnerung nach Minuten" type="number" min="1" max="240" value={form.draw_show_minutes} onChange={(v) => set("draw_show_minutes", v)} placeholder={String(DRAW_SHOW_MINUTES_DEFAULT)} hint={DRAW_SHOW_MINUTES_HINT} testId="new-tr-draw-show-minutes" />
          )}
          {BRONZE_FORMATS.has(form.format) && (
            <CheckField label="Spiel um Platz 3 ermitteln" checked={form.bronze_match} onChange={(v) => set("bronze_match", v)} testId="new-tr-bronze" />
          )}
          {GRAND_FINAL_FORMATS.has(form.format) && (
            <SelectField label="Grand Final" value={form.grand_final_mode} onChange={(v) => set("grand_final_mode", v)} options={GRAND_FINAL_OPTIONS} hint={GRAND_FINAL_HINT} testId="new-tr-grand-final" />
          )}
          {HEAT_REBUILD_FORMATS.has(form.format) && (
            <SelectField label="Läufe umbauen" value={form.heat_rebuild_mode} onChange={(v) => set("heat_rebuild_mode", v)} options={HEAT_REBUILD_OPTIONS} hint={HEAT_REBUILD_HINT} testId="new-tr-heat-rebuild" />
          )}
        </FormSection>

        {/* Structured Prize Places */}
        <FormSection title="Preise" collapsible accent="#FFD700">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-white/50">Jede Zeile erscheint als eigene Preis-Karte auf der Turnierseite.</div>
            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => addPrizeTop3("winner")} className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">+ Gewinner Top 3</button>
              <button type="button" onClick={() => addPrizeTop3("loser")} className="text-xs font-bold uppercase tracking-wider text-[#CD7F32] hover:text-white">+ Loser Top 3</button>
              <button type="button" onClick={() => set("prize_places", [...form.prize_places, { group: "overall", place: form.prize_places.length + 1, label: `Platz ${form.prize_places.length + 1}`, value: "" }])} data-testid="new-tr-prize-add" className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white">+ Platz hinzufügen</button>
              <button type="button" onClick={() => set("prize_places", [...form.prize_places, { group: "overall", place: "last", label: "Letzter Platz", value: "" }])} data-testid="new-tr-prize-last" className="text-xs font-bold uppercase tracking-wider text-[#FFD700] hover:text-white">+ Letzter Platz</button>
            </div>
          </div>
          {form.prize_places.map((p, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-start">
              <select value={p.group || "overall"} onChange={(e) => updatePrize(i, { group: e.target.value })} className="col-span-12 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
                {PRIZE_GROUP_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select value={p.place} onChange={(e) => updatePrize(i, { place: e.target.value === "last" ? "last" : Number(e.target.value) || 1 })} data-testid={`new-tr-prize-place-${i}`} className="col-span-2 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm">
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}.</option>)}
                <option value="last">Letzter</option>
              </select>
              <input value={p.label || ""} onChange={(e) => updatePrize(i, { label: e.target.value })} data-testid={`new-tr-prize-label-${i}`} className="col-span-4 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Label (z.B. Champion)" />
              <input value={p.value || ""} onChange={(e) => updatePrize(i, { value: e.target.value })} data-testid={`new-tr-prize-value-${i}`} className="col-span-5 sm:col-span-3 bg-[#0A0A0A] border border-white/10 px-2 py-2 rounded-sm text-sm" placeholder="Preis (z.B. 100 €)" />
              <button type="button" onClick={() => set("prize_places", form.prize_places.filter((_, j) => j !== i))} data-testid={`new-tr-prize-remove-${i}`} className="col-span-1 text-white/40 hover:text-[#FF3B30] text-center py-2">✕</button>
            </div>
          ))}
          <MarkdownField label="Fallback Text (freier Preis-Text, falls nicht strukturiert)" value={form.prize_pool} onChange={(v) => set("prize_pool", v)} testId="new-tr-prizes" />
        </FormSection>

        {/* Streaming + Links */}
        <FormSection title="Streaming und externe Links" collapsible accent="#9146FF">
          <FormGrid>
            <TextField label="Twitch-Kanal" value={form.twitch_channel} onChange={(v) => set("twitch_channel", v)} testId="new-tr-twitch" placeholder="the_lion_squad_esports" />
            {/* Ort (#1371): im Event kommt er vom Event; ein eigener Ort nur ohne Event. */}
            {event ? (
              <div className="text-sm text-white/70" data-testid="new-tr-location-event">Ort: {form.location || "wie beim Event"} <span className="text-white/45">(vom Event)</span></div>
            ) : (
              <TextField label="Ort" value={form.location} onChange={(v) => set("location", v)} testId="new-tr-location" placeholder="z.B. Gamers Heaven · Bregenz" />
            )}
          </FormGrid>
          <CheckField label="Twitch-Player auf Turnierseite einbetten" checked={form.twitch_enabled} onChange={(v) => set("twitch_enabled", v)} testId="new-tr-twitch-enabled" accent="#9146FF" />
          <CheckField label="Turnier-Chat für Teilnehmer anzeigen" checked={form.show_chat} onChange={(v) => set("show_chat", v)} testId="new-tr-chat-enabled" accent="#9146FF" />
          <FormGrid>
            <TextField label="Externer Stream-Verweis" value={form.stream_link} onChange={(v) => set("stream_link", v)} testId="new-tr-stream" placeholder="https://…" />
            <TextField label="Discord-Einladung" value={form.discord_link} onChange={(v) => set("discord_link", v)} testId="new-tr-discord" placeholder="https://discord.com/invite/…" />
          </FormGrid>
        </FormSection>
      </AdminFormPage>
    </AdminLayout>
  );
}

function MarkdownField({ label, value, onChange, testId }) {
  return (
    <FieldLabel label={label}>
      <MarkdownEditor value={value || ""} onChange={onChange} rows={5} testId={testId} />
    </FieldLabel>
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
