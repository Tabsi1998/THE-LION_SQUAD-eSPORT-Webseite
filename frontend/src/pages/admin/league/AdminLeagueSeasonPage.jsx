// Eine Season verwalten (docs/LIGA.md, #1622) unter /admin/leagues/seasons/<id>: Vorgaben samt Sperrzeiten, Regeltext
// und Sichtbarkeit, Map-Pool, Liga N und ihre Staffeln. Eine Staffel ist ein Turnier - angelegt wird es hier, die
// Co-Teams teilt die Turnierverwaltung der Staffel zu. Änderungen an der Season gelten für bestehende Staffeln erst
// nach „Vorgaben auf Staffeln übertragen“; was dabei nicht mehr darf (Kalender nach dem Start, Wertung nach dem ersten
// Ergebnis), meldet der Server je Staffel mit Grund.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRightLeft, CalendarOff, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SeasonApplicationSection } from "./SeasonApplicationSection";
import { SeasonApplicationsPanel } from "./SeasonApplicationsPanel";
import { SeasonEligibilitySection } from "./SeasonEligibilitySection";
import { SeasonTableRules } from "./SeasonTableRules";
import { SeasonTablePanel } from "./SeasonTablePanel";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { MapPoolEditor } from "@/pages/admin/maps/MapPoolEditor";
import { PoolMapLock } from "@/pages/admin/maps/PoolMapLock";
import { PoolVersionCompare } from "@/pages/admin/maps/PoolVersionCompare";
import { SeasonReadinessPanel } from "./SeasonReadinessPanel";
import { SeasonLoadoutBansPanel } from "./SeasonLoadoutBansPanel";
import { LeagueDeleteSheet } from "./LeagueDeleteSheet";
import { BannerField, EmblemField, PrizeEditor } from "./LeagueLookFields";
import { accentStyle, prizesPayload, prizesToForm } from "@/lib/leagueLook";
import { selectableModes } from "@/lib/gameMatchData";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { SeasonRosterPanel } from "./SeasonRosterPanel";
import { SeasonResultRulesPanel } from "./SeasonResultRulesPanel";
import { SeasonScheduleRulesPanel } from "./SeasonScheduleRulesPanel";
import { dayNoon, viennaDate } from "@/lib/vienna";
import {
  ACTIVE_STATUS_OPTIONS,
  BEST_OF_OPTIONS,
  LEGS_OPTIONS,
  MAP_REPEAT_OPTIONS,
  SEASON_STATUS_OPTIONS,
  VISIBILITY_OPTIONS,
  VISIBILITY_SHORT,
  WEEKDAY_OPTIONS,
  longestSeries,
  modeOrderProblem,
  orderLengthNote,
  sameOrder,
  overridesPayload,
  overridesToForm,
  seasonPayload,
  seasonToForm,
  settingsLine,
  syncSummary,
} from "@/lib/league";
import { toast } from "sonner";

const STAFFEL_STATUS = {
  draft: "Entwurf", scheduled: "Angekündigt", registration_open: "Anmeldung offen", registration_closed: "Anmeldung zu",
  check_in: "Check-in", live: "Läuft", paused: "Pausiert", completed: "Beendet", results_published: "Ergebnisse veröffentlicht",
  archived: "Archiviert", cancelled: "Abgesagt",
};
const SHORT_DAY = { day: "2-digit", month: "2-digit" };
const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };
const ICON_BUTTON = "p-1.5 text-white/50 hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";
const ICON_DANGER = ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live");

function dayText(day, options = SHORT_DAY) {
  return day ? viennaDate(dayNoon(day), options) : "";
}

