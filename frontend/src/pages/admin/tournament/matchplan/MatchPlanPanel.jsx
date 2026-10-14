import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { buildTimeline, knownStations, scheduleDelay } from "@/lib/matchTimeline";
import { dependencyGraph } from "@/lib/matchFlow";
import { matchDurationSource } from "@/lib/matchDuration";
import { applySchedulePlan, moveMatch, requestSchedulePlan, updateMatchPlan } from "@/lib/schedulePlan";
import { matchRights } from "@/lib/tournamentRights";
import { planViewMode } from "@/lib/matchPlanMode";
import { viennaTime } from "@/lib/vienna";
import { StationTimeline } from "./StationTimeline";
import { FlowGraph } from "./FlowGraph";
import { DelayBanner, MatchEditor, OrderList, PlanNotice, PlanPreview, PlanSettings, PlanWarnings, StationAgenda } from "./MatchPlanParts";
import { LeagueWeeks, OnlineRounds } from "./MatchPlanRemote";

// Matchplan-Seite (#1557) - das Werkzeug der Turnierleitung am Turniertag. Oben die Einstellungen, darunter „Wer wartet
// auf wen“, die Zeitleiste je Station und die Reihenfolge. Gerechnet wird nur im Planer (services/match_scheduler.py):
// „Automatisch planen“ holt seine Vorschau, „Übernehmen“ schreibt sie mit Fingerabdruck; Ziehen setzt einen festen
// Termin über den bestehenden Weg. Live hält eine stille Vorschau den Verzug aktuell (Änderungsstrom über
// useLiveRefresh, dazu jede Minute, weil die Prognose mit der Uhr wandert). Online und Liga: keine Stationen.

const LIVE_STATUSES = new Set(["live", "paused"]);
const CLOCK_MS = 30_000;

