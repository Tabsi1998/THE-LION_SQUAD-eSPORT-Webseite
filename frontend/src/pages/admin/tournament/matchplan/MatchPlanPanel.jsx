import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { buildTimeline, scheduleDelay } from "@/lib/matchTimeline";
import { dependencyGraph } from "@/lib/matchFlow";
import { matchDurationSource } from "@/lib/matchDuration";
import { applySchedulePlan, moveMatch, requestSchedulePlan } from "@/lib/schedulePlan";
import { viennaTime } from "@/lib/vienna";
import { StationTimeline } from "./StationTimeline";
import { FlowGraph } from "./FlowGraph";
import { DelayBanner, OrderList, PlanPreview, PlanSettings, PlanWarnings, StationAgenda } from "./MatchPlanParts";
import { LeagueWeeks, OnlineRounds } from "./MatchPlanRemote";

// Matchplan-Seite (#1557) - das Werkzeug der Turnierleitung am Turniertag. Oben die Einstellungen, darunter „Wer wartet
// auf wen“, die Zeitleiste je Station und die Reihenfolge. Gerechnet wird nur im Planer (services/match_scheduler.py):
// „Automatisch planen“ holt seine Vorschau, „Übernehmen“ schreibt sie mit Fingerabdruck; Ziehen setzt einen festen
// Termin über den bestehenden Weg. Live hält eine stille Vorschau den Verzug aktuell (Änderungsstrom über
// useLiveRefresh, dazu jede Minute, weil die Prognose mit der Uhr wandert). Online und Liga: keine Stationen.

const LIVE_STATUSES = new Set(["live", "paused"]);
const LEAGUE_FORMATS = new Set(["league", "round_robin"]);
const CLOCK_MS = 30_000;

function fallbackMode(tournament) {
  const eventMode = tournament?.event_mode || "online";
  if (eventMode === "local" || eventMode === "hybrid") return "local";
  return LEAGUE_FORMATS.has(tournament?.format) ? "league" : "online";
}

function modeOf(plan, tournament) {
  if (plan?.mode === "matchdays") return "league";
  if (plan?.mode === "stations" || plan?.mode === "mixed") return "local";
  if (plan?.mode === "none") return fallbackMode(tournament) === "league" ? "league" : "online";
  return fallbackMode(tournament);
}

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
  const canMove = Boolean(tournament.can_plan_matches ?? tournament.can_assign_stations);
  const live = LIVE_STATUSES.has(tournament.status);
  const [clock, setClock] = useState(() => Date.now());
  const [background, setBackground] = useState(null);
  const [preview, setPreview] = useState(null);
  const [stale, setStale] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [deadlines, setDeadlines] = useState(null);
  const [matchdays, setMatchdays] = useState(null);
  const request = useRef(0);

  useEffect(() => {
    if (fixedNow) return undefined;
    const timer = setInterval(() => setClock(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [fixedNow]);
  const now = useMemo(() => fixedNow || new Date(clock), [fixedNow, clock]);

  const mode = modeOf(background, tournament);

  const refreshPlan = useCallback(async () => {
    if (!canPlan) return null;
    const id = request.current + 1;
    request.current = id;
    try {
      const plan = await requestSchedulePlan(tid);
      if (request.current === id) setBackground(plan);
      return plan;
    } catch {
      return null;
    }
  }, [canPlan, tid]);

  const refreshRemote = useCallback(async () => {
    if (mode === "online") {
      try { setDeadlines((await api.get(`/tournaments/${encodeURIComponent(tid)}/schedule/deadlines`)).data); } catch { setDeadlines(null); }
    }
    if (mode === "league") {
      try { setMatchdays((await api.get(`/tournaments/${encodeURIComponent(tid)}/matchdays`)).data); } catch { setMatchdays(null); }
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
    return { assignments, warnings: background.warnings || [] };
  }, [preview, background, live]);
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

  const ordered = [...timeline.items];
  const summary = timeline.items.length
    ? `Ende ca. ${viennaTime(Math.max(...timeline.items.map((item) => item.end)), { hour: "2-digit", minute: "2-digit" })}`
    : "";

  return (
    <div className="mp" data-mode={mode}>
      <DelayBanner delay={delay} canPlan={canPlan} onReplan={startPreview} />
      <PlanSettings
        tournament={tournament}
        mode={mode}
        duration={duration}
        stations={stations}
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
            {timeline.items.length || timeline.lanes.length ? (
              <>
                <div className="mp-desktop-only">
                  <StationTimeline timeline={timeline} editable={canMove} onMove={move} onSelect={setSelectedId} selectedId={selectedId} showNow={live} />
                </div>
                <div className="mp-mobile-only">
                  <StationAgenda timeline={timeline} canEdit={canMove} onRelease={release} />
                </div>
              </>
            ) : (
              <p className="mp-empty">Noch keine Zeiten und keine Stationen. Lege Stationen an und tippe auf „Automatisch planen“ - die Vorschau zeigt, was der Planer vorschlägt.</p>
            )}
          </Section>
          {/* Am Handy steht dieselbe Reihenfolge schon je Station in der Liste oben. */}
          <div className="mp-desktop-only">
            <Section title="Reihenfolge und Zeiten" note="Feste Termine bleiben, bis du sie löst." testId="mp-order-card">
              <OrderList items={ordered} laneNames={laneNames} canEdit={canMove} onRelease={release} />
            </Section>
          </div>
        </>
      )}
      {mode === "online" && <OnlineRounds tournament={tournament} matches={matches} registrations={registrations} deadlines={deadlines} />}
      {mode === "league" && <LeagueWeeks tournament={tournament} matches={matches} registrations={registrations} matchdays={matchdays} />}
    </div>
  );
}
