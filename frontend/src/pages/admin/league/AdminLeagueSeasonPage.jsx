// Eine Season verwalten (docs/LIGA.md, #1622) unter /admin/leagues/seasons/<id>: Vorgaben samt Sperrzeiten, Regeltext
// und Sichtbarkeit, Map-Pool, Liga N und ihre Staffeln. Eine Staffel ist ein Turnier - angelegt wird es hier, die
// Co-Teams teilt die Turnierverwaltung der Staffel zu. Änderungen an der Season gelten für bestehende Staffeln erst
// nach „Vorgaben auf Staffeln übertragen“; was dabei nicht mehr darf (Kalender nach dem Start, Wertung nach dem ersten
// Ergebnis), meldet der Server je Staffel mit Grund.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRightLeft, CalendarOff, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { MapPoolEditor } from "@/pages/admin/maps/MapPoolEditor";
import { SeasonRosterPanel } from "./SeasonRosterPanel";
import { dayNoon, viennaDate } from "@/lib/vienna";
import {
  BEST_OF_OPTIONS,
  LEGS_OPTIONS,
  MAP_REPEAT_OPTIONS,
  SEASON_STATUS_OPTIONS,
  TIEBREAKER_LABELS,
  VISIBILITY_OPTIONS,
  VISIBILITY_SHORT,
  WEEKDAY_OPTIONS,
  modeOrderProblem,
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
            className={`${ICON_BUTTON.replace("hover:text-[#29B6E8]", "hover:text-live")} justify-self-start sm:mb-1.5`} data-testid={`blocked-remove-${index}`}>
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

function Tiebreakers({ value, onChange }) {
  const all = Object.keys(TIEBREAKER_LABELS);
  const toggle = (key) => onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key]);
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Bei Punktgleichheit</legend>
      <div className="flex flex-wrap gap-2">
        {all.map((key) => {
          const position = value.indexOf(key);
          return (
            <label key={key} className={`inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 text-xs cursor-pointer select-none focus-within:outline focus-within:outline-1 focus-within:outline-[#29B6E8] ${position >= 0 ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-white" : "border-white/10 bg-[#0A0A0A] text-white/65"}`}>
              <input type="checkbox" checked={position >= 0} onChange={() => toggle(key)} className="accent-[#29B6E8]" data-testid={`tiebreaker-${key}`} />
              {position >= 0 ? <span className="font-bold tabular-nums text-[#29B6E8]">{position + 1}.</span> : null}
              {TIEBREAKER_LABELS[key]}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-white/45">In der Reihenfolge des Anklickens. Zuerst zählen immer die Punkte.</p>
    </fieldset>
  );
}

function ModeOrder({ modes, bestOf, value, onChange }) {
  if (!modes.length) return null;
  const count = Number(bestOf) || 1;
  const set = (index, mode) => {
    const next = Array.from({ length: count }, (_, at) => value[at] || "");
    next[index] = mode;
    onChange(next);
  };
  const problem = modeOrderProblem(value, bestOf);
  return (
    <fieldset className="space-y-1.5" data-testid="season-mode-order">
      <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60">Modus je Map</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: count }, (_, index) => (
          <SelectField key={index} label={`Map ${index + 1}`} value={value[index] || ""} onChange={(mode) => set(index, mode)}
            options={[["", "frei"], ...modes.map((mode) => [mode.mode, mode.label])]} testId={`mode-order-${index}`} />
        ))}
      </div>
      <p className={`text-xs ${problem ? "text-warn" : "text-white/45"}`}>{problem || "Alle frei: die Teams wählen den Modus je Map selbst."}</p>
    </fieldset>
  );
}