function Section({ title, note, children, testId }) {
  return (
    <section className="mp-card" data-testid={testId}>
      <div className="mp-card__head">
        <h3 className="mp-card__title">{title}</h3>
        {note ? <span className="mp-card__note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function MatchPlanPanel({ tournament, matches = [], stages = [], stations = [], registrations = [], durationGame = null,
  canEditSettings = false, onChanged, now: fixedNow }) {
  const tid = tournament.id;
  const canPlan = Boolean(tournament.can_assign_stations);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  // Termin und Station je Spiel: wie der Server (PATCH /matches) - turnierweit oder für genau dieses Spiel (#1353).
  const canMoveItem = useCallback((item) => matchRights(tournament, matchById.get(item.id)).plan, [tournament, matchById]);
  const canMove = Boolean(tournament.can_plan_matches) || (tournament.staff_scopes || []).some((scope) => scope?.plan);
  const live = LIVE_STATUSES.has(tournament.status);
  const [clock, setClock] = useState(() => Date.now());
  const [background, setBackground] = useState(null);
  const [preview, setPreview] = useState(null);
  const [stale, setStale] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [deadlines, setDeadlines] = useState(null);
  const [matchdays, setMatchdays] = useState(null);
  const [planError, setPlanError] = useState("");
  const [remoteError, setRemoteError] = useState("");
  const request = useRef(0);

  useEffect(() => {
    if (fixedNow) return undefined;
    const timer = setInterval(() => setClock(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [fixedNow]);
  const now = useMemo(() => fixedNow || new Date(clock), [fixedNow, clock]);

  // Dieselbe Regel wie der Planer (lib/matchPlanMode): vor Ort nur „local“, Spielwochen nur online; „none“ ändert nichts.
  const mode = planViewMode({ tournament, stages, matches, plan: background });

  const refreshPlan = useCallback(async () => {
    if (!canPlan) return null;
    const id = request.current + 1;
    request.current = id;
    try {
      const plan = await requestSchedulePlan(tid);
      if (request.current === id) {
        setBackground(plan);
        setPlanError("");
      }
      return plan;
    } catch (error) {
      // Nicht verschlucken: ohne Antwort des Planers fehlen Konflikte, Verzug und „Automatisch planen“ - das soll man sehen.
      if (request.current === id) setPlanError(formatRequestError(error, "Der Planer ist gerade nicht erreichbar."));
      return null;
    }
  }, [canPlan, tid]);

  const refreshRemote = useCallback(async () => {
    const path = mode === "online" ? "schedule/deadlines" : mode === "league" ? "matchdays" : "";
    if (!path) return;
    try {
      const { data } = await api.get(`/tournaments/${encodeURIComponent(tid)}/${path}`);
      if (mode === "online") setDeadlines(data);
      else setMatchdays(data);
      setRemoteError("");
    } catch (error) {
      setRemoteError(formatRequestError(error, "Der Server antwortet gerade nicht."));
    }
  }, [mode, tid]);

  useEffect(() => { refreshPlan(); }, [refreshPlan]);
  useEffect(() => { refreshRemote(); }, [refreshRemote]);
  useLiveRefresh(refreshPlan, ["matches", "stations", "tournaments"], { enabled: canPlan, pollMs: live ? 60_000 : 0 });
  useLiveRefresh(refreshRemote, ["matches", "tournaments"], { enabled: mode !== "local", pollMs: live ? 60_000 : 0 });

  const duration = useMemo(() => matchDurationSource({}, { stage: stages[0], tournament, game: durationGame }), [stages, tournament, durationGame]);
  // Ohne Vorschau steht der gespeicherte Plan da; vom Planer kommen nur seine Warnungen dazu. Live steht seine Prognose
  // da (der Rest ist nachgerückt, oben der Verzug) - als Prognose, nicht als Änderung; geschrieben wird erst mit
  // „Automatisch planen“ und „Übernehmen“.
  const shownPlan = useMemo(() => {
    if (preview) return preview;
    if (!background) return null;
    const assignments = live ? (background.assignments || []).map((row) => ({ ...row, changed: false })) : [];
    return { assignments, warnings: background.warnings || [], stations: background.stations };
  }, [preview, background, live]);
  // Eine Wahrheit für Kopf, Zeitleiste und Auswahl: die Stationen des Turniers und die, die der Planer kennt (Event).
  const allStations = useMemo(() => knownStations(stations, background), [stations, background]);
  const timeline = useMemo(() => buildTimeline({
    matches, stations, stages, tournament, game: durationGame, registrations, plan: shownPlan, now,
  }), [matches, stations, stages, tournament, durationGame, registrations, shownPlan, now]);
  const graph = useMemo(() => dependencyGraph(matches), [matches]);
  const itemsById = useMemo(() => Object.fromEntries([...timeline.items, ...timeline.unscheduled].map((item) => [item.id, item])), [timeline]);
  const laneNames = useMemo(() => Object.fromEntries(timeline.lanes.map((lane) => [lane.id, lane.name])), [timeline]);
  const delay = live && !preview ? scheduleDelay(background) : null;

  const startPreview = async () => {
    setBusy(true);
    setStale("");
    try {
      const plan = await requestSchedulePlan(tid);
      if (plan.mode === "none") toast.message(plan.reason || "Nichts zu planen.");
      else setPreview(plan);
    } catch (error) {
      toast.error(formatRequestError(error, "Spielplan konnte nicht berechnet werden."));
    }
    setBusy(false);
  };

  const apply = async () => {
    if (!preview) return;
    setBusy(true);
    const result = await applySchedulePlan(tid, preview);
    if (result.ok) {
      toast.success(`${result.written} ${result.written === 1 ? "Spiel" : "Spiele"} geplant.`);
      setPreview(null);
      setStale("");
      await onChanged?.();
      refreshPlan();
    } else if (result.stale) {
      setStale(result.message);
      try { setPreview(await requestSchedulePlan(tid)); } catch { setPreview(null); }
    } else {
      toast.error(result.message);
    }
    setBusy(false);
  };

  const move = async (item, next) => {
    const result = await moveMatch(item.id, { start: next.start, stationId: next.laneId });
    if (result.ok) {
      setPreview(null);
      await onChanged?.();
      refreshPlan();
    }
    return result;
  };

  const saveMatch = async (item, body) => {
    const result = await updateMatchPlan(item.id, body);
    if (result.ok) {
      toast.success(`${item.key} gespeichert.`);
      setPreview(null);
      await onChanged?.();
      refreshPlan();
    }
    return result;
  };

  const editor = (item, close, { withStation = true } = {}) => {
    const match = matchById.get(item.id);
    return (
      <MatchEditor item={item} match={match} stations={allStations} stage={stages.find((stage) => stage.id === match?.stage_id) || null}
        tournament={tournament} game={durationGame} onSave={saveMatch} onClose={close} withStation={withStation} />
    );
  };
  // Online und Liga: ohne Station, nur Start und Dauer - mit denselben Rechten je Spiel.
  const remoteEditor = (match, close) => editor({ id: match.id, key: match.match_key || "Spiel" }, close, { withStation: false });
  const canEditMatch = (match) => Boolean(match) && !match.is_preview && matchRights(tournament, match).plan;

  const release = async (item) => {
    const result = await moveMatch(item.id, { release: true });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`${item.key}: fester Termin gelöst - der Planer plant das Spiel wieder.`);
    await onChanged?.();
    refreshPlan();
  };

  const saveSettings = async (body) => {
    try {
      await api.patch(`/tournaments/${encodeURIComponent(tid)}`, body);
      toast.success("Einstellungen gespeichert.");
      await onChanged?.();
      refreshPlan();
    } catch (error) {
      toast.error(formatRequestError(error, "Einstellungen konnten nicht gespeichert werden."));
    }
  };

  const planButton = mode === "local" && canPlan ? (
    <button type="button" className="tls-btn tls-btn--primary mp-btn" onClick={startPreview} disabled={busy}>
      <Wand2 className="h-4 w-4" aria-hidden="true" /> Automatisch planen
    </button>
  ) : null;

  // Erst nach Zeit, dahinter, was noch keine Zeit hat - so steht jedes Spiel da, auch solange der Baum Vorschau ist.
  const ordered = [...timeline.items, ...timeline.unscheduled];
  const allPreview = matches.length > 0 && matches.every((match) => match.is_preview);
  let note = "";
  if (!canPlan) {
    note = "Planen und Verschieben darf, wer in diesem Turnier Stationen zuweisen darf (Turnierleitung, Schiedsrichter, Stationsleitung). Du siehst den Plan.";
  } else if (mode === "local" && allPreview) {
    note = "Der Turnierbaum ist noch eine Vorschau (bis zum Ende des Check-ins). Zeiten und Stationen plant der Planer, sobald er fix ist - die Spiele stehen unten schon da.";
  } else if (mode === "local" && background?.mode === "none" && background?.reason) {
    note = background.reason;
  }
  const summary = timeline.items.length
    ? `Ende ca. ${viennaTime(Math.max(...timeline.items.map((item) => item.end)), { hour: "2-digit", minute: "2-digit" })}`
    : "";

  return (
    <div className="mp" data-mode={mode}>
      <DelayBanner delay={delay} canPlan={canPlan} onReplan={startPreview} />
      {planError && <PlanNotice tone="error" testId="mp-plan-error">Der Planer hat nicht geantwortet: {planError} Gezeigt wird der gespeicherte Plan.</PlanNotice>}
      {note && <PlanNotice testId="mp-plan-note">{note}</PlanNotice>}
      <PlanSettings
        tournament={tournament}
        mode={mode}
        duration={duration}
        stations={allStations}
        canEdit={canEditSettings}
        onSave={saveSettings}
        actions={planButton}
      />
      {mode === "local" && (
        <>
          <PlanPreview plan={preview} stale={stale} busy={busy} onApply={apply} onDiscard={() => { setPreview(null); setStale(""); }} />
          <PlanWarnings items={timeline.items} warnings={shownPlan?.warnings} />
          <Section title="Wer wartet auf wen" note="Durchgezogen kommt weiter, gestrichelt fällt ins Loser Bracket. Gestrichelter Rahmen: Prognose." testId="mp-flow-card">
            <FlowGraph graph={graph} itemsById={itemsById} laneNames={laneNames} selectedId={selectedId} onSelect={setSelectedId} />
          </Section>
          <Section title="Zeitleiste je Station" note={[summary, timeline.unscheduled.length ? `${timeline.unscheduled.length} ohne Zeit` : ""].filter(Boolean).join(" · ")} testId="mp-timeline-card">
            {timeline.items.length || timeline.lanes.length || timeline.unscheduled.length ? (
              <>
                <div className="mp-desktop-only">
                  <StationTimeline timeline={timeline} editable={canMove} canMoveItem={canMoveItem} onMove={move} onSelect={setSelectedId} selectedId={selectedId} showNow={live} />
                </div>
                <div className="mp-mobile-only">
                  <StationAgenda timeline={timeline} canEdit={canMoveItem} onRelease={release} editor={editor} />
                </div>
              </>
            ) : (
              <p className="mp-empty">Noch keine Zeiten und keine Stationen. Lege Stationen an und tippe auf „Automatisch planen“ - die Vorschau zeigt, was der Planer vorschlägt.</p>
            )}
          </Section>
          {/* Am Handy steht dieselbe Reihenfolge schon je Station in der Liste oben. */}
          <div className="mp-desktop-only">
            <Section title="Reihenfolge und Zeiten" note="Feste Termine bleiben, bis du sie löst." testId="mp-order-card">
              <OrderList items={ordered} laneNames={laneNames} canEdit={canMoveItem} onRelease={release} editor={editor} />
            </Section>
          </div>
        </>
      )}
      {mode === "online" && <OnlineRounds tournament={tournament} matches={matches} registrations={registrations} deadlines={deadlines} error={remoteError}
        canEdit={canEditMatch} editor={remoteEditor} />}
      {mode === "league" && <LeagueWeeks tournament={tournament} matches={matches} registrations={registrations} matchdays={matchdays} error={remoteError}
        canEdit={canEditMatch} editor={remoteEditor} />}
    </div>
  );
}