function CalendarStrip({ calendar }) {
  if (!calendar?.weeks?.length) return null;
  return (
    <div className="space-y-2" data-testid="season-calendar">
      <p className="text-sm text-white/75">
        {calendar.weeks.length} Wochen, davon {calendar.blocked_weeks.length} gesperrt – <strong className="text-white">{calendar.active_weeks} Spielwochen</strong>.
        {" "}Eine Staffel fasst damit höchstens <strong className="text-white">{calendar.max_teams_per_staffel} Teams</strong>; mehr Teams brauchen eine zweite Staffel.
      </p>
      <ol className="flex flex-wrap gap-1.5" aria-label="Spielwochen">
        {calendar.weeks.map((week) => (
          <li key={week.number} title={`${dayText(week.start_day)} – ${dayText(week.end_day)}`}
            className={`rounded-sm border px-2 py-1 text-[11px] tabular-nums ${week.blocked ? "border-white/5 bg-transparent text-white/35 line-through" : "border-white/10 bg-[#0A0A0A] text-white/75"}`}>
            <span className="font-bold">W{week.number}</span> {dayText(week.start_day)}
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-white/45">Eine Woche ist gesperrt, wenn mehr als die Hälfte ihrer Tage in einer Sperrzeit liegt. Stand nach dem letzten Speichern.</p>
    </div>
  );
}

function BlockedPeriods({ periods, onChange }) {
  const update = (index, key, value) => onChange(periods.map((period, at) => (at === index ? { ...period, [key]: value } : period)));
  return (
    <div className="space-y-2" data-testid="season-blocked">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Sperrzeiten</div>
      {periods.length ? periods.map((period, index) => (
        <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
          <TextField label="Von" type="date" value={period.start_date} onChange={(value) => update(index, "start_date", value)} testId={`blocked-start-${index}`} />
          <TextField label="Bis" type="date" value={period.end_date} onChange={(value) => update(index, "end_date", value)} testId={`blocked-end-${index}`} />
          <TextField label="Bezeichnung" maxLength={60} value={period.label} onChange={(value) => update(index, "label", value)} placeholder="z. B. Weihnachtspause"
            className="col-span-2 sm:col-span-1" testId={`blocked-label-${index}`} />
          <button type="button" onClick={() => onChange(periods.filter((_, at) => at !== index))} aria-label="Sperrzeit entfernen"
            className={`${ICON_DANGER} justify-self-start sm:mb-1.5`} data-testid={`blocked-remove-${index}`}>
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )) : <p className="text-xs text-white/50">Keine – jede Woche wird gespielt.</p>}
      <button type="button" onClick={() => onChange([...periods, { start_date: "", end_date: "", label: "" }])} data-testid="blocked-add"
        className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
        <CalendarOff className="w-3.5 h-3.5" aria-hidden="true" /> Sperrzeit hinzufügen
      </button>
    </div>
  );
}

function ModeOrder({ modes, poolModes = [], bestOf, value, onChange, note = "" }) {
  // Ein Modus, den das Spiel nicht mehr hat (#2129): bleibt sichtbar gesetzt und gilt weiter, neu wählen geht nicht.
  const gone = [...new Set(value.filter((mode) => mode && !modes.some((known) => known.mode === mode)))]
    .map((mode) => ({ mode, label: `${poolModes.find((group) => group.mode === mode)?.label || mode} (nicht mehr im Spiel)` }));
  const choices = [...modes, ...gone];
  if (!choices.length) return null;
  const count = Number(bestOf) || 1;
  const set = (index, mode) => {
    const next = Array.from({ length: count }, (_, at) => value[at] || "");
    next[index] = mode;
    onChange(next);
  };
  // Altbestand (#2207): Eine gespeicherte Reihenfolge, die nicht zur Serie passt, nennt der Hinweis statt eines Fehlers.
  const problem = note ? "" : modeOrderProblem(value, bestOf);
  return (
    <fieldset className="space-y-1.5" data-testid="season-mode-order">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Modus je Map</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: count }, (_, index) => (
          <SelectField key={index} label={`Map ${index + 1}`} value={value[index] || ""} onChange={(mode) => set(index, mode)}
            options={[["", "frei"], ...choices.map((mode) => [mode.mode, mode.label])]} testId={`mode-order-${index}`} />
        ))}
      </div>
      {note ? <p className="text-xs text-warn" data-testid="season-mode-order-note">{note}</p> : (
        <p className={`text-xs ${problem ? "text-warn" : "text-white/45"}`}>{problem || "Alle frei: die Teams wählen den Modus je Map selbst."}</p>
      )}
    </fieldset>
  );
}

