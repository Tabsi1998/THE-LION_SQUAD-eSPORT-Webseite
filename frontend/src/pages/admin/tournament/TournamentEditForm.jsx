// Turnier-Bearbeitung (#223): das Formular des Turniers (Stammdaten, Format, Regeln, Preise, Abrechnung).
import { useEffect, useState } from "react";
import { api, formatApiError, formatRequestError } from "@/lib/api";
import { FormActions, FormColumns, FormGrid, FormSection } from "@/components/tls/AdminForm";
import { PartnerPicker } from "@/components/tls/PartnerPicker";
import { CheckField, TextField, SelectField as SelectInput } from "@/components/tls/FormFields";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { EventBillingSection } from "@/components/tls/EventBillingSection";
import { normalizeDateTimeFields, toDateTimeLocalInput } from "@/lib/datetime";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { billingFormError, formToBilling, tournamentBillingToForm } from "@/lib/pricing";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { gameOptionLabel } from "@/lib/gameLabels";
import { RULE_PRESETS, ruleModeSummary, rulePresetKey, rulePresetWarnings } from "@/lib/tournamentRulePresets";
import { TOURNAMENT_FORMAT_OPTIONS } from "@/lib/tournamentLabels";
import { PrizeEditor, Txt } from "./PrizeEditor";
import { BRONZE_FORMATS, CUSTOM_BRACKET_FORMATS, DEFAULT_FFA_SCHEMA, EVENT_MODE_OPTIONS, MATCHDAY_FORMATS, RESULT_ENTRY_MODE_OPTIONS, SCHEDULE_MODE_OPTIONS, SEEDING_OPTIONS, STREAM_PLATFORM_OPTIONS, TEAM_MODE_OPTIONS, TOURNAMENT_SEASON_WEIGHT_OPTIONS, TOURNAMENT_STATUS_OPTIONS, VISIBILITY_OPTIONS, WEEKDAY_OPTIONS } from "./shared";