function DivisionSheet({ division, season, onClose, onSaved }) {
  const [nickname, setNickname] = useState(division?.nickname || "");
  const [form, setForm] = useState(() => overridesToForm(division?.overrides || {}));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const body = { nickname: nickname.trim() || null, overrides: overridesPayload(form) };
      if (division) await api.patch(`/admin/leagues/divisions/${division.id}`, body);
      else await api.post(`/admin/leagues/seasons/${season.id}/divisions`, body);
      toast.success(division ? "Liga gespeichert." : "Liga angelegt.");
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
      </FormGrid>
      <FormGrid cols={3}>
        <TextField label="Punkte Sieg" type="number" step="any" value={form.points_win} onChange={(value) => set("points_win", value)} placeholder={String(points.win ?? 3)} testId="override-points-win" />
        <TextField label="Remis" type="number" step="any" value={form.points_draw} onChange={(value) => set("points_draw", value)} placeholder={String(points.draw ?? 1)} testId="override-points-draw" />
        <TextField label="Niederlage" type="number" step="any" value={form.points_loss} onChange={(value) => set("points_loss", value)} placeholder={String(points.loss ?? 0)} testId="override-points-loss" />
      </FormGrid>
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

  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const modes = useMemo(() => data?.game?.modes || [], [data]);
  const staffelCount = (data?.divisions || []).reduce((sum, division) => sum + division.staffeln.length, 0);

  const save = async (event) => {
    event.preventDefault();
    const problem = modeOrderProblem(form.game_mode_order, form.best_of);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const { data: saved } = await api.patch(`/admin/leagues/seasons/${seasonId}`, seasonPayload(form));
      toast.success(saved.changed?.length ? "Season gespeichert." : "Keine Änderung.");
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

  const savePool = async (body) => {
    try {
      await api.put(`/admin/leagues/seasons/${seasonId}/map-pool`, body);
      toast.success("Map-Pool gespeichert.");
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
          <div className="mt-3 mb-6 min-w-0">
            <h1 className="font-heading text-3xl md:text-4xl font-black uppercase break-words">{data.league.name} · {season.name}</h1>
            <p className="mt-1 text-sm text-white/60" data-testid="season-head">
              {data.game?.name || "Spiel fehlt"} · ab {viennaDate(season.start_date, LONG_DAY)} · Sichtbarkeit: {VISIBILITY_SHORT[season.visibility]}
            </p>
          </div>

          {pendingSync > 0 ? (
            <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn" data-testid="season-sync-hint">
              <span>Gespeichert. Die {pendingSync === 1 ? "bestehende Staffel trägt" : `${pendingSync} bestehenden Staffeln tragen`} noch die alten Werte.</span>
              <button type="button" onClick={sync} disabled={syncing} data-testid="season-sync-now"
                className="tls-btn tls-btn--primary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">Jetzt übertragen</button>
            </div>
          ) : null}

          <div className="space-y-6">
            <form onSubmit={save} className="space-y-6" data-testid="season-form" noValidate>
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
                <ModeOrder modes={modes} bestOf={form.best_of} value={form.game_mode_order} onChange={(value) => set("game_mode_order", value)} />
                <FormGrid>
                  <SelectField label="Map-Wiederholung in einer Serie" value={form.map_repeat} onChange={(value) => set("map_repeat", value)} options={MAP_REPEAT_OPTIONS}
                    hint="Ob dieselbe Map in einer Serie noch einmal gespielt werden darf. Die Meldung prüft es." testId="season-form-map-repeat" />
                </FormGrid>
                <FormGrid cols={3}>
                  <TextField label="Punkte Sieg" type="number" step="any" value={form.points_win} onChange={(value) => set("points_win", value)} testId="season-form-points-win" />
                  <TextField label="Remis" type="number" step="any" value={form.points_draw} onChange={(value) => set("points_draw", value)} testId="season-form-points-draw" />
                  <TextField label="Niederlage" type="number" step="any" value={form.points_loss} onChange={(value) => set("points_loss", value)} testId="season-form-points-loss" />
                </FormGrid>
                <Tiebreakers value={form.table_tiebreakers} onChange={(value) => set("table_tiebreakers", value)} />
                <FormGrid>
                  <TextField label="Ergebnis gilt nach (Stunden)" type="number" min={1} max={336} value={form.result_confirm_hours} onChange={(value) => set("result_confirm_hours", value)}
                    hint="ohne Antwort der Gegenseite" testId="season-form-confirm" />
                  <TextField label="Aufstellung nachtragen bis (Stunden)" type="number" min={1} max={336} value={form.lineup_amend_hours} onChange={(value) => set("lineup_amend_hours", value)}
                    hint="nach dem Ergebnis" testId="season-form-amend" />
                </FormGrid>
              </FormSection>

              <FormSection title="Regeltext und Sichtbarkeit">
                <TextAreaField label="Regeltext" rows={8} value={form.rules_text} onChange={(value) => set("rules_text", value)} placeholder="Markdown, z. B. Ablauf, Fairplay, Map-Veto" testId="season-form-rules" />
                <FormGrid>
                  <SelectField label="Sichtbarkeit" value={form.visibility} onChange={(value) => set("visibility", value)} options={VISIBILITY_OPTIONS}
                    hint="Gilt beim Speichern sofort für Ligaseite, Menüpunkt „Liga“ und alle Staffel-Turniere – auch gesperrte." testId="season-form-visibility" />
                  <SelectField label="Stand" value={form.status} onChange={(value) => set("status", value)} options={SEASON_STATUS_OPTIONS} testId="season-form-status" />
                </FormGrid>
              </FormSection>

              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={saving} data-testid="season-save"
                  className="tls-btn tls-btn--primary px-5 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                  {saving ? "Speichere …" : "Season speichern"}
                </button>
                {staffelCount ? <span className="text-xs text-white/50">Die Sichtbarkeit gilt sofort; alle anderen Änderungen übernehmen bestehende Staffeln erst beim Übertragen.</span> : null}
              </div>
            </form>

            <MapPoolEditor key={data.map_pool?.id || "leer"} title="Map-Pool der Season" game={data.game} library={data.library} entry={data.map_pool}
              hint="Jede neue Staffel bekommt eine Kopie; Änderungen kommen beim Übertragen an. Ohne Pool kann niemand mit Maps melden." onSave={savePool} onClear={clearPool} libraryLink testId="season-pool" />

            <section className="border border-white/10 rounded-sm bg-[#121212] p-4 md:p-5 space-y-4" aria-label="Ligen und Staffeln" data-testid="season-divisions">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-xl font-bold uppercase">Ligen und Staffeln</h2>
                <button type="button" onClick={() => setDivisionSheet({})} data-testid="division-add"
                  className="tls-btn tls-btn--quiet px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Liga {(data.divisions.at(-1)?.level || 0) + 1} anlegen
                </button>
              </div>
              {!data.divisions.length ? <p className="text-sm text-white/55">Noch keine Liga. Lege Liga 1 an – darin entstehen die Staffeln.</p> : null}
              {data.divisions.map((division) => (
                <div key={division.id} className="border-t border-white/10 pt-4 first:border-t-0 first:pt-0" data-testid={`division-${division.level}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-bold text-white">{division.label}</h3>
                      <p className="text-xs text-white/55">{settingsLine(division.settings)}{Object.keys(division.overrides || {}).length ? " · weicht von der Season ab" : ""}</p>
                      <p className="text-xs text-white/55">{division.calendar.active_weeks} Spielwochen – höchstens {division.calendar.max_teams_per_staffel} Teams je Staffel</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" className={ICON_BUTTON} onClick={() => setDivisionSheet(division)} aria-label={`${division.label} bearbeiten`} data-testid={`division-edit-${division.level}`}>
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => createStaffel(division)} data-testid={`staffel-add-${division.level}`}
                        className="tls-btn tls-btn--primary px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Staffel anlegen
                      </button>
                    </div>
                  </div>
                  {division.staffeln.length ? (
                    <ul className="mt-3 divide-y divide-white/5 rounded-sm border border-white/10 bg-[#0A0A0A]">
                      {division.staffeln.map((staffel) => (
                        <li key={staffel.tournament_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-testid={`staffel-${division.level}-${staffel.staffel}`}>
                          <span className="font-semibold text-white">Staffel {staffel.staffel}</span>
                          <span className="text-xs text-white/55 tabular-nums">{staffel.participant_count} von {staffel.max_participants} Teams · {STAFFEL_STATUS[staffel.status] || staffel.status}</span>
                          <Link to={`/admin/tournaments/${staffel.tournament_id}`} data-testid={`staffel-manage-${division.level}-${staffel.staffel}`}
                            className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-[#29B6E8] hover:text-white">
                            Turnierverwaltung · Co-Teams zuteilen <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="mt-2 text-xs text-white/50">Noch keine Staffel.</p>}
                </div>
              ))}
            </section>

            <SeasonRosterPanel seasonId={seasonId} />

            <FormSection title="Vorgaben auf Staffeln übertragen" testId="season-sync"
              hint="Regeltext und Map-Pool immer, auch bei gesperrten Staffeln; Termine und Kalender nur vor dem Start; Best of, Teamgröße, Mindestkader, Punkte und Fristen nur vor dem ersten Ergebnis. Die Sichtbarkeit gilt schon beim Speichern.">
              <button type="button" onClick={sync} disabled={syncing || !staffelCount} data-testid="season-sync-run"
                className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
                <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" /> {syncing ? "Übertrage …" : "Vorgaben übertragen"}
              </button>
              <SyncResults rows={syncRows} />
            </FormSection>
          </div>

          {divisionSheet ? (
            <DivisionSheet division={divisionSheet.id ? divisionSheet : null} season={season} onClose={() => setDivisionSheet(null)}
              onSaved={() => { setDivisionSheet(null); reload(); }} />
          ) : null}
        </>
      ) : null}
    </AdminLayout>
  );
}