function DivisionSheet({ division, season, onClose, onSaved }) {
  const [nickname, setNickname] = useState(division?.nickname || "");
  const [status, setStatus] = useState(division?.status || "active");
  const [form, setForm] = useState(() => overridesToForm(division?.overrides || {}));
  const [prizes, setPrizes] = useState(() => prizesToForm(division?.prizes));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      // Der Stand (#2106): die API kannte ihn, das Formular schickt ihn jetzt mit - archiviert fällt aus der Ligaseite.
      const body = { nickname: nickname.trim() || null, overrides: overridesPayload(form), ...(division ? { status } : {}) };
      // Eigene Gewinne (#2107) nur, wenn sie sich ändern - leer heißt wieder „wie die Season“.
      const ownPrizes = prizesPayload(prizes);
      if (JSON.stringify(ownPrizes) !== JSON.stringify(prizesPayload(prizesToForm(division?.prizes)))) body.prizes = ownPrizes;
      const response = division ? await api.patch(`/admin/leagues/divisions/${division.id}`, body)
        : await api.post(`/admin/leagues/seasons/${season.id}/divisions`, body);
      toast.success(division ? "Liga gespeichert." : "Liga angelegt.");
      (response?.data?.warnings || []).forEach((text) => toast.warning(text));
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setSaving(false);
    }
  };
  const points = season.scoring_rules?.match_points || {};
  return (
    <AdminSheet title={division ? `${division.label} bearbeiten` : "Liga N anlegen"} eyebrow={season.name} onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel={division ? "Speichern" : "Anlegen"} submitTestId="division-save" testId="division-sheet">
      <TextField label="Beiname" maxLength={40} value={nickname} onChange={setNickname} placeholder="freiwillig, z. B. Elite"
        hint={division ? `Anzeige „Liga ${division.level} · Beiname“.` : "Die Stufe zählt von selbst weiter: Liga 1, Liga 2 …"} testId="division-nickname" />
      {division ? (
        <SelectField label="Stand" value={status} onChange={setStatus} options={ACTIVE_STATUS_OPTIONS}
          hint="Archiviert: nicht mehr auf der Ligaseite, Staffeln und Ergebnisse bleiben erhalten." testId="division-status" />
      ) : null}
      <p className="text-xs text-white/55">Leer lassen heißt: wie die Season. Nur was diese Liga anders macht, eintragen.</p>
      <FormGrid>
        <SelectField label="Best of" value={form.best_of} onChange={(value) => set("best_of", value)}
          options={[["", `wie Season (Best of ${season.best_of})`], ...BEST_OF_OPTIONS]} testId="override-best-of" />
        <TextField label="Teamgröße" type="number" min={1} max={20} value={form.team_size} onChange={(value) => set("team_size", value)}
          placeholder={`wie Season (${season.team_size})`} testId="override-team-size" />
        <TextField label="Mindestkader" type="number" min={1} max={40} value={form.min_squad_size} onChange={(value) => set("min_squad_size", value)}
          placeholder={`wie Season (${season.min_squad_size})`} testId="override-min-squad" />
        <TextField label="Teams je Staffel höchstens" type="number" min={2} max={20} value={form.max_staffel_size} onChange={(value) => set("max_staffel_size", value)}
          placeholder={`wie Season (${season.max_staffel_size})`} testId="override-staffel-size" />
        <TextField label="Antwort auf Terminvorschlag (Stunden)" type="number" min={1} max={720} value={form.match_schedule_response_hours}
          onChange={(value) => set("match_schedule_response_hours", value)} testId="override-response"
          placeholder={season.match_schedule_response_hours ? `wie Season (${season.match_schedule_response_hours})` : "wie Season"} />
      </FormGrid>
      <FormGrid cols={3}>
        <TextField label="Punkte Sieg" type="number" step="any" value={form.points_win} onChange={(value) => set("points_win", value)} placeholder={String(points.win ?? 3)} testId="override-points-win" />
        <TextField label="Remis" type="number" step="any" value={form.points_draw} onChange={(value) => set("points_draw", value)} placeholder={String(points.draw ?? 1)} testId="override-points-draw" />
        <TextField label="Niederlage" type="number" step="any" value={form.points_loss} onChange={(value) => set("points_loss", value)} placeholder={String(points.loss ?? 0)} testId="override-points-loss" />
      </FormGrid>
      <PrizeEditor rows={prizes} onChange={setPrizes} testId="division-prizes"
        emptyHint={season.prizes?.length ? `Wie die Season: ${season.prizes.map((row) => `${row.place}. ${row.text}`).join(" · ")}` : "Wie die Season – dort sind noch keine Gewinne eingetragen."} />
    </AdminSheet>
  );
}

