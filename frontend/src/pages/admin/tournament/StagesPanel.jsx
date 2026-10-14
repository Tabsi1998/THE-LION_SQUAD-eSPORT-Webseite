// Turnier-Bearbeitung (#223): Stufen, Partien, Ergebnisse und Termine – der Betriebs-Reiter.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { formatDateTime } from "@/lib/datetime";
import { toast } from "sonner";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { STAGE_TYPE_OPTIONS, STAGE_STATUS_OPTIONS, formatBracketSection, formatMatchStatus, formatMatchType, formatStageType } from "@/lib/tournamentLabels";
import { Fld } from "./PrizeEditor";
import { ResultWindowLoader } from "@/components/tls/results/ResultWindow";
import { ResultUndoBar, useResultUndo } from "@/components/tls/results/ResultUndoBar";
import { SelectField, modeLabel } from "./TournamentEditForm";
import { DrawControls } from "./DrawControls";
import { sourceLabel } from "@/lib/slotSource";
import { durationSourceText, matchDurationSource, ownDurationInput, ownDurationPayload } from "@/lib/matchDuration";
import { DEFAULT_FFA_SCHEMA, DRAW_SHOW_MINUTES_DEFAULT, DRAW_SHOW_MINUTES_HINT, EVENT_MODE_OPTIONS, GRAND_FINAL_HINT, GRAND_FINAL_OPTIONS, STAGE_ADVANCEMENT_OPTIONS, RESULT_ENTRY_MODE_OPTIONS, SCHEDULE_MODE_OPTIONS, advancementModeHint, applyStageType, drawShowMinutesPayload, matchSectionKey, sectionSortIndex, sortMatchesForPlan, stageAdvancementSettings, stageAdvancementValue, stageConfigFor, stationDisplay } from "./shared";

// Die Dauer-Kette (#1554): Turnier, Phasen und das Spiel (Modi), damit jedes Feld sagen kann, was ohne eigenen Wert gilt.
const DurationContext = createContext({ tournament: null, game: null, stageById: new Map() });

function inheritedDuration(ctx, { stage = null, match = null } = {}) {
  return matchDurationSource(match ? { ...match, duration_minutes: null } : {}, { stage, tournament: ctx.tournament, game: ctx.game });
}

function DurationSource({ own, inherited, testId }) {
  const text = durationSourceText(inherited);
  return <span className="block mt-1 text-[11px] text-white/45" data-testid={testId}>{own === "" ? text : `Leer lassen: ${text}`}</span>;
}

// Je Spiel (nach Codex-Prüfung): ein Einsatz für einzelne Spiele, Phasen, Gruppen oder Stationen zeigt seine Knöpfe nur dort.
const NO_MATCH_RIGHTS = () => ({ plan: false, results: false });