export function TournamentEditForm({ tournament, stages = [], onSaved, onRebuildFromFormat }) {
  const dt = toDateTimeLocalInput;
  const [games, setGames] = useState([]);
  const [partners, setPartners] = useState([]);
  const [events, setEvents] = useState([]);
  // Startgeld (#319, #322): eigener Zustand wie beim Event, nur für den Bereich Finanzen sichtbar
  // und nur dann Teil des Speicherns - der Server lehnt es sonst mit 403 ab.
  const { can } = useAuth();
  const canFinance = typeof can === "function" && can("finance");
  const [billingForm, setBillingForm] = useState(() => tournamentBillingToForm(tournament.billing));
  const billingDirty = JSON.stringify(billingForm) !== JSON.stringify(tournamentBillingToForm(tournament.billing));
  const formFromTournament = (source = tournament) => ({
    title: source.title || "",
    slug: source.slug || "",
    description: source.description || "",
    game_id: source.game_id || "",
    partner_ids: source.partner_ids || [],
    platform: source.platform || "",
    event_id: source.event_id || "",
    format: source.format || "single_elim",
    format_label: source.format_label || "",
    status: source.status || "draft",
    team_mode: source.team_mode === "solo" ? "solo" : "team",
    team_size: source.team_mode === "solo" ? 1 : (source.team_size || 2),
    substitutes_allowed: !!source.substitutes_allowed,
    rules: source.rules || "",
    prize_pool: source.prize_pool || "",
    prize_places: source.prize_places || [],
    banner_url: source.banner_url || "",
    stream_link: source.stream_link || "",
    discord_link: source.discord_link || "",
    location: source.location || "",
    registration_enabled: source.registration_enabled !== false,
    is_invite_only: !!source.is_invite_only,
    block_club_member_registration: !!source.block_club_member_registration,
    registration_open_from: dt(source.registration_open_from),
    registration_open_until: dt(source.registration_open_until),
    check_in_from: dt(source.check_in_from),
    check_in_until: dt(source.check_in_until),
    start_date: dt(source.start_date),
    end_date: dt(source.end_date),
    max_participants: source.max_participants || 16,
    min_participants: source.min_participants || 2,
    best_of: source.best_of || 1,
    match_duration_minutes: source.match_duration_minutes || 30,
    bronze_match: !!source.bronze_match,
    seeding_mode: source.seeding_mode || "random",
    randomize_advancement_rounds: !!source.randomize_advancement_rounds,
    is_public: source.is_public !== false,
    visibility: source.visibility || "public",
    site_banner_enabled: !!source.site_banner_enabled,
    auto_start_enabled: !!source.auto_start_enabled,
    event_mode: source.event_mode || "online",
    result_entry_mode: source.result_entry_mode || "",
    schedule_mode: source.schedule_mode || "",
    matchday_days: source.matchday_days ?? 7,
    default_match_weekday: source.default_match_weekday ?? 6,
    default_match_time: source.default_match_time || "20:00",
    twitch_channel: source.twitch_channel || "",
    twitch_enabled: !!source.twitch_enabled,
    has_live_stream: !!source.has_live_stream,
    stream_platform: source.stream_platform || "",
    stream_url: source.stream_url || "",
    stream_title: source.stream_title || "",
    show_chat: !!source.show_chat,
    season_weight: source.season_weight ?? 2,
  });
  const [f, setF] = useState({
    title: tournament.title || "",
    slug: tournament.slug || "",
    description: tournament.description || "",
    game_id: tournament.game_id || "",
    partner_ids: tournament.partner_ids || [],
    platform: tournament.platform || "",
    event_id: tournament.event_id || "",
    format: tournament.format || "single_elim",
    format_label: tournament.format_label || "",
    status: tournament.status || "draft",
    team_mode: tournament.team_mode === "solo" ? "solo" : "team",
    team_size: tournament.team_mode === "solo" ? 1 : (tournament.team_size || 2),
    substitutes_allowed: !!tournament.substitutes_allowed,
    rules: tournament.rules || "",
    prize_pool: tournament.prize_pool || "",
    prize_places: tournament.prize_places || [],
    banner_url: tournament.banner_url || "",
    award_images: tournament.award_images || {},
    stream_link: tournament.stream_link || "",
    discord_link: tournament.discord_link || "",
    location: tournament.location || "",
    registration_enabled: tournament.registration_enabled !== false,
    is_invite_only: !!tournament.is_invite_only,
    block_club_member_registration: !!tournament.block_club_member_registration,
    registration_open_from: dt(tournament.registration_open_from),
    registration_open_until: dt(tournament.registration_open_until),
    check_in_from: dt(tournament.check_in_from),
    check_in_until: dt(tournament.check_in_until),
    start_date: dt(tournament.start_date),
    end_date: dt(tournament.end_date),
    max_participants: tournament.max_participants || 16,
    min_participants: tournament.min_participants || 2,
    best_of: tournament.best_of || 1,
    match_duration_minutes: tournament.match_duration_minutes || 30,
    bronze_match: !!tournament.bronze_match,
    seeding_mode: tournament.seeding_mode || "random",
    randomize_advancement_rounds: !!tournament.randomize_advancement_rounds,
    is_public: tournament.is_public !== false,
    visibility: tournament.visibility || "public",
    site_banner_enabled: !!tournament.site_banner_enabled,
    auto_start_enabled: !!tournament.auto_start_enabled,
    event_mode: tournament.event_mode || "online",
    result_entry_mode: tournament.result_entry_mode || "",
    schedule_mode: tournament.schedule_mode || "",
    matchday_days: tournament.matchday_days ?? 7,
    default_match_weekday: tournament.default_match_weekday ?? 6,
    default_match_time: tournament.default_match_time || "20:00",
    twitch_channel: tournament.twitch_channel || "",
    twitch_enabled: !!tournament.twitch_enabled,
    has_live_stream: !!tournament.has_live_stream,
    stream_platform: tournament.stream_platform || "",
    stream_url: tournament.stream_url || "",
    stream_title: tournament.stream_title || "",
    show_chat: !!tournament.show_chat,
    season_weight: tournament.season_weight ?? 2,
  });
  const firstStage = stages[0] || null;
  const stageSettings = firstStage?.settings || {};
  const [structure, setStructure] = useState({
    // Ohne vorhandene Phase bleibt der Strukturtyp leer: welcher zu welchem
    // Format gehört, weiß das Backend (services/competition_formats.py). Hier
    // stand früher eine zweite, unvollständige Zuordnung.
    stage_type: firstStage?.stage_type || null,
    match_type: firstStage?.match_type || null,
    match_size: stageSettings.match_size || (tournament.format === "ffa_custom_bracket" ? 4 : 2),
    min_players: stageSettings.min_players || 2,
    qualifiers_per_match: stageSettings.qualifiers_per_match || (tournament.format === "ffa_custom_bracket" ? 2 : 1),
    duration_minutes: stageSettings.duration_minutes || tournament.match_duration_minutes || 30,
    schema: stageSettings.schema || (tournament.format === "ffa_custom_bracket" ? DEFAULT_FFA_SCHEMA : ""),
  });
  useEffect(() => {
    api.get("/games").then(({ data }) => setGames(data || [])).catch(() => setGames([]));
    api.get("/partners").then(({ data }) => setPartners(Array.isArray(data) ? data : [])).catch(() => setPartners([]));
    api.get("/events?include_drafts=true").then(({ data }) => setEvents(data || [])).catch(() => setEvents([]));
  }, []);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const applyRulePreset = (preset) => setF((x) => ({ ...x, ...preset.values }));
  const setStructureField = (k, v) => setStructure((x) => ({ ...x, [k]: v }));
  // Nach einem Formatwechsel folgt die Struktur wieder dem Format: der eigene
  // Vorschlag wird gelöscht, nicht neu geraten. Vorher landete hier alles außer
  // drei Sonderfällen auf "single_elimination" - aus einer Liga, Gruppen, Round
  // Robin oder FFA wurde beim Anwenden stillschweigend eine Einzelausscheidung.
  const setFormat = (value) => {
    setF((current) => ({ ...current, format: value, bronze_match: BRONZE_FORMATS.has(value) ? current.bronze_match : false }));
    setStructure((current) => ({
      ...current,
      stage_type: null,
      match_type: null,
      match_size: value === "ffa_custom_bracket" ? (current.match_size || 4) : 2,
      min_players: 2,
      qualifiers_per_match: value === "ffa_custom_bracket" ? (current.qualifiers_per_match || 2) : 1,
      schema: value === "ffa_custom_bracket" ? (current.schema || DEFAULT_FFA_SCHEMA)
        : value === "custom_bracket" ? current.schema
          : "",
    }));
  };
  const normalizeTournamentPayload = (source) => {
    const payload = { ...source };
    if (!payload.event_id) payload.event_id = null;
    if (!payload.stream_platform) payload.stream_platform = null;
    if (!payload.result_entry_mode) payload.result_entry_mode = null;
    if (!payload.schedule_mode) payload.schedule_mode = null;
    payload.format_label = (payload.format_label || "").trim() || null;
    if (!BRONZE_FORMATS.has(payload.format)) payload.bronze_match = false;
    normalizeDateTimeFields(payload, ["registration_open_from", "registration_open_until", "check_in_from", "check_in_until", "start_date", "end_date"]);
    ["team_size", "max_participants", "min_participants", "best_of", "match_duration_minutes",
      "matchday_days", "default_match_weekday"].forEach((key) => {
      if (payload[key] !== "" && payload[key] != null) payload[key] = Number(payload[key]);
    });
    payload.season_weight = Number(payload.season_weight || 0);
    payload.prize_places = (payload.prize_places || [])
      .filter((p) => p.value && String(p.value).trim())
      .map((p) => ({
        group: p.group || "overall",
        place: p.place === "last" ? "last" : Number(p.place) || 0,
        label: p.label || (p.place === "last" ? "Letzter Platz" : `Platz ${p.place}`),
        value: p.value,
      }));
    if (payload.prize_places.length === 0) payload.prize_places = null;
    return payload;
  };
  // Mitgeschickt wird nur, was hier wirklich gewählt wurde. Was fehlt, leitet
  // das Backend aus dem Turnierformat ab; ein mitgeschickter Strukturtyp würde
  // diese Ableitung überstimmen. Spielgrößen und Schema gibt es nur bei den
  // freien Turnierbäumen - bei allen anderen Formaten sind sie nicht bedienbar
  // und würden nur die passenden Vorgaben überschreiben.
  const structurePayload = () => {
    const custom = CUSTOM_BRACKET_FORMATS.has(f.format);
    const settings = {
      duration_minutes: Number(f.match_duration_minutes) || 30,
      score_type: "points",
      calculation: "points",
    };
    if (custom) {
      const ffa = f.format === "ffa_custom_bracket";
      settings.schema = structure.schema || "";
      settings.match_size = Number(structure.match_size) || (ffa ? 4 : 2);
      settings.min_players = Number(structure.min_players) || 2;
      settings.qualifiers_per_match = Number(structure.qualifiers_per_match) || (ffa ? 2 : 1);
    }
    const payload = { name: "Turnierbaum", settings };
    if (structure.stage_type) payload.stage_type = structure.stage_type;
    if (structure.match_type) payload.match_type = structure.match_type;
    return payload;
  };
  const setTeamMode = (value) => setF((current) => ({
    ...current,
    team_mode: value,
    team_size: value === "solo" ? 1 : Math.max(2, Number(current.team_size) || 2),
  }));
  const dirtyPayload = buildDirtyPayload(normalizeTournamentPayload(f), normalizeTournamentPayload(formFromTournament()));
  const sendBilling = canFinance && billingDirty;
  const hasFormChanges = hasPayloadChanges(dirtyPayload) || sendBilling;
  const save = async ({ rebuildPreview = false } = {}) => {
    try {
      const billingProblem = sendBilling ? billingFormError(billingForm) : "";
      if (billingProblem) { toast.error(billingProblem); return; }
      const patch = sendBilling ? { ...dirtyPayload, billing: formToBilling(billingForm) } : dirtyPayload;
      if (!hasPayloadChanges(patch)) {
        if (rebuildPreview) {
          await onRebuildFromFormat?.({ preview: true, force: true, structure: structurePayload() });
          return;
        }
        toast.info("Keine Änderungen zum Speichern.");
        return;
      }
      await api.patch(`/tournaments/${tournament.id}`, patch);
      toast.success("Gespeichert.");
      if (rebuildPreview) {
        await onRebuildFromFormat?.({ preview: true, force: true, structure: structurePayload() });
      } else {
        onSaved();
      }
    } catch (e) { toast.error(formatRequestError(e, "Turnier konnte nicht gespeichert werden.", { title: f.title })); }
  };
  const createPrizePickups = async () => {
    try {
      const { data } = await api.post(`/prizes/auto-create/${tournament.id}`);
      const created = Number(data?.created || 0);
      toast.success(created === 1 ? "1 Gewinn angelegt." : `${created} Gewinne angelegt.`);
      onSaved();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail) || "Gewinne konnten nicht erzeugt werden.");
    }
  };
  // Reiter „Bearbeiten“ im Formular-Rahmen (#434): links Basis, Spielweise, Struktur, Abrechnung
  // und alles Aufklappbare, rechts Zeitplan und Anmeldung, unten die feststehende Speichern-Leiste.
  return (
    <div className="min-w-0">
      <FormColumns
        aside={(
          <FormSection title="Zeitplan und Anmeldung" hint="Anmeldung und Check-in wechseln zeitgesteuert; der Live-Start bleibt bei der Turnierleitung, solange unten nichts anderes gesetzt ist.">
            <TextField label="Start Event/Turnier" type="datetime-local" value={f.start_date} onChange={(v)=>set("start_date",v)} testId="tr-edit-start"/>
            <TextField label="Ende Event/Turnier" type="datetime-local" value={f.end_date} onChange={(v)=>set("end_date",v)} testId="tr-edit-end"/>
            <TextField label="Anmeldung öffnet" type="datetime-local" value={f.registration_open_from} onChange={(v)=>set("registration_open_from",v)} testId="tr-edit-reg-from"/>
            <TextField label="Anmeldung endet" type="datetime-local" value={f.registration_open_until} onChange={(v)=>set("registration_open_until",v)} testId="tr-edit-reg-until"/>
            <TextField label="Check-in öffnet" type="datetime-local" value={f.check_in_from} onChange={(v)=>set("check_in_from",v)} testId="tr-edit-checkin-from"/>
            <TextField label="Check-in endet" type="datetime-local" value={f.check_in_until} onChange={(v)=>set("check_in_until",v)} testId="tr-edit-checkin-until"/>
            <CheckField label="Öffentliche Anmeldung erlauben" checked={f.registration_enabled} onChange={(v)=>set("registration_enabled",v)} />
            <CheckField label="Nur Einladung/manuelle Teilnehmer" checked={f.is_invite_only} onChange={(v)=>set("is_invite_only",v)} />
            <CheckField label="Automatisches Turnier-Hinweisbanner anzeigen" checked={f.site_banner_enabled} onChange={(v)=>set("site_banner_enabled",v)} accent="#FFD700" />
            <CheckField label="Start-/Endzeit darf Turnier automatisch live/beendet schalten" checked={f.auto_start_enabled} onChange={(v)=>set("auto_start_enabled",v)} testId="tr-edit-auto-start" />
            <CheckField label="Vereinsmitglieder von der Selbstanmeldung ausschließen, z.B. wenn wir das Turnier für externe Teilnehmer veranstalten" checked={f.block_club_member_registration} onChange={(v)=>set("block_club_member_registration",v)} accent="#FFD700" />
          </FormSection>
        )}
      >
        <FormSection title="Basis">
          <FormGrid>
            <TextField label="Titel" value={f.title} onChange={(v)=>set("title",v)} testId="tr-edit-title"/>
            <TextField label="Slug / URL" value={f.slug} onChange={(v)=>set("slug", slugify(v))} testId="tr-edit-slug"/>
            <SelectInput label="Spiel" value={f.game_id} onChange={(v)=>set("game_id",v)} options={[["", "— auswählen —"], ...games.map((g) => [g.id, gameOptionLabel(g)])]} />
            <TextField label="Plattform" value={f.platform} onChange={(v)=>set("platform",v)} testId="tr-edit-platform"/>
            <SelectInput label="Event" value={f.event_id || ""} onChange={(v)=>set("event_id",v)} options={[["", "— keins —"], ...events.map((e) => [e.id, e.name])]} />
            <SelectInput label="Status" value={f.status} onChange={(v)=>set("status",v)} options={TOURNAMENT_STATUS_OPTIONS} />
            <SelectInput label="Sichtbarkeit" value={f.visibility} onChange={(v)=>set("visibility",v)} options={VISIBILITY_OPTIONS} />
            <CheckField label="Auf Public-Seiten sichtbar, sobald nicht Entwurf" checked={f.is_public} onChange={(v)=>set("is_public",v)} className="self-end pb-2" />
          </FormGrid>
        </FormSection>

        <FormSection title="Spielweise" hint="Vor-Ort-Turniere werden standardmäßig durch die Turnierleitung gewertet und geplant. Online-Turniere erlauben standardmäßig Ergebnisberichte beider Parteien und Terminvorschläge.">
          <RulePresetPicker form={f} onApply={applyRulePreset} />
          <FormGrid cols={3}>
            <SelectInput label="Austragung" value={f.event_mode} onChange={(v)=>set("event_mode",v)} options={EVENT_MODE_OPTIONS} />
            <SelectInput label="Ergebniserfassung" value={f.result_entry_mode || ""} onChange={(v)=>set("result_entry_mode",v || "")} options={RESULT_ENTRY_MODE_OPTIONS} />
            <SelectInput label="Terminplanung" value={f.schedule_mode || ""} onChange={(v)=>set("schedule_mode",v || "")} options={SCHEDULE_MODE_OPTIONS} />
          </FormGrid>
          {MATCHDAY_FORMATS.has(f.format) && (
            <div className="border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-4 space-y-3" data-testid="tr-edit-matchdays">
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Spielwochen</div>
              <p className="text-xs text-white/55">
                Ein Spieltag ist ein Zeitraum, kein Zeitpunkt. Beide Seiten dürfen darin Termine vorschlagen;
                was die Gegenseite annimmt, gilt. Schlägt nur die Heimseite vor, gilt ihre Zeit. Wählt niemand,
                greift die Standardzeit unten.
              </p>
              <FormGrid cols={3}>
                <TextField label="Spieltag dauert (Tage)" type="number" min="1" max="31" value={f.matchday_days} onChange={(v)=>set("matchday_days", v)} testId="tr-edit-matchday-days" />
                <SelectInput label="Standardtag" value={String(f.default_match_weekday ?? 6)} onChange={(v)=>set("default_match_weekday", Number(v))} options={WEEKDAY_OPTIONS} />
                <TextField label="Standarduhrzeit" type="time" value={f.default_match_time} onChange={(v)=>set("default_match_time", v)} testId="tr-edit-matchday-time" />
              </FormGrid>
            </div>
          )}
        </FormSection>

        <FormSection title="Struktur" hint="Teilnahme legt fest, wer sich anmelden darf: Einzelspieler melden sich selbst an, bei Team meldet ein Team-Leader oder Co-Leader das Team an.">
          <FormGrid cols={3}>
            <SelectInput label="Turnierstruktur" value={f.format} onChange={setFormat} options={TOURNAMENT_FORMAT_OPTIONS} />
            <TextField label="Format-Anzeigename" value={f.format_label} onChange={(v)=>set("format_label",v)} placeholder="z.B. Gamers Heaven F1 Heat" testId="tr-edit-format-label"/>
            <SelectInput label="Teilnahme" value={f.team_mode} onChange={setTeamMode} options={TEAM_MODE_OPTIONS} />
            {f.team_mode !== "solo" && <TextField label="Spieler pro Team" type="number" min="2" max="6" value={f.team_size} onChange={(v)=>set("team_size",v)} testId="tr-edit-team-size"/>}
            <TextField label={f.team_mode === "solo" ? "Min Spieler" : "Min Teams"} type="number" value={f.min_participants} onChange={(v)=>set("min_participants",v)} testId="tr-edit-min"/>
            <TextField label={f.team_mode === "solo" ? "Max Spieler" : "Max Teams"} type="number" value={f.max_participants} onChange={(v)=>set("max_participants",v)} testId="tr-edit-max"/>
          </FormGrid>
          <FormSection title="Erweiterte Spieloptionen" collapsible plain>
            <FormGrid cols={3}>
              <SelectInput label="Seeding" value={f.seeding_mode} onChange={(v)=>set("seeding_mode",v)} options={SEEDING_OPTIONS} />
              <CheckField label="Folgerunden zufällig mischen" hint="Runde 1 bleibt nach Check-in fix; qualifizierte Spieler werden in die nächste Runde zufällig auf freie Zielslots verteilt." checked={!!f.randomize_advancement_rounds} onChange={(v)=>set("randomize_advancement_rounds", v)} className="md:col-span-2" />
              <TextField label="Best of" type="number" value={f.best_of} onChange={(v)=>set("best_of",v)} testId="tr-edit-bo"/>
              <TextField label="Matchdauer Min." type="number" value={f.match_duration_minutes} onChange={(v)=>set("match_duration_minutes",v)} testId="tr-edit-duration"/>
              <SeasonWeightField value={f.season_weight} onChange={(v)=>set("season_weight",v)} />
            </FormGrid>
            <div className="flex flex-wrap gap-4">
              {BRONZE_FORMATS.has(f.format) && <CheckField label="Spiel um Platz 3" checked={f.bronze_match} onChange={(v)=>set("bronze_match",v)} />}
              <CheckField label="Ersatzspieler erlauben" checked={f.substitutes_allowed} onChange={(v)=>set("substitutes_allowed",v)} />
            </div>
          </FormSection>
          {CUSTOM_BRACKET_FORMATS.has(f.format) && (
            <div className="border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-4 space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Freier Turnierbaum</div>
              <FormGrid cols={3}>
                {f.format === "ffa_custom_bracket" && <TextField label="Spielgröße" type="number" value={structure.match_size} onChange={(v)=>setStructureField("match_size", v)} testId="tr-edit-stage-size" />}
                {f.format === "ffa_custom_bracket" && <TextField label="Qualifizierte" type="number" value={structure.qualifiers_per_match} onChange={(v)=>setStructureField("qualifiers_per_match", v)} testId="tr-edit-stage-qualifiers" />}
              </FormGrid>
              <label className="block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Schema</div>
                <textarea value={structure.schema} onChange={(e)=>setStructureField("schema", e.target.value)} rows={12} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" data-testid="tr-edit-structure-schema" />
              </label>
            </div>
          )}
        </FormSection>

        {canFinance && (
          <EventBillingSection kind="tournament" value={billingForm} onChange={setBillingForm} canEdit={canFinance} hasEvent={Boolean(f.event_id)} />
        )}

        <FormSection title="Darstellung" collapsible>
          <ImageUpload value={f.banner_url} onChange={(v)=>set("banner_url",v)} label="Turnier-Banner" testId="tr-edit-banner-upload" variant="wide" allowLibrary />
          {/* Auszeichnungen (#230): gestaltete Gewinnerbanner für Platz 1–3; ohne Bild bekommt der Platz die feste Vorlage aus Platz, Bilanz und Turnier. */}
          <FormGrid cols={3}>
            {["1", "2", "3"].map((slot) => (
              <ImageUpload key={slot} value={f.award_images?.[slot] || ""} onChange={(v)=>set("award_images", { ...(f.award_images || {}), [slot]: v })} label={`Gewinnerbanner Platz ${slot}`} testId={`tr-edit-award-${slot}`} variant="wide" allowLibrary />
            ))}
          </FormGrid>
          <p className="text-xs text-white/45">Ohne eigenes Bild zeigt die Website je Platz ein Banner aus Platz, Bilanz und Turniername. Ein Bild gilt für den jeweiligen Platz dieses Turniers und wandert bei einer Korrektur der Ergebnisse mit.</p>
          <Txt label="Beschreibung" value={f.description} onChange={(v)=>set("description",v)} testId="tr-edit-desc"/>
          <Txt label="Regeln" value={f.rules} onChange={(v)=>set("rules",v)} testId="tr-edit-rules"/>
          <PartnerPicker partners={partners} value={f.partner_ids} onChange={(v)=>set("partner_ids", v)} testPrefix="tr-edit-partner" hint="Das Turnier erscheint auf der Partnerseite unter „Gemeinsam“, und die Turnierseite nennt den Partner." />
        </FormSection>

        <FormSection title="Preise" collapsible accent="#FFD700">
          <PrizeEditor value={f.prize_places} onChange={(v)=>set("prize_places", v)} />
          <Txt label="Preise" value={f.prize_pool} onChange={(v)=>set("prize_pool",v)} testId="tr-edit-prizes"/>
          <div className="border border-[#FFD700]/20 bg-[#FFD700]/5 rounded-sm p-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-white/55">
              Nach veröffentlichten Ergebnissen erzeugt dieser Button konkrete Einträge für die Gewinnabholung.
            </p>
            <button
              type="button"
              onClick={createPrizePickups}
              disabled={!((f.prize_places || []).length)}
              data-testid="tr-edit-create-prizes"
              className="inline-flex items-center justify-center gap-2 rounded-sm border border-[#FFD700]/40 px-4 py-2 text-xs font-bold uppercase tracking-wider text-[#FFD700] hover:bg-[#FFD700]/10 disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Gewinne erzeugen
            </button>
          </div>
        </FormSection>

        <FormSection title="Streaming und externe Links" collapsible accent="#9146FF">
          <FormGrid>
            <TextField label="Ort" value={f.location} onChange={(v)=>set("location",v)} testId="tr-edit-location"/>
            <TextField label="Discord-Verweis" value={f.discord_link} onChange={(v)=>set("discord_link",v)} testId="tr-edit-discord"/>
            <TextField label="Alter Stream-Verweis" value={f.stream_link} onChange={(v)=>set("stream_link",v)} testId="tr-edit-stream"/>
            <TextField label="Twitch-Kanal" value={f.twitch_channel} onChange={(v)=>set("twitch_channel",v)} testId="tr-edit-twitch"/>
            <SelectInput label="Stream-Plattform" value={f.stream_platform} onChange={(v)=>set("stream_platform",v)} options={STREAM_PLATFORM_OPTIONS} />
            <TextField label="Stream-URL" value={f.stream_url} onChange={(v)=>set("stream_url",v)} testId="tr-edit-stream-url"/>
            <TextField label="Stream-Titel" value={f.stream_title} onChange={(v)=>set("stream_title",v)} testId="tr-edit-stream-title"/>
          </FormGrid>
          <div className="flex flex-wrap gap-4">
            <CheckField label="Twitch einbetten" checked={f.twitch_enabled} onChange={(v)=>set("twitch_enabled",v)} accent="#9146FF" />
            <CheckField label="Live-Stream aktiv" checked={f.has_live_stream} onChange={(v)=>set("has_live_stream",v)} accent="#9146FF" />
            <CheckField label="Chat anzeigen" checked={f.show_chat} onChange={(v)=>set("show_chat",v)} accent="#9146FF" />
          </div>
        </FormSection>
      </FormColumns>
      {hasFormChanges && (
        <div className="mt-5 rounded-sm border border-[#FFD700]/30 bg-[#FFD700]/5 px-4 py-3 text-sm text-[#FFD700]" data-testid="tr-edit-unsaved">
          Ungespeicherte Änderungen im Turnierformular.
        </div>
      )}
      <FormActions onSubmitClick={() => save()} submitTestId="tr-edit-save" icon={null} hint={hasFormChanges ? "Ungespeicherte Änderungen" : undefined}>
        <button onClick={() => save({ rebuildPreview: true })} type="button" data-testid="tr-edit-save-rebuild" className="px-5 py-2.5 border border-[#FFD700]/50 text-[#FFD700] text-xs font-bold uppercase tracking-wider rounded-sm hover:bg-[#FFD700]/10">
          Speichern & Struktur anwenden
        </button>
      </FormActions>
    </div>
  );
}