function SyncResults({ rows }) {
  if (!rows) return null;
  if (!rows.length) return <p className="text-sm text-white/55" data-testid="sync-results">Noch keine Staffel – nichts zu übertragen.</p>;
  return (
    <ul className="space-y-2" data-testid="sync-results" aria-live="polite">
      {rows.map((row) => {
        const summary = syncSummary(row);
        return (
          <li key={row.tournament_id} className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
            <div className="font-semibold text-white">{row.title}</div>
            <div className="text-xs text-white/65">{summary.head}{summary.applied.length ? ` · ${summary.applied.join(", ")}` : ""}</div>
            {summary.skipped.map((text) => <div key={text} className="mt-1 text-xs text-warn">Nicht übertragen – {text}</div>)}
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminLeagueSeasonPage() {
  const { seasonId } = useParams();
  const confirm = useConfirm();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [syncRows, setSyncRows] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [divisionSheet, setDivisionSheet] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [overrideReason, setOverrideReason] = useState("");
  const navigate = useNavigate();

  const load = useCallback(async (resetForm = false) => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}`);
      setData(body);
      setError("");
      if (resetForm) setForm(seasonToForm(body.season));
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  }, [seasonId]);
  useEffect(() => { load(true); }, [load]);
  const reload = useCallback(() => load(false), [load]);
  useApiInvalidation(reload, ["leagues", "map-pools"]);

  // Zuständigkeiten (#2203): Der Server schickt, was diese Person hier darf - und prüft selbst noch einmal.
  const can = (capability) => !data?.capabilities || data.capabilities.includes(capability);
  const canSeason = can("season");
  const canRules = can("rules");
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  // Modus je Map (#2206): inaktive und archivierte Modi nur, wo die Season sie schon hat.
  const modes = useMemo(() => selectableModes(data?.game?.modes, data?.season?.game_mode_order), [data]);
  const staffelCount = (data?.divisions || []).reduce((sum, division) => sum + division.staffeln.length, 0);

  // „Modus je Map“ ist so lang wie die längste Serie (#2207): Best of der Season oder einer Liga N.
  const longest = longestSeries(form?.best_of, data?.divisions);
  // Altbestand (#2207): Eine gespeicherte Reihenfolge, die nicht zur Serie passt, bleibt unverändert speicherbar. Geprüft wird nur, was
  // jemand geändert hat - der Server lehnt im Entwurf ab und warnt in einer laufenden Season.
  const savedOrder = data?.season?.game_mode_order || [];
  const orderEdited = form ? !sameOrder(form.game_mode_order, savedOrder) : false;
  const bestOfEdited = form ? String(form.best_of) !== String(data?.season?.best_of) : false;
  const draft = (data?.season?.status || "draft") === "draft";
  const orderNote = form && !orderEdited ? orderLengthNote(savedOrder, longest) : "";
  const save = async (event) => {
    event.preventDefault();
    const problem = orderEdited || (draft && bestOfEdited) ? modeOrderProblem(form.game_mode_order, longest) : "";
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      // Nur „Regeln veröffentlichen“ (#2203): Der Server nimmt von dieser Person nur den Regeltext an.
      const body = canSeason ? seasonPayload(form, longest, savedOrder) : { rules_text: seasonPayload(form).rules_text };
      // Notausnahme des Superadmins beim Veröffentlichen trotz Problemen (#2207) - der Server prüft selbst.
      if (canSeason && overrideReason.trim()) body.readiness_override_reason = overrideReason.trim();
      const { data: saved } = await api.patch(`/admin/leagues/seasons/${seasonId}`, body);
      toast.success(saved.changed?.length ? "Season gespeichert." : "Keine Änderung.");
      (saved.warnings || []).forEach((text) => toast.warning(text));
      setOverrideReason("");
      if (saved.visibility_applied) toast.success(`Sichtbarkeit für ${saved.visibility_applied === 1 ? "1 Staffel" : `${saved.visibility_applied} Staffeln`} geändert.`);
      setPendingSync(saved.staffeln_to_sync || 0);
      await load(true);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSaving(false);
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const { data: body } = await api.post(`/admin/leagues/seasons/${seasonId}/sync`);
      setSyncRows(body.staffeln || []);
      setPendingSync(0);
      toast.success("Vorgaben übertragen.");
      await reload();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSyncing(false);
  };

  const createStaffel = async (division) => {
    const ok = await confirm({
      title: `Staffel in ${division.label} anlegen?`,
      description: `Ein Liga-Turnier als Entwurf mit allen Vorgaben der Season (${settingsLine(division.settings)}). Danach teilst du in der Turnierverwaltung der Staffel die Co-Teams zu.`,
      confirmLabel: "Staffel anlegen",
    });
    if (!ok) return;
    try {
      const { data: created } = await api.post(`/admin/leagues/divisions/${division.id}/staffeln`, {});
      toast.success(`Staffel ${created.staffel} angelegt.`);
      await reload();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  // Löschen und „Archivieren statt löschen“ (#2106): eine gelöschte Season führt zurück zur Übersicht.
  const afterDelete = (kind) => {
    setDeleting(null);
    if (kind === "season") navigate("/admin/leagues");
    else reload();
  };
  const archive = async ({ kind, target, name }) => {
    try {
      if (kind === "season") await api.patch(`/admin/leagues/seasons/${target.id}`, { status: "archived" });
      else await api.patch(`/admin/leagues/divisions/${target.id}`, { status: "archived" });
      toast.success(`${name} archiviert.`);
      setDeleting(null);
      await load(kind === "season");
      return true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return false;
    }
  };

  const savePool = async (body) => {
    try {
      const response = await api.put(`/admin/leagues/seasons/${seasonId}/map-pool`, body);
      toast.success("Map-Pool gespeichert.");
      (response?.data?.warnings || []).forEach((text) => toast.warning(text));
      await reload();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  const clearPool = async () => {
    if (!await confirm({ title: "Map-Pool entfernen?", description: "Ohne Pool kann in der Liga niemand mit Maps melden. Bestehende Staffeln verlieren ihre Kopie erst beim nächsten Übertragen – und nur, solange sie noch kein Ergebnis haben.", confirmLabel: "Entfernen" })) return false;
    try {
      await api.delete(`/admin/leagues/seasons/${seasonId}/map-pool`);
      toast.success("Map-Pool entfernt.");
      await reload();
      return true;
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      return false;
    }
  };

  const season = data?.season;
  return (
    <AdminLayout>
      <Link to="/admin/leagues" data-testid="season-back" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
        <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Liga
      </Link>
      {error ? <p className="mt-6 text-sm text-warn" role="alert" data-testid="season-error">{error}</p> : null}
      {data && form ? (
        <>
          <div className="mt-3 mb-6 flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3" style={accentStyle(data.league.accent_color)}>
              <LeagueEmblem src={data.look?.emblem_url} size={48} testId="season-head-emblem" />
              <div className="min-w-0">
                <h1 className="font-heading text-3xl md:text-4xl font-black uppercase break-words">{data.league.name} · {season.name}</h1>
                <p className="mt-1 text-sm text-white/60" data-testid="season-head">
                  {data.game?.name || "Spiel fehlt"} · ab {viennaDate(season.start_date, LONG_DAY)} · Sichtbarkeit: {VISIBILITY_SHORT[season.visibility]}
                </p>
              </div>
            </div>
            {/* Löschen (#2106): nur als Entwurf ohne Staffel mit Co-Teams oder Spielen - sonst bietet das Blatt Archivieren an. */}
            {can("manage") ? (
              <button type="button" onClick={() => setDeleting({ kind: "season", target: season, name: season.name })} data-testid="season-delete"
                className="tls-btn tls-btn--danger px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Season löschen
              </button>
            ) : null}
          </div>

          {pendingSync > 0 ? (
            <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn" data-testid="season-sync-hint">
              <span>Gespeichert. Die {pendingSync === 1 ? "bestehende Staffel trägt" : `${pendingSync} bestehenden Staffeln tragen`} noch die alten Werte.</span>
              <button type="button" onClick={sync} disabled={syncing} data-testid="season-sync-now"
                className="tls-btn tls-btn--primary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">Jetzt übertragen</button>
            </div>
          ) : null}

          <div className="space-y-6">
            {canSeason || canRules ? (
            <form onSubmit={save} className="space-y-6" data-testid="season-form" noValidate>
              {canSeason ? (<>
              <FormSection title="Kalender" hint="Spielwochen laufen ab dem Beginn jeweils so viele Tage. Ohne Einigung gilt der Standardtermin der Woche.">
                <FormGrid cols={3}>
                  <TextField label="Name" maxLength={80} value={form.name} onChange={(value) => set("name", value)} testId="season-form-name" />
                  <TextField label="Beginn" type="date" required value={form.start_day} onChange={(value) => set("start_day", value)} hint="00:00 Uhr Wiener Zeit" testId="season-form-start" />
                  <TextField label="Wochen gesamt" type="number" min={1} max={52} value={form.weeks_total} onChange={(value) => set("weeks_total", value)} hint="mit Sperrwochen" testId="season-form-weeks" />
                  <TextField label="Spielwoche (Tage)" type="number" min={1} max={31} value={form.matchday_days} onChange={(value) => set("matchday_days", value)} testId="season-form-days" />
                  <SelectField label="Standardtag" value={form.default_match_weekday} onChange={(value) => set("default_match_weekday", value)} options={WEEKDAY_OPTIONS} testId="season-form-weekday" />
                  <TextField label="Standardzeit" type="time" value={form.default_match_time} onChange={(value) => set("default_match_time", value)} testId="season-form-time" />
                  <SelectField label="Runden" value={form.round_robin_legs} onChange={(value) => set("round_robin_legs", value)} options={LEGS_OPTIONS} testId="season-form-legs" />
                  <TextField label="Meldeschluss" type="date" value={form.registration_deadline} onChange={(value) => set("registration_deadline", value)} hint="nur zur Anzeige" testId="season-form-deadline" />
                </FormGrid>
                <BlockedPeriods periods={form.blocked_periods} onChange={(value) => set("blocked_periods", value)} />
                <CalendarStrip calendar={data.calendar} />
              </FormSection>

              <FormSection title="Spiel und Wertung" hint="Liga N kann Best of, Teamgröße, Mindestkader, Staffelgröße und Punkte abweichend festlegen.">
                <FormGrid cols={3}>
                  <SelectField label="Best of" value={form.best_of} onChange={(value) => set("best_of", value)} options={BEST_OF_OPTIONS} testId="season-form-best-of" />
                  <TextField label="Teamgröße (je Map)" type="number" min={1} max={20} value={form.team_size} onChange={(value) => set("team_size", value)} testId="season-form-team-size" />
                  <TextField label="Mindestkader" type="number" min={1} max={40} value={form.min_squad_size} onChange={(value) => set("min_squad_size", value)} testId="season-form-min-squad" />
                  <TextField label="Teams je Staffel höchstens" type="number" min={2} max={20} value={form.max_staffel_size} onChange={(value) => set("max_staffel_size", value)} testId="season-form-staffel-size" />
                </FormGrid>
                <ModeOrder modes={modes} poolModes={data.map_pool?.modes} bestOf={longest} value={form.game_mode_order} onChange={(value) => set("game_mode_order", value)} note={orderNote} />
                <FormGrid>
                  <SelectField label="Map-Wiederholung in einer Serie" value={form.map_repeat} onChange={(value) => set("map_repeat", value)} options={MAP_REPEAT_OPTIONS}
                    hint="Ob dieselbe Map in einer Serie noch einmal gespielt werden darf. Die Meldung prüft es." testId="season-form-map-repeat" />
                </FormGrid>
                <FormGrid cols={3}>
                  <TextField label="Punkte Sieg" type="number" step="any" value={form.points_win} onChange={(value) => set("points_win", value)} testId="season-form-points-win" />
                  <TextField label="Remis" type="number" step="any" value={form.points_draw} onChange={(value) => set("points_draw", value)} testId="season-form-points-draw" />
                  <TextField label="Niederlage" type="number" step="any" value={form.points_loss} onChange={(value) => set("points_loss", value)} testId="season-form-points-loss" />
                </FormGrid>
                <SeasonTableRules form={form} set={set} />
                <FormGrid cols={3}>
                  <TextField label="Ergebnis gilt nach (Stunden)" type="number" min={1} max={336} value={form.result_confirm_hours} onChange={(value) => set("result_confirm_hours", value)}
                    hint="ohne Antwort der Gegenseite" testId="season-form-confirm" />
                  <TextField label={form.lineup_mode === "series" ? "Teilnehmerliste nachtragen bis (Stunden)" : "Aufstellung nachtragen bis (Stunden)"} type="number" min={1} max={336} value={form.lineup_amend_hours} onChange={(value) => set("lineup_amend_hours", value)}
                    hint={form.lineup_mode === "series" ? "ab der Bestätigung, danach geht der Fall an die Leitung" : "nach dem Ergebnis"} testId="season-form-amend" />
                  {/* Antwortfrist (#2106, F3): früher je Staffel; leer bei älteren Seasons - dann behält jede Staffel ihre. */}
                  <TextField label="Antwort auf Terminvorschlag (Stunden)" type="number" min={1} max={720} value={form.match_schedule_response_hours}
                    onChange={(value) => set("match_schedule_response_hours", value)} placeholder="leer: je Staffel wie bisher"
                    hint="So lange hat die Gegenseite Zeit; gilt für neue Vorschläge" testId="season-form-response" />
                </FormGrid>
              </FormSection>

              <SeasonEligibilitySection form={form} set={set} />

              <SeasonApplicationSection form={form} set={set} />

              </>) : null}
              <FormSection title={canSeason ? "Regeltext und Sichtbarkeit" : "Regeltext"}>
                {/* Regelwerk (#1646): Versionen, PDF und Zustimmung auf eigener Seite; der Regeltext bleibt der Rückfall ohne Regelwerk. */}
                {canRules ? (
                  <>
                    <Link to={`/admin/leagues/rules/league_season/${seasonId}`} data-testid="season-rules-link"
                      className="tls-btn tls-btn--secondary inline-flex rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">Regelwerk mit Versionen pflegen</Link>
                    <TextAreaField label="Regeltext" rows={8} value={form.rules_text} onChange={(value) => set("rules_text", value)} placeholder="Markdown, z. B. Ablauf, Fairplay, Map-Veto"
                      hint="Gilt nur, solange es für die Season und die Liga kein Regelwerk gibt." testId="season-form-rules" />
                  </>
                ) : null}
                {canSeason ? (
                <FormGrid>
                  <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(value) => set("visibility", value)} options={VISIBILITY_OPTIONS}
                    hint="Gilt beim Speichern sofort für Ligaseite, Menüpunkt „Liga“ und alle Staffel-Turniere – auch gesperrte." testId="season-form-visibility" />
                  <SelectField label="Stand" value={form.status} onChange={(value) => set("status", value)} options={SEASON_STATUS_OPTIONS} testId="season-form-status" />
                </FormGrid>
                ) : null}
              </FormSection>

              {/* Gestaltung (#2107): Emblem und Banner überschreiben die der Liga, leer heißt „wie die Liga“. Die Farbe
                  gehört der Liga (Stift in der Ligaübersicht). Gewinne sind reine Anzeige - kein Bezug zu XP oder Pokalen. */}
              {canSeason ? (
              <FormSection title="Gestaltung und Gewinne" testId="season-look"
                hint="Wirkt beim Speichern sofort auf Ligaseite, Übersicht, Teamseite und Link-Vorschau – ohne Übertragen. Das Banner bekommen auch die Staffeln (die App zeigt es beim Turnier).">
                <FormGrid>
                  <EmblemField value={form.emblem_url} onChange={(value) => set("emblem_url", value || "")} inherited={data.league.emblem_url}
                    inheritedLabel="Leer: das Emblem der Liga (Vorschau)." accent={data.league.accent_color} testId="season-emblem" />
                  <BannerField url={form.banner_url} focus={form.banner_focus} inherited={data.league.banner_url ? { url: data.league.banner_url, ...(data.league.banner_focus || {}) } : null}
                    inheritedLabel="Leer: das Banner der Liga (Vorschau)." emblem={form.emblem_url || data.league.emblem_url} accent={data.league.accent_color} testId="season-banner"
                    onChange={(url, focus) => setForm((current) => ({ ...current, banner_url: url || "", banner_focus: focus }))} />
                </FormGrid>
                <PrizeEditor rows={form.prizes} onChange={(value) => set("prizes", value)} testId="season-prizes"
                  emptyHint="Noch keine Gewinne – die Ligaseite zeigt dann keinen Block „Um was gespielt wird“." />
              </FormSection>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={saving} data-testid="season-save"
                  className="tls-btn tls-btn--primary px-5 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                  {saving ? "Speichere …" : canSeason ? "Season speichern" : "Regeltext speichern"}
                </button>
                {staffelCount && canSeason ? <span className="text-xs text-white/50">Die Sichtbarkeit gilt sofort; alle anderen Änderungen übernehmen bestehende Staffeln erst beim Übertragen.</span> : null}
              </div>
            </form>
            ) : null}

            {canSeason ? (
              <MapPoolEditor key={data.map_pool?.id || "leer"} title="Map-Pool der Season" game={data.game} library={data.library} entry={data.map_pool} defaultPool={data.default_pool}
                hint="Jede neue Staffel bekommt eine Kopie; Änderungen kommen beim Übertragen an. Ohne Pool kann niemand mit Maps melden." onSave={savePool} onClear={clearPool} libraryLink testId="season-pool" />
            ) : null}
            {/* C.2 (#2207): Map sperren, Versionen vergleichen, Prüfung vor der Veröffentlichung - eigenständige Bausteine. */}
            {canSeason && data.map_pool && !data.map_pool.stale ? (
              <PoolMapLock endpoint={`/admin/leagues/seasons/${seasonId}/map-pool/remove-map`} pool={data.map_pool} onDone={reload} testId="season-pool-lock" />
            ) : null}
            <PoolVersionCompare baseUrl={`/admin/leagues/seasons/${seasonId}/map-pool`} version={data.map_pool?.version} testId="season-pool-compare" />
            {/* C.4 (#2218): Sperrliste der Ausrüstung - eigenständig, lädt sich selbst; Staffeln bekommen sie beim Übertragen. */}
            <SeasonLoadoutBansPanel seasonId={seasonId} canEdit={canSeason} onSaved={(count) => setPendingSync(count)} />
            <SeasonReadinessPanel seasonId={seasonId} version={`${season.updated_at}-${data.map_pool?.version ?? 0}-${data.divisions.length}-${staffelCount}`}
              visibility={season.visibility} canEdit={canSeason} overrideReason={overrideReason} onOverrideReason={canSeason ? setOverrideReason : undefined}
              onSaved={reload} />


            {/* Ergebnisregeln (C.3, #1617): eigene Speichern-Taste, Hinweis aufs Übertragen wie beim Season-Formular. */}
            <SeasonResultRulesPanel seasonId={seasonId} canEdit={canSeason} onSaved={setPendingSync} />

            <section className="border border-white/10 rounded-sm bg-[#121212] p-4 md:p-5 space-y-4" aria-label="Ligen und Staffeln" data-testid="season-divisions">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-xl font-bold uppercase">Ligen und Staffeln</h2>
                {canSeason ? (
                  <button type="button" onClick={() => setDivisionSheet({})} data-testid="division-add"
                    className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Liga {(data.divisions.at(-1)?.level || 0) + 1} anlegen
                  </button>
                ) : null}
              </div>
              {!data.divisions.length ? <p className="text-sm text-white/55">Noch keine Liga. Lege Liga 1 an – darin entstehen die Staffeln.</p> : null}
              {data.divisions.map((division) => (
                <div key={division.id} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0" data-testid={`division-${division.level}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white">
                        {division.label}
                        {division.status === "archived" ? <span className="ml-2 rounded-sm bg-white/5 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-white/55" data-testid={`division-archived-${division.level}`}>Archiviert</span> : null}
                      </h3>
                      <p className="text-xs text-white/55">{settingsLine(division.settings)}{Object.keys(division.overrides || {}).length ? " · weicht von der Season ab" : ""}</p>
                      <p className="text-xs text-white/55">{division.calendar.active_weeks} Spielwochen – höchstens {division.calendar.max_teams_per_staffel} Teams je Staffel</p>
                    </div>
                    {canSeason ? (
                    <div className="flex items-center gap-1">
                      <button type="button" className={ICON_BUTTON} onClick={() => setDivisionSheet(division)} aria-label={`${division.label} bearbeiten`} data-testid={`division-edit-${division.level}`}>
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button type="button" className={ICON_DANGER} onClick={() => setDeleting({ kind: "division", target: division, name: division.label })}
                        aria-label={`${division.label} löschen`} data-testid={`division-delete-${division.level}`}>
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => createStaffel(division)} data-testid={`staffel-add-${division.level}`}
                        className="tls-btn tls-btn--primary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Staffel anlegen
                      </button>
                    </div>
                    ) : null}
                  </div>
                  {division.staffeln.length ? (
                    <ul className="mt-3 divide-y divide-white/5 rounded-sm border border-white/10 bg-[#0A0A0A]">
                      {division.staffeln.map((staffel) => (
                        <li key={staffel.tournament_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid={`staffel-${division.level}-${staffel.staffel}`}>
                          <span className="font-semibold text-white">Staffel {staffel.staffel}</span>
                          <span className="text-xs text-white/55 tabular-nums">{staffel.participant_count} von {staffel.max_participants} Teams · {STAFFEL_STATUS[staffel.status] || staffel.status}</span>
                          <span className="ml-auto inline-flex items-center gap-2">
                            <Link to={`/admin/tournaments/${staffel.tournament_id}`} data-testid={`staffel-manage-${division.level}-${staffel.staffel}`}
                              className="inline-flex items-center gap-1 text-xs font-bold text-[#29B6E8] hover:text-white">
                              Turnierverwaltung · Co-Teams zuteilen <ExternalLink className="w-3 h-3" aria-hidden="true" />
                            </Link>
                            {/* Staffel löschen (#2106) nur als Entwurf - dieselbe Sperre wie in der Turnierverwaltung prüft der Server. */}
                            {staffel.status === "draft" && canSeason ? (
                              <button type="button" className={ICON_DANGER} onClick={() => setDeleting({ kind: "staffel", target: staffel, name: `${division.label} · Staffel ${staffel.staffel}` })}
                                aria-label={`Staffel ${staffel.staffel} löschen`} data-testid={`staffel-delete-${division.level}-${staffel.staffel}`}>
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              </button>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-xs text-white/50">Noch keine Staffel.</p>}
                </div>
              ))}
            </section>

            {/* Tabelle (E.1, #1625): Gleichstände je Staffel, Entscheid der Leitung - lesen darf jede Zuständigkeit. */}
            <SeasonTablePanel divisions={data.divisions} canDecide={can("results")} />

            {can("applications") ? <SeasonApplicationsPanel seasonId={seasonId} version={season.updated_at} /> : null}

            {can("roster") ? <SeasonRosterPanel seasonId={seasonId} /> : null}
            {canSeason ? <SeasonScheduleRulesPanel seasonId={seasonId} /> : null}

            {canSeason ? (
            <FormSection title="Vorgaben auf Staffeln übertragen" testId="season-sync"
              hint="Regeltext und Map-Pool immer, auch bei gesperrten Staffeln; die Antwortfrist auf Terminvorschläge auch während der Season, nur nicht bei gesperrten; Termine und Kalender nur vor dem Start; Best of, Teamgröße, Mindestkader, Punkte und Fristen nur vor dem ersten Ergebnis. Die Sichtbarkeit gilt schon beim Speichern.">
              <button type="button" onClick={sync} disabled={syncing || !staffelCount} data-testid="season-sync-run"
                className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
                <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" /> {syncing ? "Übertrage …" : "Vorgaben übertragen"}
              </button>
              <SyncResults rows={syncRows} />
            </FormSection>
            ) : null}
          </div>

          {divisionSheet ? (
            <DivisionSheet division={divisionSheet.id ? divisionSheet : null} season={season} onClose={() => setDivisionSheet(null)}
              onSaved={() => { setDivisionSheet(null); reload(); }} />
          ) : null}
          {deleting ? (
            <LeagueDeleteSheet kind={deleting.kind} target={deleting.target} name={deleting.name} onClose={() => setDeleting(null)}
              onDeleted={() => afterDelete(deleting.kind)} onArchive={deleting.kind === "staffel" ? undefined : () => archive(deleting)} />
          ) : null}
        </>
      ) : null}
    </AdminLayout>
  );
}
