// Turnier-Bearbeitung (#223): Stufen, Partien, Ergebnisse und Termine – der Betriebs-Reiter.
import { useEffect, useState } from "react";
import { api, formatRequestError } from "@/lib/api";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { formatDateTime, toDateTimeLocalInput } from "@/lib/datetime";
import { toast } from "sonner";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { STAGE_TYPE_OPTIONS, STAGE_STATUS_OPTIONS, formatBracketSection, formatMatchStatus, formatMatchType, formatStageType } from "@/lib/tournamentLabels";
import { Fld } from "./PrizeEditor";
import { ResultWindowLoader } from "@/components/tls/results/ResultWindow";
import { ResultUndoBar, useResultUndo } from "@/components/tls/results/ResultUndoBar";
import { SelectField, modeLabel } from "./TournamentEditForm";
import { DEFAULT_FFA_SCHEMA, EVENT_MODE_OPTIONS, RESULT_ENTRY_MODE_OPTIONS, SCHEDULE_MODE_OPTIONS, applyStageType, matchSectionKey, sectionSortIndex, sortMatchesForPlan, stageConfigFor, stationDisplay } from "./shared";

export function TournamentStagesPanel({ tournamentId, stages, matches, registrations, stations = [], tournamentStartDate = null, isAdmin, isModerator, canRecordResults = false, onChanged, onSaveMatchMeta, mode = "operations" }) {
  const showSettings = isAdmin && mode === "settings";
  const showMatchList = mode !== "settings";
  const [createOpen, setCreateOpen] = useState(stages.length === 0);
  const [form, setForm] = useState({
    name: "Phase 1",
    match_type: "ffa",
    stage_type: "ffa_custom_bracket",
    match_size: 4,
    min_players: 2,
    qualifiers_per_match: 2,
    duration_minutes: 30,
    event_mode: "",
    result_entry_mode: "",
    schedule_mode: "",
    schema: DEFAULT_FFA_SCHEMA,
  });
  const confirm = useConfirm();
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
          duration_minutes: Number(form.duration_minutes) || 30,
          event_mode: form.event_mode || null,
          result_entry_mode: form.result_entry_mode || null,
          schedule_mode: form.schedule_mode || null,
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
    <div className="space-y-5">
      {mode === "settings" && (
        <div className="text-xs text-white/50 border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
          Erweiterte Bracket-Phasen sind nur für eigene Schemas oder Spezial-Brackets nötig. Der Matchplan-Tab bleibt für Zeiten, Ergebnisse und operative Matcharbeit.
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
              <Fld label="Spieldauer Min." type="number" value={form.duration_minutes} onChange={(v)=>set("duration_minutes", v)} testId="stage-new-duration" />
              <SelectField label="Austragung" value={form.event_mode} onChange={(v)=>set("event_mode", v)} options={[["", "Vom Turnier erben"], ...EVENT_MODE_OPTIONS]} />
              <SelectField label="Ergebniserfassung" value={form.result_entry_mode} onChange={(v)=>set("result_entry_mode", v)} options={[["", "Vom Turnier erben"], ...RESULT_ENTRY_MODE_OPTIONS.filter(([value]) => value)]} />
              <SelectField label="Terminplanung" value={form.schedule_mode} onChange={(v)=>set("schedule_mode", v)} options={[["", "Vom Turnier erben"], ...SCHEDULE_MODE_OPTIONS.filter(([value]) => value)]} />
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
            tournamentStartDate={tournamentStartDate}
            isModerator={isModerator}
            canRecordResults={canRecordResults}
            showSettings={showSettings}
            showMatchList={showMatchList}
            onChanged={onChanged}
            onDelete={() => removeStage(stage)}
            onSaveMatchMeta={onSaveMatchMeta}
          />
        ))}
        {stages.length === 0 && (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-10 text-center text-white/40">
            {mode === "settings" ? "Noch keine eigene Bracket-Phase." : "Noch keine Phasen. Sie entstehen mit der Format-Vorschau (Bearbeiten → Speichern & Struktur anwenden) oder mit dem Start des Check-ins."}
          </div>
        )}
      </div>
    </div>
  );
}