function slugify(value) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function modeLabel(options, value) {
  return options.find(([optionValue]) => optionValue === value)?.[1] || value;
}

export function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <select value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

// Ein leerer Turnierbaum hat je nach Format einen ganz anderen Grund. "Nicht
// generiert" ließ offen, ob etwas fehlt, kaputt ist oder so sein soll.

const MAX_PREVIEW_MATCHES = 512;

function emptyBracketReason(tournament) {
  const format = tournament?.format;
  const size = Number(tournament?.max_participants) || 0;

  if (format === "swiss") {
    return {
      title: "Noch keine Runde erzeugt",
      detail: "Beim Schweizer System gibt es keine Vorschau: wer gegen wen spielt, "
        + "ergibt sich erst aus den Ergebnissen der Vorrunde.",
      action: "Teilnehmer bestätigen, dann „Schweizer Runde“ drücken.",
    };
  }
  if (format === "time_trial" || format === "grand_prix") {
    return {
      title: "Kein Turnierbaum vorgesehen",
      detail: "Dieses Format wird über Rundenzeiten gewertet, nicht über Spielpaarungen.",
      action: null,
    };
  }
  const pairings = format === "league" ? size * (size - 1)
    : format === "round_robin" ? (size * (size - 1)) / 2
      : 0;
  if (pairings > MAX_PREVIEW_MATCHES) {
    return {
      title: "Zu viele Begegnungen für eine Vorschau",
      detail: `Jeder gegen jeden ergibt bei ${size} Teilnehmern ${pairings} Spiele. `
        + `Ab ${MAX_PREVIEW_MATCHES} Spielen wird kein Entwurf mehr gezeichnet.`,
      action: "Teilnehmerzahl senken oder in Gruppen aufteilen.",
    };
  }
  return {
    title: "Turnierbaum noch nicht erzeugt",
    detail: "Für dieses Turnier liegt noch keine Struktur vor.",
    action: "Unter „Struktur“ erzeugen oder Teilnehmer bestätigen.",
  };
}