// Rechte je Turnier (#1353), wie sie der Server schickt: Einstellungen der Phasen nur für die Turnierleitung über alle
// Turniere, Erzeugen mit dem Aufbau-Recht, Termin und Station mit dem Check-in-Recht, Ergebnisse mit dem Ergebnis-Recht.
export function TournamentStagesPanel({ tournamentId, stages, matches, registrations, stations = [], canEditSettings = false, canManageStructure = false, rightsForMatch = NO_MATCH_RIGHTS, onChanged, onOpenMatchplan = null, mode = "operations", tournament = null, durationGame = null }) {
  const showSettings = canEditSettings && mode === "settings";
  const showMatchList = mode !== "settings";
  const [createOpen, setCreateOpen] = useState(stages.length === 0);
  const [form, setForm] = useState({
    name: "Phase 1",
    match_type: "ffa",
    stage_type: "ffa_custom_bracket",
    match_size: 4,
    min_players: 2,
    qualifiers_per_match: 2,
    duration_minutes: "",
    event_mode: "",
    result_entry_mode: "",
    schedule_mode: "",
    grand_final: "",
    advancement: "",
    draw_show_minutes: "",
    schema: DEFAULT_FFA_SCHEMA,
  });
  const confirm = useConfirm();
  const durationContext = useMemo(() => ({
    tournament, game: durationGame, stageById: new Map((stages || []).map((stage) => [stage.id, stage])),
  }), [tournament, durationGame, stages]);
  const regById = Object.fromEntries((registrations || []).map((r) => [r.id, r]));
  const config = stageConfigFor(form);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const setStageType = (stageType) => setForm((current) => applyStageType(current, stageType));
  const createStage = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/tournaments/${tournamentId}/stages`, {
        name: form.name || "Phase",
        match_type: form.match_type,
        stage_type: form.stage_type,
        settings: {
          match_size: Number(form.match_size) || 4,
          min_players: Number(form.min_players) || 2,
          qualifiers_per_match: Number(form.qualifiers_per_match) || 1,
          duration_minutes: ownDurationPayload(form.duration_minutes),
          event_mode: form.event_mode || null,
          result_entry_mode: form.result_entry_mode || null,
          schedule_mode: form.schedule_mode || null,
          grand_final: form.grand_final || null,
          ...stageAdvancementSettings(form.advancement),
          draw_show_minutes: form.advancement === "draw_show" ? drawShowMinutesPayload(form.draw_show_minutes) : null,
          schema: form.schema || "",
          score_type: "points",
          calculation: "points",
        },
      });
      toast.success("Phase angelegt.");
      setCreateOpen(false);
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Phase konnte nicht angelegt werden."));
    }
  };
  const removeStage = async (stage) => {
    if (!await confirm({
      title: "Phase löschen?",
      description: "Alle Spiele und Berichte dieser Phase werden gelöscht.",
      confirmLabel: "Löschen",
      tone: "danger",
    })) return;
    try {
      await api.delete(`/tournaments/${tournamentId}/stages/${stage.id}`);
      toast.success("Phase gelöscht.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Phase konnte nicht gelöscht werden."));
    }
  };

  return (
    <DurationContext.Provider value={durationContext}>
    <div className="space-y-5">
      {mode === "settings" && (
        <div className="text-xs text-white/50 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
          Erweiterte Bracket-Phasen sind nur für eigene Schemas oder Spezial-Brackets nötig. Zeiten und Stationen gehören in den Matchplan, Ergebnisse in den Reiter „Spiele“.
        </div>
      )}
      {mode !== "settings" && (
        // Der Matchplan ersetzt die alte Matchplanung je Karte (Praxis nach #1589): hier Phasen, Spiele und Ergebnisse.
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/70 border border-white/10 bg-[#0A0A0A] rounded-sm px-4 py-3" data-testid="stages-matchplan-hint">
          <span>Zeiten und Stationen planst du im Matchplan: Zeitleiste je Station, Vorschau, Ziehen und je Spiel „ändern“.</span>
          {onOpenMatchplan && (
            <button type="button" onClick={onOpenMatchplan} className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">Zum Matchplan</button>
          )}
        </div>
      )}
      {showSettings && (
        <div className="border border-white/10 bg-[#121212] rounded-sm">
          <button type="button" onClick={() => setCreateOpen((v) => !v)} className="w-full flex items-center justify-between px-5 py-4 text-left">
            <span className="font-heading font-bold uppercase">Phase anlegen</span>
            <span className="text-[#29B6E8] text-xl leading-none">{createOpen ? "−" : "+"}</span>
          </button>
          {createOpen && (
            <form onSubmit={createStage} className="border-t border-white/10 p-5 grid md:grid-cols-3 gap-3">
              <Fld label="Name" value={form.name} onChange={(v)=>set("name", v)} testId="stage-new-name" />
              <SelectField label="Struktur-Typ" value={form.stage_type} onChange={setStageType} options={STAGE_TYPE_OPTIONS} />
              <div className="block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Spieltyp</div>
                <div className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white/70">{formatMatchType(form.match_type)}</div>
              </div>
              {config.showMatchSize && <Fld label="Spielgröße" type="number" value={form.match_size} onChange={(v)=>set("match_size", v)} testId="stage-new-size" />}
              {config.showMinPlayers && <Fld label="Min Spieler" type="number" value={form.min_players} onChange={(v)=>set("min_players", v)} testId="stage-new-min" />}
              {config.showQualifiers && <Fld label="Qualifizierte" type="number" value={form.qualifiers_per_match} onChange={(v)=>set("qualifiers_per_match", v)} testId="stage-new-qualifiers" />}
              <div>
                <Fld label="Spieldauer Min." type="number" min="1" value={form.duration_minutes} onChange={(v)=>set("duration_minutes", v)} placeholder={String(inheritedDuration(durationContext).minutes)} testId="stage-new-duration" />
                <DurationSource own={form.duration_minutes} inherited={inheritedDuration(durationContext)} testId="stage-new-duration-source" />
              </div>
              <SelectField label="Austragung" value={form.event_mode} onChange={(v)=>set("event_mode", v)} options={[["", "Vom Turnier erben"], ...EVENT_MODE_OPTIONS]} />
              <SelectField label="Ergebniserfassung" value={form.result_entry_mode} onChange={(v)=>set("result_entry_mode", v)} options={[["", "Vom Turnier erben"], ...RESULT_ENTRY_MODE_OPTIONS.filter(([value]) => value)]} />
              <SelectField label="Terminplanung" value={form.schedule_mode} onChange={(v)=>set("schedule_mode", v)} options={[["", "Vom Turnier erben"], ...SCHEDULE_MODE_OPTIONS.filter(([value]) => value)]} />
              {form.stage_type === "double_elimination" && <GrandFinalField value={form.grand_final} onChange={(v)=>set("grand_final", v)} testId="stage-new-grand-final" />}
              <AdvancementField value={form.advancement} minutes={form.draw_show_minutes} onChange={(v)=>set("advancement", v)} onMinutes={(v)=>set("draw_show_minutes", v)} testId="stage-new-advancement" />
              <div className="md:col-span-3 text-xs text-white/45 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                Leer lassen, wenn diese Phase die Turnier-Regeln nutzt. Overrides sind sinnvoll, wenn z.B. Gruppen online gespielt werden, das Finale aber vor Ort mit Staff-Erfassung läuft.
              </div>
              {config.showSchema ? (
                <label className="md:col-span-3 block">
                  <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Schema</div>
                  <textarea value={form.schema} onChange={(e)=>set("schema", e.target.value)} rows={8} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" data-testid="stage-new-schema" />
                </label>
              ) : (
                <div className="md:col-span-3 text-xs text-white/45 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                  Dieser Struktur-Typ braucht hier keine freie Schema-Eingabe. Für komplett freie Turnierbäume nutze einen freien Turnierbaum.
                </div>
              )}
              <div className="md:col-span-3">
                <button className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-sm">Phase speichern</button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="space-y-4">
        {stages.map((stage) => (
          <StageCard
            key={stage.id}
            tournamentId={tournamentId}
            stage={stage}
            matches={matches.filter((m) => m.stage_id === stage.id)}
            regById={regById}
            stations={stations}
            canManageStructure={canManageStructure}
            rightsForMatch={rightsForMatch}
            showSettings={showSettings}
            showMatchList={showMatchList}
            onChanged={onChanged}
            onDelete={() => removeStage(stage)}
          />
        ))}
        {stages.length === 0 && (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-10 text-center text-white/40">
            {mode === "settings" ? "Noch keine eigene Bracket-Phase." : "Noch keine Phasen. Sie entstehen mit der Format-Vorschau (Bearbeiten → Speichern & Struktur anwenden) oder mit dem Start des Check-ins."}
          </div>
        )}
      </div>
    </div>
    </DurationContext.Provider>
  );
}

// Weiterkommen je Phase (#1548, #1590): leer erbt die Turnier-Einstellung (Vorgabe: fester Baum); bei der
// Show-Auslosung dazu die Minuten bis zur Erinnerung.
function AdvancementField({ value, minutes = "", onChange, onMinutes, testId }) {
  return (
    <div className="block md:col-span-3">
      <SelectField label="Weiterkommen (Gegner der nächsten Runde)" value={value} onChange={onChange} options={STAGE_ADVANCEMENT_OPTIONS} testId={testId} />
      {value ? <div className="text-[11px] text-white/40 mt-1.5" data-testid={`${testId}-hint`}>{advancementModeHint(value)}</div> : null}
      {value === "draw_show" ? (
        <div className="mt-2 max-w-xs">
          <Fld label="Show-Auslosung: Erinnerung nach Minuten" type="number" min="1" max="240" value={minutes} onChange={onMinutes} placeholder={String(DRAW_SHOW_MINUTES_DEFAULT)} testId={`${testId}-minutes`} />
          <div className="text-[11px] text-white/40 mt-1">{DRAW_SHOW_MINUTES_HINT}</div>
        </div>
      ) : null}
    </div>
  );
}

// Grand Final je Phase (#1549): leer erbt die Turnier-Einstellung (Vorgabe: mit Reset-Spiel).
function GrandFinalField({ value, onChange, testId }) {
  return (
    <div className="block md:col-span-3">
      <SelectField label="Grand Final" value={value} onChange={onChange} options={[["", "Vom Turnier erben"], ...GRAND_FINAL_OPTIONS]} testId={testId} />
      <div className="text-[11px] text-white/40 mt-1.5">{GRAND_FINAL_HINT}</div>
    </div>
  );
}

function StageCard({ tournamentId, stage, matches, regById, stations = [], canManageStructure = false, rightsForMatch = NO_MATCH_RIGHTS, showSettings = false, showMatchList = true, onChanged, onDelete }) {
  const settings = stage.settings || {};
  const durationContext = useContext(DurationContext);
  const [activeSection, setActiveSection] = useState("all");
  const [form, setForm] = useState({
    name: stage.name || "",
    match_type: stage.match_type || "ffa",
    stage_type: stage.stage_type || "ffa_custom_bracket",
    status: stage.status || "pending",
    match_size: settings.match_size || 4,
    min_players: settings.min_players || 2,
    qualifiers_per_match: settings.qualifiers_per_match || 2,
    duration_minutes: ownDurationInput(settings.duration_minutes),
    event_mode: settings.event_mode || "",
    result_entry_mode: settings.result_entry_mode || "",
    schedule_mode: settings.schedule_mode || "",
    grand_final: settings.grand_final || "",
    advancement: stageAdvancementValue(settings),
    draw_show_minutes: settings.draw_show_minutes ?? "",
    schema: settings.schema || "",
  });
  const confirm = useConfirm();
  const config = stageConfigFor(form);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const setStageType = (stageType) => setForm((current) => applyStageType(current, stageType));
  const stagePayload = () => ({
    name: form.name || "Phase",
    match_type: form.match_type,
    stage_type: form.stage_type,
    status: form.status,
    settings: {
      ...settings,
      match_size: Number(form.match_size) || 4,
      min_players: Number(form.min_players) || 2,
      qualifiers_per_match: Number(form.qualifiers_per_match) || 1,
      duration_minutes: ownDurationPayload(form.duration_minutes),
      event_mode: form.event_mode || null,
      result_entry_mode: form.result_entry_mode || null,
      schedule_mode: form.schedule_mode || null,
      grand_final: form.grand_final || null,
      ...stageAdvancementSettings(form.advancement),
      draw_show_minutes: form.advancement === "draw_show" ? drawShowMinutesPayload(form.draw_show_minutes) : null,
      schema: form.schema || "",
      score_type: settings.score_type || "points",
      calculation: settings.calculation || "points",
    },
  });
  const save = async () => {
    try {
      await api.patch(`/tournaments/${tournamentId}/stages/${stage.id}`, stagePayload());
      toast.success("Phase gespeichert.");
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Phase konnte nicht gespeichert werden."));
    }
  };
  const saveAndGeneratePreview = async () => {
    if (!config.canGenerate) {
      toast.error("Für diesen Struktur-Typ ist aktuell noch kein automatischer Generator aktiv.");
      return;
    }
    try {
      await api.patch(`/tournaments/${tournamentId}/stages/${stage.id}`, stagePayload());
      const { data } = await api.post(`/tournaments/${tournamentId}/stages/${stage.id}/generate?preview=true&force=true`);
      toast.success(`Phase gespeichert und ${data.match_count} Vorschau-Spiele neu gebaut.`);
      onChanged();
    } catch (err) {
      toast.error(formatRequestError(err, "Phase konnte nicht gespeichert und neu gebaut werden."));
    }
  };
  const generate = async ({ preview = false, force = false } = {}) => {
    if (!config.canGenerate) {
      toast.error("Für diesen Struktur-Typ ist aktuell noch kein automatischer Generator aktiv.");
      return;
    }
    try {
      const params = new URLSearchParams();
      if (force) params.set("force", "true");
      if (preview) params.set("preview", "true");
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const { data } = await api.post(`/tournaments/${tournamentId}/stages/${stage.id}/generate${suffix}`);
      toast.success(data.preview ? `${data.match_count} Vorschau-Spiele generiert.` : `${data.match_count} Spiele mit Teilnehmern generiert.`);
      onChanged();
    } catch (err) {
      if (err.response?.status === 409 && !force) {
        const ok = await confirm({
          title: "Phase neu generieren?",
          description: "Vorhandene Spiele und Berichte dieser Phase werden ersetzt.",
          confirmLabel: "Neu generieren",
          tone: "danger",
        });
        if (ok) return generate({ preview, force: true });
      }
      toast.error(formatRequestError(err, "Phase konnte nicht generiert werden."));
    }
  };
  const statusCounts = matches.reduce((acc, m) => {
    acc[m.status || "pending"] = (acc[m.status || "pending"] || 0) + 1;
    return acc;
  }, {});
  const sortedMatches = [...matches].sort(sortMatchesForPlan);
  const sectionGroups = sortedMatches.reduce((acc, match) => {
    const key = matchSectionKey(match);
    if (!acc[key]) acc[key] = [];
    acc[key].push(match);
    return acc;
  }, {});
  const sectionTabs = Object.keys(sectionGroups)
    .sort((a, b) => sectionSortIndex(a) - sectionSortIndex(b) || String(a).localeCompare(String(b)))
    .map((key) => ({ key, label: formatBracketSection(key), count: sectionGroups[key].length }));
  const hasActiveSection = activeSection === "all" || sectionTabs.some((tab) => tab.key === activeSection);
  useEffect(() => {
    if (!hasActiveSection) {
      setActiveSection("all");
    }
  }, [hasActiveSection]);
  const visibleMatches = activeSection === "all" ? sortedMatches : (sectionGroups[activeSection] || []);

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
      <div className="p-5 border-b border-white/10 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">Phase #{stage.number || "—"}</div>
          <h2 className="font-heading text-xl font-bold uppercase mt-1">{stage.name}</h2>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/50">
            <span>{formatMatchType(stage.match_type)}</span>
            <span>·</span>
            <span>{formatStageType(stage.stage_type)}</span>
            <span>·</span>
            <span>{matches.length} Spiele</span>
            {settings.event_mode && <span>· {modeLabel(EVENT_MODE_OPTIONS, settings.event_mode)}</span>}
            {settings.result_entry_mode && <span>· {modeLabel(RESULT_ENTRY_MODE_OPTIONS, settings.result_entry_mode)}</span>}
            {settings.schedule_mode && <span>· {modeLabel(SCHEDULE_MODE_OPTIONS, settings.schedule_mode)}</span>}
            {matches.some((m) => m.is_preview) && <span>· Vorschau / Draft</span>}
            {Object.entries(statusCounts).map(([status, count]) => <span key={status}>· {count} {formatMatchStatus(status)}</span>)}
          </div>
        </div>
        {(canManageStructure || showSettings) && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => generate({ preview: true })} disabled={!config.canGenerate} className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm uppercase tracking-wider text-xs font-bold disabled:opacity-40">Vorschau</button>
            <button type="button" onClick={() => generate({ preview: false })} disabled={!config.canGenerate} className="px-3 py-2 bg-[#29B6E8] text-black rounded-sm uppercase tracking-wider text-xs font-bold disabled:opacity-40">Mit Teilnehmern generieren</button>
            {showSettings && <button type="button" onClick={save} data-testid={`stage-save-${stage.id}`} className="px-3 py-2 border border-white/20 text-white rounded-sm uppercase tracking-wider text-xs font-bold">Speichern</button>}
            {showSettings && <button type="button" onClick={saveAndGeneratePreview} disabled={!config.canGenerate} className="px-3 py-2 border border-[#FFD700]/50 text-[#FFD700] rounded-sm uppercase tracking-wider text-xs font-bold disabled:opacity-40">Speichern & neu bauen</button>}
            {showSettings && <button type="button" onClick={onDelete} className="px-3 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm uppercase tracking-wider text-xs font-bold">Löschen</button>}
          </div>
        )}
      </div>
      <div className={`${showSettings && showMatchList ? "grid lg:grid-cols-2 gap-5" : "space-y-3"} p-5`}>
        {showSettings && (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <Fld label="Name" value={form.name} onChange={(v)=>set("name", v)} testId={`stage-name-${stage.id}`} />
              <SelectField label="Status" value={form.status} onChange={(v)=>set("status", v)} options={STAGE_STATUS_OPTIONS} />
              <SelectField label="Struktur-Typ" value={form.stage_type} onChange={setStageType} options={STAGE_TYPE_OPTIONS} />
              <div className="block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Spieltyp</div>
                <div className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-white/70">{formatMatchType(form.match_type)}</div>
              </div>
              {config.showMatchSize && <Fld label="Spielgröße" type="number" value={form.match_size} onChange={(v)=>set("match_size", v)} testId={`stage-size-${stage.id}`} />}
              {config.showMinPlayers && <Fld label="Min Spieler" type="number" value={form.min_players} onChange={(v)=>set("min_players", v)} testId={`stage-min-${stage.id}`} />}
              {config.showQualifiers && <Fld label="Qualifizierte" type="number" value={form.qualifiers_per_match} onChange={(v)=>set("qualifiers_per_match", v)} testId={`stage-qualifiers-${stage.id}`} />}
              <div>
                <Fld label="Spieldauer Min." type="number" min="1" value={form.duration_minutes} onChange={(v)=>set("duration_minutes", v)} placeholder={String(inheritedDuration(durationContext).minutes)} testId={`stage-duration-${stage.id}`} />
                <DurationSource own={form.duration_minutes} inherited={inheritedDuration(durationContext)} testId={`stage-duration-source-${stage.id}`} />
              </div>
              <SelectField label="Austragung" value={form.event_mode} onChange={(v)=>set("event_mode", v)} options={[["", "Vom Turnier erben"], ...EVENT_MODE_OPTIONS]} />
              <SelectField label="Ergebniserfassung" value={form.result_entry_mode} onChange={(v)=>set("result_entry_mode", v)} options={[["", "Vom Turnier erben"], ...RESULT_ENTRY_MODE_OPTIONS.filter(([value]) => value)]} />
              <SelectField label="Terminplanung" value={form.schedule_mode} onChange={(v)=>set("schedule_mode", v)} options={[["", "Vom Turnier erben"], ...SCHEDULE_MODE_OPTIONS.filter(([value]) => value)]} />
              {form.stage_type === "double_elimination" && <GrandFinalField value={form.grand_final} onChange={(v)=>set("grand_final", v)} testId={`stage-grand-final-${stage.id}`} />}
              <AdvancementField value={form.advancement} minutes={form.draw_show_minutes} onChange={(v)=>set("advancement", v)} onMinutes={(v)=>set("draw_show_minutes", v)} testId={`stage-advancement-${stage.id}`} />
            </div>
            <div className="text-xs text-white/45 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
              Leer bedeutet: diese Phase erbt die Turnier-Regeln. Overrides gelten für Match-Hub, Terminabstimmung und Ergebnisfluss dieser Phase.
            </div>
            {config.showSchema ? (
              <label className="block">
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Schema</div>
                <textarea value={form.schema} onChange={(e)=>set("schema", e.target.value)} rows={12} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" data-testid={`stage-schema-${stage.id}`} />
              </label>
            ) : (
              <div className="text-xs text-white/45 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                Für diesen Struktur-Typ sind keine freien Schema-Felder nötig. Nutze eine freie Turnierbaum-Struktur, wenn du den Baum komplett selbst definieren willst.
              </div>
            )}
          </div>
        )}
        {showMatchList && (
          <div className="space-y-3">
            {/* Gegner mischen (#1548): Auslosungen dieser Phase und „Neu auslosen“ mit dem Aufbau-Recht. */}
            {canManageStructure && <DrawControls tournamentId={tournamentId} stage={stage} matches={matches} onChanged={onChanged} />}
            {sectionTabs.length > 1 && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActiveSection("all")}
                  className={`px-3 py-2 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${activeSection === "all" ? "border-[#29B6E8] bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/55 hover:text-white"}`}
                >
                  Alle <span className="ml-1 text-white/40">{sortedMatches.length}</span>
                </button>
                {sectionTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveSection(tab.key)}
                    className={`px-3 py-2 rounded-sm border text-[10px] font-bold uppercase tracking-wider ${activeSection === tab.key ? "border-[#29B6E8] bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/55 hover:text-white"}`}
                  >
                    {tab.label} <span className="ml-1 text-white/40">{tab.count}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3 items-start">
              {visibleMatches.map((match) => (
                <MatchV2Card
                  key={match.id}
                  match={match}
                  regById={regById}
                  stations={stations}
                  canRecordResults={rightsForMatch(match).results}
                  onChanged={onChanged}
                />
              ))}
              {visibleMatches.length === 0 && (
                <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-8 text-center text-white/40">
                  Keine Spiele generiert.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchV2Card({ match, regById, stations = [], canRecordResults = false, onChanged }) {
  // Das eine Ergebnis-Fenster (#1370): dieselben Felder, Wörter und dasselbe „Rückgängig“ wie in Turnierleitung,
  // Stationen und Matchseite.
  const [resultOpen, setResultOpen] = useState(false);
  const undo = useResultUndo({ onDone: onChanged });
  const filledSlots = (match.slots || []).filter((slot) => slot.status === "filled" && slot.registration_id);
  const labelFor = (registrationId) => {
    const reg = regById[registrationId];
    return reg?.display_name || reg?.ingame_name || reg?.user?.display_name || registrationId || "Offen";
  };
  return (
    <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/40">{formatBracketSection(match.section)} · {match.round_name}</div>
          <div className="font-heading font-bold uppercase">{match.match_key}</div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-white/45">
            {match.scheduled_at ? formatDateTime(match.scheduled_at) : "Termin offen"}
            {stationDisplay(match, stations) ? <span className="text-[#29B6E8]"> - Station {stationDisplay(match, stations)}</span> : null}
          </div>
          <a href={`/matches/${match.id}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex text-[10px] uppercase tracking-wider font-bold text-[#29B6E8] hover:underline">Öffentliche Matchseite</a>
        </div>
        <StatusBadge status={match.status || "pending"} />
      </div>
      <div className="mt-3 grid sm:grid-cols-2 gap-2">
        {(match.slots || []).map((slot) => (
          <div key={slot.slot} className={`px-3 py-2 rounded-sm border text-sm ${slot.status === "filled" ? "border-[#29B6E8]/30 bg-[#29B6E8]/5" : "border-white/10 bg-[#121212]"}`}>
            <span className="text-white/40 mr-2">#{slot.slot}</span>{slot.registration_id ? labelFor(slot.registration_id) : (slot.source?.draw ? sourceLabel(slot.source) : slot.source?.raw) || "Offen"}
          </div>
        ))}
      </div>
      {match.results?.length > 0 && (
        <div className="mt-3 grid sm:grid-cols-2 gap-2 text-xs">
          {match.results.map((result) => (
            <div key={result.registration_id} className="flex items-center justify-between bg-[#121212] border border-white/10 px-3 py-2 rounded-sm">
              <span>{result.rank}. {labelFor(result.registration_id)}</span>
              <span className="font-display text-white/70">{result.forfeit ? "Nicht erschienen" : result.dnf ? "Aufgegeben" : result.score ?? result.points ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
      {canRecordResults && filledSlots.length > 1 && (
        <div className="mt-4 border-t border-white/10 pt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setResultOpen(true)} className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm text-[10px] font-bold uppercase" data-testid={`matchplan-result-${match.id}`}>
            {(match.results || []).length ? "Ergebnis korrigieren" : "Ergebnis eintragen"}
          </button>
        </div>
      )}
      {resultOpen ? <ResultWindowLoader matchId={match.id} onClose={() => setResultOpen(false)} onSaved={undo.start} /> : null}
      <ResultUndoBar undo={undo} />
    </div>
  );
}