function StageCard({ tournamentId, stage, matches, regById, stations = [], tournamentStartDate = null, isModerator, canRecordResults = false, showSettings = false, showMatchList = true, onChanged, onDelete, onSaveMatchMeta }) {
  const settings = stage.settings || {};
  const [activeSection, setActiveSection] = useState("all");
  const [form, setForm] = useState({
    name: stage.name || "",
    match_type: stage.match_type || "ffa",
    stage_type: stage.stage_type || "ffa_custom_bracket",
    status: stage.status || "pending",
    match_size: settings.match_size || 4,
    min_players: settings.min_players || 2,
    qualifiers_per_match: settings.qualifiers_per_match || 2,
    duration_minutes: settings.duration_minutes || stage.duration_minutes || 30,
    event_mode: settings.event_mode || "",
    result_entry_mode: settings.result_entry_mode || "",
    schedule_mode: settings.schedule_mode || "",
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
      duration_minutes: Number(form.duration_minutes) || 30,
      event_mode: form.event_mode || null,
      result_entry_mode: form.result_entry_mode || null,
      schedule_mode: form.schedule_mode || null,
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
        {(isModerator || showSettings) && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => generate({ preview: true })} disabled={!config.canGenerate} className="px-3 py-2 border border-[#29B6E8]/50 text-[#29B6E8] rounded-sm uppercase tracking-wider text-xs font-bold disabled:opacity-40">Vorschau</button>
            <button type="button" onClick={() => generate({ preview: false })} disabled={!config.canGenerate} className="px-3 py-2 bg-[#29B6E8] text-black rounded-sm uppercase tracking-wider text-xs font-bold disabled:opacity-40">Mit Teilnehmern generieren</button>
            {showSettings && <button type="button" onClick={save} className="px-3 py-2 border border-white/20 text-white rounded-sm uppercase tracking-wider text-xs font-bold">Speichern</button>}
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
              <Fld label="Spieldauer Min." type="number" value={form.duration_minutes} onChange={(v)=>set("duration_minutes", v)} testId={`stage-duration-${stage.id}`} />
              <SelectField label="Austragung" value={form.event_mode} onChange={(v)=>set("event_mode", v)} options={[["", "Vom Turnier erben"], ...EVENT_MODE_OPTIONS]} />
              <SelectField label="Ergebniserfassung" value={form.result_entry_mode} onChange={(v)=>set("result_entry_mode", v)} options={[["", "Vom Turnier erben"], ...RESULT_ENTRY_MODE_OPTIONS.filter(([value]) => value)]} />
              <SelectField label="Terminplanung" value={form.schedule_mode} onChange={(v)=>set("schedule_mode", v)} options={[["", "Vom Turnier erben"], ...SCHEDULE_MODE_OPTIONS.filter(([value]) => value)]} />
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
                  tournamentStartDate={tournamentStartDate}
                  canEdit={isModerator}
                  canRecordResults={canRecordResults}
                  onChanged={onChanged}
                  onSaveMatchMeta={onSaveMatchMeta}
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

function MatchV2Card({ match, regById, stations = [], tournamentStartDate = null, canEdit, canRecordResults = false, onChanged, onSaveMatchMeta }) {
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
            <span className="text-white/40 mr-2">#{slot.slot}</span>{slot.registration_id ? labelFor(slot.registration_id) : slot.source?.raw || "Offen"}
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
      {canEdit && <MatchScheduleControls match={match} stations={stations} defaultScheduledAt={tournamentStartDate} onSave={onSaveMatchMeta} />}
      {canEdit && canRecordResults && filledSlots.length > 1 && (
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

function MatchScheduleControls({ match, stations = [], defaultScheduledAt = null, onSave }) {
  const plannedValue = match.scheduled_at || defaultScheduledAt;
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocalInput(plannedValue));
  const [duration, setDuration] = useState(match.duration_minutes ?? match.settings?.duration_minutes ?? "");
  const [stationId, setStationId] = useState(match.station_id || "");
  useEffect(() => {
    setScheduledAt(toDateTimeLocalInput(match.scheduled_at || defaultScheduledAt));
    setDuration(match.duration_minutes ?? match.settings?.duration_minutes ?? "");
    setStationId(match.station_id || "");
  }, [match.id, match.scheduled_at, defaultScheduledAt, match.duration_minutes, match.station_id, match.updated_at, match.settings?.duration_minutes]);
  return (
    <div className="mt-3 w-full border border-white/10 bg-[#0A0A0A] rounded-sm p-3 space-y-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Matchplanung</div>
      <div className="grid md:grid-cols-[minmax(14rem,1fr)_8rem_minmax(12rem,1fr)] gap-3">
        <label className="block">
          <span className="block text-[10px] text-white/45 mb-1">Startdatum & Uhrzeit</span>
          <input type="datetime-local" value={scheduledAt} onChange={(e)=>setScheduledAt(e.target.value)} className="w-full bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" aria-label="Startdatum und Uhrzeit" />
        </label>
        <label className="block">
          <span className="block text-[10px] text-white/45 mb-1">Dauer Min.</span>
          <input type="number" min="1" value={duration} onChange={(e)=>setDuration(e.target.value)} className="w-full bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" placeholder="z.B. 30" aria-label="Dauer in Minuten" />
        </label>
      </div>
      {stations.length > 0 && (
        <label className="block">
          <span className="block text-[10px] text-white/45 mb-1">Station</span>
          <select value={stationId} onChange={(e)=>setStationId(e.target.value)} className="w-full bg-[#121212] border border-white/10 px-2 py-1 rounded-sm text-xs" aria-label="Station">
            <option value="">Keine Station</option>
            {stations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name || station.label || station.id}{station.status && station.status !== "free" ? ` · ${station.status}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {(match.scheduled_at || match.duration_minutes || match.settings?.duration_minutes || match.station_id) && (
        <div className="text-[11px] text-white/45">
          Gespeichert: {match.scheduled_at ? formatDateTime(match.scheduled_at) : "keine Startzeit"} - Dauer {match.duration_minutes ?? match.settings?.duration_minutes ?? "offen"} Min.{stationDisplay(match, stations) ? ` - Station ${stationDisplay(match, stations)}` : ""}
        </div>
      )}
      <button type="button" onClick={() => onSave(match, { scheduled_at: scheduledAt, duration_minutes: duration, station_id: stationId })} className="w-full sm:w-auto px-4 py-2 border border-white/20 text-white/70 rounded-sm text-[10px] font-bold uppercase">Planung speichern</button>
    </div>
  );
}