export function EmptyBracketNotice({ tournament }) {
  const { title, detail, action } = emptyBracketReason(tournament);
  return (
    <div className="text-center py-14 px-6 space-y-2">
      <div className="text-white/60 font-display tracking-widest uppercase">{title}</div>
      <p className="text-white/40 text-sm max-w-lg mx-auto">{detail}</p>
      {action && <p className="text-[#29B6E8]/70 text-sm">{action}</p>}
    </div>
  );
}

function RulePresetPicker({ form, onApply }) {
  const activeKey = rulePresetKey(form);
  const warnings = rulePresetWarnings(form);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-3">
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

function SeasonWeightField({ value, onChange }) {
  const normalized = String(value ?? "2");
  const isPreset = TOURNAMENT_SEASON_WEIGHT_OPTIONS.some(([optionValue]) => optionValue === normalized);
  return (
    <label className="block md:col-span-3">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Jahreswertung</div>
      <div className="grid sm:grid-cols-[1fr_120px] gap-2">
        <select value={isPreset ? normalized : "__custom"} onChange={(e) => onChange(e.target.value === "__custom" ? value : e.target.value)} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white">
          {TOURNAMENT_SEASON_WEIGHT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          <option value="__custom">Eigener Faktor</option>
        </select>
        <input type="number" step="0.05" min="0" value={value ?? ""} onChange={(e)=>onChange(e.target.value)} data-testid="tr-edit-season-weight" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" aria-label="Jahreswertungs-Faktor" />
      </div>
      <div className="text-[11px] text-white/40 mt-1.5">
        Das hier bestimmt Major/Normal/Mini: Die Jahreswertung nimmt Platzierungs- oder Teilnahmepunkte und multipliziert sie mit diesem Faktor. 0 bedeutet: Dieses Turnier gibt keine Jahrespunkte.
      </div>
    </label>
  );
}

// Werkzeuge und Downloads lagen bisher offen im Kopf, zusammen mit den
// Ablaufaktionen: dreizehn Bedienelemente in einer Reihe. Sie sind selten nötig
// und stehen jetzt hinter einer Beschriftung, die sagt, was drin ist und wie
// viel. Bewusst ein <details> statt eines Menüs - das ist die Form, die diese
// Anwendung überall verwendet, und sie funktioniert ohne weiteres Zutun mit
// Tastatur und Vorlesehilfen.

export function ActionGroup({ title, count, testId, children }) {
  return (
    <details className="group" data-testid={testId}>
      <summary className="cursor-pointer list-none inline-flex items-center gap-2 rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/60 hover:border-[#29B6E8]/50 hover:text-white">
        {title}
        <span className="text-white/35 tabular-nums">{count}</span>
        <span className="text-[#29B6E8] transition-transform group-open:rotate-90">→</span>
      </summary>
      <div className="mt-2 flex flex-wrap gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] p-3">{children}</div>
    </details>
  );
}
