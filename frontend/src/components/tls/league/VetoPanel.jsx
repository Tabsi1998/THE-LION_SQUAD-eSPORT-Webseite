// Map-Veto auf der Matchseite (#1618, docs/LIGA.md D.3; live D.4, #1651) im Check-in-Block: wer am Zug ist, der Countdown nach der
// Serverzeit, der Ablauf als Zeitleiste, das Brett aus Map-Karten (eigene Seite am Zug: antippen sperrt bzw. wählt), der Verlauf und am
// Ende die Spielreihenfolge. Die Liga-Leitung pausiert, setzt fort, nimmt einen Schritt zurück oder startet neu - mit Grund. Live per
// kurzem Abruf (`onPoll`, Takt aus `vetoPollMs`, im Hintergrund-Tab nie); `readOnly`: dieselbe Ansicht für Zuschauer, ohne Knöpfe.
import { useState } from "react";
import { Check, ListOrdered, Monitor, Pause, Pin, Play, RotateCcw, ShieldAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { LazyImg } from "@/components/tls/LazyImg";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { useVetoPolling } from "@/hooks/useVetoPolling";
import { api } from "@/lib/api";
import { actionWord, historyLine, plannedRoleLabel, stepLabel, vetoHeadline, vetoText } from "@/lib/leagueVeto";
import { useFreshCards, useServerOffset, VetoBoard, VetoCountdown, VetoTimeline } from "./VetoLive";

const REASON_MIN = 5;

// Vorgabe der Woche (#2326): die Map, die die Liga-Leitung für diese Spielwoche festgelegt hat - schon vor dem Veto sichtbar,
// während des Vetos über dem Brett. Sie steht fest: niemand sperrt oder wählt sie.
function WeekPresets({ block }) {
  if (!block.presets?.length) return null;
  return (
    <div className="mt-4 rounded-sm border border-[#00D26A]/40 bg-[#00D26A]/5 p-3" data-testid="veto-presets">
      <h4 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#00D26A]">
        <Pin className="h-3.5 w-3.5" aria-hidden="true" /> Vorgabe der Woche{block.week ? ` · Spielwoche ${block.week}` : ""}
      </h4>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {/* Beim Aufbau hebt sich jede Karte leicht an und ihr Rahmen leuchtet einmal auf, gestaffelt wie die übrigen Map-Karten
            (`tls-veto-preset` in index.css: nur transform und opacity, mit „Bewegung reduzieren“ sofort da). */}
        {block.presets.map((row, index) => (
          <li key={row.mode} className="tls-veto-preset flex min-w-0 items-center gap-3" style={{ "--tls-i": Math.min(index, 8) }} data-testid={`veto-preset-${row.mode}`}>
            {row.map_image_url ? <LazyImg src={row.map_image_url} alt="" sizes="64px" className="h-12 w-16 shrink-0 rounded-sm object-cover" /> : <span className="h-12 w-16 shrink-0 rounded-sm bg-white/5" />}
            <span className="min-w-0">
              <span className="block truncate font-bold text-white">{row.map_name}</span>
              <span className="flex items-center gap-1 text-xs text-white/60"><ModeIcon src={row.mode_icon_url} size="xs" /> {row.mode_label} · Map {row.position}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/55">Von der Liga-Leitung festgelegt – nicht sperrbar und nicht wählbar.</p>
    </div>
  );
}

// „Bereit zum Veto“ (#2326, Nr. 124 und 127): Die Liga-Leitung hat die fehlende Vorgabe nachgetragen. Das Veto beginnt nicht von
// selbst - sonst liefe die Zeit, während niemand mehr da ist -, sondern erst, wenn Captain oder Vertreter **beider** Seiten „Bereit zum
// Veto“ getippt haben. Die Seite zeigt, wer schon bereit ist; die erste Seite kann zurücknehmen, solange die andere fehlt. Bis zum
// Start läuft keine Frist.
function ReadyToStart({ block, matchId, busy, run, onChanged }) {
  const start = block.start;
  const send = (ready) => run(async () => {
    const { data } = await api.post(`/matches/${matchId}/veto/ready`, { ready });
    toast.success(data?.started ? "Beide Seiten sind bereit – das Veto läuft." : ready ? "Ihr seid bereit – jetzt fehlt die Gegenseite." : "„Bereit“ zurückgenommen.");
    await onChanged();
  }, ready ? "„Bereit zum Veto“ hat nicht geklappt." : "Zurücknehmen hat nicht geklappt.");
  return (
    <div className="mt-4 rounded-sm border border-[#29B6E8]/40 bg-[#29B6E8]/5 p-4" data-testid="veto-ready">
      <ul className="grid gap-2 sm:grid-cols-2" aria-label="Bereit zum Veto">
        {(start.sides || []).map((side) => (
          <li key={side.registration_id} data-testid={`veto-ready-side-${side.registration_id}`} data-ready={side.ready ? "true" : "false"}
            className={`flex min-w-0 items-center justify-between gap-3 rounded-sm border px-3 py-2 text-sm ${side.ready ? "border-[#00D26A]/50 bg-[#00D26A]/10 text-white" : "border-white/10 bg-white/[0.03] text-white/75"}`}>
            <span className="min-w-0 font-bold [overflow-wrap:anywhere]">{side.name}{side.own ? <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">Ihr</span> : null}</span>
            <span className={`inline-flex shrink-0 items-center gap-1 text-xs font-bold ${side.ready ? "text-[#00D26A]" : "text-white/50"}`}>
              {side.ready ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}{side.ready ? "bereit" : "noch nicht bereit"}
            </span>
          </li>
        ))}
      </ul>
      {start.can_ready ? (
        <button type="button" disabled={busy} onClick={() => send(true)} data-testid="veto-ready-button"
          className="tls-btn tls-btn--primary mt-3 inline-flex min-h-12 items-center gap-2 rounded-sm px-5 py-3 text-sm font-bold uppercase tracking-wider disabled:opacity-50">
          <Play className="h-4 w-4" aria-hidden="true" /> Bereit zum Veto
        </button>
      ) : null}
      {start.can_withdraw ? (
        <button type="button" disabled={busy} onClick={() => send(false)} data-testid="veto-ready-withdraw"
          className="tls-btn tls-btn--quiet mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Doch nicht bereit
        </button>
      ) : null}
      <p className="mt-2 text-xs text-white/60" data-testid="veto-ready-note">
        {/* Die Vorgabe fehlt wieder, obwohl schon jemand bereit ist: Das Veto beginnt von selbst, sobald sie steht und beide bereit sind. */}
        {block.blocked ? "Die Vorgabe der Woche fehlt gerade wieder. Sobald die Liga-Leitung sie eingetragen hat und beide Seiten bereit sind, beginnt das Veto von selbst – bis dahin gibt es keine Frist."
          : `Das Veto beginnt, sobald beide Seiten bereit sind. Erst dann läuft die Zeit${block.step_seconds ? ` (${block.step_seconds} Sekunden je Schritt)` : ""} – bis dahin gibt es keine Frist.`}
      </p>
    </div>
  );
}

// Notfall (Nr. 127): Die Liga-Leitung startet das wartende Veto, ohne dass beide Seiten „Bereit“ getippt haben - nur mit Grund, im
// Protokoll; im eigenen Spiel als Superadmin nur mit zweitem Grund (Befangenheit).
function LeadStart({ block, matchId, busy, run, onChanged }) {
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [problem, setProblem] = useState("");
  const lead = block.start?.lead;
  if (!lead?.can_start) return null;
  const needsConflictReason = Boolean(lead.conflict?.override);
  const start = () => {
    if (reason.trim().length < REASON_MIN) return setProblem("Bitte einen Grund angeben (mindestens fünf Zeichen).");
    if (needsConflictReason && conflictReason.trim().length < REASON_MIN) return setProblem("Als Notausnahme braucht es einen Grund (mindestens fünf Zeichen).");
    setProblem("");
    return run(async () => {
      await api.post(`/matches/${matchId}/veto/start`, { reason: reason.trim(), ...(needsConflictReason ? { conflict_reason: conflictReason.trim() } : {}) });
      toast.success("Veto gestartet – steht im Protokoll.");
      setReason("");
      await onChanged();
    }, "Starten hat nicht geklappt.");
  };
  return (
    <div className="mt-4 rounded-sm border border-honor/30 bg-honor/5 p-4" data-testid="veto-lead-start">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-honor"><ShieldAlert className="h-4 w-4" aria-hidden="true" /> Notfall: Veto starten (Liga-Leitung)</h3>
      <p className="mt-1 text-xs text-white/60">Nur, wenn eine Seite nicht selbst „Bereit“ tippen kann. Ab dem Start läuft die Zeit je Schritt; der Grund steht im Protokoll.</p>
      {needsConflictReason ? <p className="mt-2 text-xs text-warn" data-testid="veto-lead-start-conflict">Du bist an diesem Spiel selbst beteiligt – als Superadmin nur als Notausnahme mit Grund.</p> : null}
      <label className="mt-3 block text-xs text-white/60">
        Grund (Pflicht)
        <input value={reason} maxLength={500} onChange={(event) => { setReason(event.target.value); setProblem(""); }} className="input mt-1 w-full" placeholder="z. B. Captain ohne Netz, per Telefon bereit" data-testid="veto-lead-start-reason" />
      </label>
      {needsConflictReason ? (
        <label className="mt-3 block text-xs text-white/60">
          Grund für die Notausnahme
          <input value={conflictReason} maxLength={500} onChange={(event) => setConflictReason(event.target.value)} className="input mt-1 w-full" data-testid="veto-lead-start-conflict-reason" />
        </label>
      ) : null}
      <button type="button" disabled={busy} onClick={start} data-testid="veto-lead-start-button"
        className="tls-btn tls-btn--quiet mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
        <Play className="h-3.5 w-3.5" aria-hidden="true" /> Veto jetzt starten
      </button>
      {problem ? <p className="mt-2 text-xs text-warn" role="alert" data-testid="veto-lead-start-problem">{problem}</p> : null}
    </div>
  );
}

/** Die eigene Seite ist am Zug: die Frage und - ist eine Map ausgegraut - warum. Die Auswahl selbst sind die Karten im Brett darunter. */
function OwnTurn({ block }) {
  if (!block.can_pick || !block.current) return null;
  return (
    <div className="mt-4 rounded-sm border border-[#29B6E8]/40 bg-[#29B6E8]/5 px-4 py-3" data-testid="veto-own">
      <h3 className="text-xs font-bold uppercase tracking-widest text-[#29B6E8]">
        {block.current.kind === "ban" ? `Welche Map sperrt ihr (${block.current.mode_label})?` : `Welche Map spielt ihr als Map ${block.current.position} (${block.current.mode_label})?`}
      </h3>
      <p className="mt-1 text-xs text-white/65">Tippt unten im Kasten {block.current.mode_label} eine Map an – {block.current.kind === "ban" ? "sie ist dann gesperrt" : "sie wird gespielt"}.</p>
      {block.options.some((option) => !option.allowed) ? (
        <p className="mt-1 text-xs text-white/55" data-testid="veto-options-hint">
          {block.presets?.length ? "Ausgegraute Maps sind gesperrt, schon gewählt, als Vorgabe der Woche fest oder ließen die Serie nicht mehr aufgehen."
            : "Ausgegraute Maps sind gesperrt, schon gewählt oder ließen die Serie nicht mehr aufgehen."}
        </p>
      ) : null}
    </div>
  );
}

function LeadControls({ block, matchId, busy, run, onChanged }) {
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [problem, setProblem] = useState("");
  if (!block.lead?.can_act) return null;
  const needsConflictReason = Boolean(block.lead.conflict?.override);
  const act = (action, label) => {
    if (reason.trim().length < REASON_MIN) return setProblem("Bitte einen Grund angeben (mindestens fünf Zeichen).");
    if (needsConflictReason && conflictReason.trim().length < REASON_MIN) return setProblem("Als Notausnahme braucht es einen Grund (mindestens fünf Zeichen).");
    setProblem("");
    return run(async () => {
      await api.post(`/matches/${matchId}/veto/lead`, { action, reason: reason.trim(), version: block.version, ...(needsConflictReason ? { conflict_reason: conflictReason.trim() } : {}) });
      toast.success(`${label} – steht im Protokoll.`);
      setReason("");
      await onChanged();
    }, `${label} hat nicht geklappt.`);
  };
  const button = (action, label, Icon, show) => (show ? (
    <button type="button" disabled={busy} onClick={() => act(action, label)} data-testid={`veto-lead-${action}`}
      className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
    </button>
  ) : null);
  return (
    <div className="mt-4 rounded-sm border border-honor/30 bg-honor/5 p-4" data-testid="veto-lead">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-honor"><ShieldAlert className="h-4 w-4" aria-hidden="true" /> Eingriff der Liga-Leitung</h3>
      <p className="mt-1 text-xs text-white/60">Nur mit Grund, alles steht im Protokoll und beide Seiten sehen es. Nach dem Start von Map 1 ändert sich nichts mehr.</p>
      {needsConflictReason ? <p className="mt-2 text-xs text-warn" data-testid="veto-lead-conflict">Du bist an diesem Spiel selbst beteiligt – als Superadmin nur als Notausnahme mit Grund.</p> : null}
      <label className="mt-3 block text-xs text-white/60">
        Grund (Pflicht)
        <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className="input mt-1 w-full" placeholder="z. B. Technische Störung bei einem Team" data-testid="veto-lead-reason" />
      </label>
      {needsConflictReason ? (
        <label className="mt-3 block text-xs text-white/60">
          Grund für die Notausnahme
          <input value={conflictReason} maxLength={500} onChange={(event) => setConflictReason(event.target.value)} className="input mt-1 w-full" data-testid="veto-lead-conflict-reason" />
        </label>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {button("pause", "Pausieren", Pause, block.status === "running")}
        {button("resume", "Fortsetzen", Play, block.status === "paused")}
        {button("undo", "Letzten Schritt zurück", Undo2, (block.history || []).length > 0)}
        {button("restart", "Neu starten", RotateCcw, (block.history || []).length > 0)}
      </div>
      {problem ? <p className="mt-2 text-xs text-warn" role="alert" data-testid="veto-lead-problem">{problem}</p> : null}
    </div>
  );
}

function PlannedGames({ games }) {
  return (
    <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="veto-planned" aria-label="Spielreihenfolge">
      {games.map((game) => (
        <li key={game.position} className="flex min-w-0 items-center gap-3 rounded-sm border border-[#00D26A]/40 bg-[#00D26A]/5 p-2" data-testid={`veto-planned-${game.position}`}>
          {game.map_image_url ? <LazyImg src={game.map_image_url} alt="" sizes="64px" className="h-12 w-16 shrink-0 rounded-sm object-cover" /> : <span className="h-12 w-16 shrink-0 rounded-sm bg-white/5" />}
          <span className="min-w-0">
            <span className="block text-[10px] font-bold uppercase tracking-widest text-[#00D26A]">Map {game.position}{plannedRoleLabel(game.role) ? ` · ${plannedRoleLabel(game.role)}` : ""}</span>
            <span className="block truncate font-bold text-white">{game.map_name}</span>
            <span className="flex items-center gap-1 text-xs text-white/60"><ModeIcon src={game.mode_icon_url} size="xs" /> {game.mode_label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function VetoPanel({ block, matchId, busy, run, onChanged, onPoll, bothIn = false, readOnly = false, tvHref = null }) {
  const live = Boolean(block && (block.status === "running" || block.status === "paused"));
  // Vorgabe der Woche fehlt (#2326): Das Veto wartet. Sind beide Seiten eingecheckt (`bothIn`), fragt die Seite weiter nach, damit es
  // ohne Neuladen beginnt, sobald die Vorgabe steht - vor dem Check-in gibt es noch nichts abzuwarten.
  const blocked = Boolean(block && block.status === "waiting" && block.blocked);
  // Die Vorgabe wurde nachgetragen: Das Veto wartet auf „Bereit zum Veto“ beider Seiten - auch dann fragt die Seite nach, damit jede
  // sieht, wenn die andere bereit ist oder das Veto beginnt.
  const startReady = Boolean(block && block.status === "waiting" && block.start);
  // Live (#1651): Countdown nach der Serverzeit, Nachfragen im Takt des Stands, Aufleuchten nur bei echten neuen Aktionen.
  const offset = useServerOffset(block?.server_now);
  useVetoPolling(block, onPoll, { bothIn, offset });
  const fresh = useFreshCards(block);
  // Vor dem Start zeigt der Block nur etwas, wenn es eine Vorgabe der Woche gibt - oder wenn sie fehlt.
  if (!block || (block.status === "waiting" && !blocked && !startReady && !block.presets?.length)) return null;
  const word = actionWord(block.current?.kind);
  const choose = readOnly ? null : (card) => run(async () => {
    const { data } = await api.post(`/matches/${matchId}/veto/pick`, { map_id: card.map_id, version: block.version });
    toast.success(data?.status === "done" ? "Veto abgeschlossen – die Spielreihenfolge steht." : `${card.name} ${block.current?.kind === "ban" ? "gesperrt" : "gewählt"}.`);
    await onChanged();
  }, `${word} hat nicht geklappt.`);
  const tone = blocked ? "border-warn/50" : startReady ? "border-[#29B6E8]/60"
    : { running: block.own_turn ? "border-[#29B6E8]/60" : "border-honor/40", paused: "border-warn/50", done: "border-[#00D26A]/50", skipped: "border-white/15" }[block.status] || "border-white/15";
  return (
    <section className={`mt-5 rounded-sm border bg-[#0A0A0A] p-4 ${tone}`} data-testid="veto-panel" data-status={block.status} data-own-turn={block.own_turn ? "true" : "false"}
      data-blocked={blocked ? "true" : "false"} data-start-ready={startReady ? "true" : "false"} data-read-only={readOnly ? "true" : "false"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">
            <span>Map-Veto · Regelwerk § 6</span>
            {tvHref && (live || block.status === "done") ? (
              <a href={tvHref} target="_blank" rel="noopener noreferrer" className="tls-hit inline-flex items-center gap-1 tracking-widest text-white/55 hover:text-white" data-testid="veto-tv-link">
                <Monitor className="h-3.5 w-3.5" aria-hidden="true" /> TV-Ansicht
              </a>
            ) : null}
          </div>
          <h3 className="mt-1 font-heading text-xl font-black uppercase" data-testid="veto-headline">{vetoHeadline(block)}</h3>
          <p className="mt-1 text-sm text-white/75" data-testid="veto-text">{vetoText(block)}</p>
          {block.current ? <p className="mt-1 text-xs text-white/55" data-testid="veto-step">{stepLabel(block.current)}</p> : null}
          {block.team_a ? (
            <p className="mt-1 text-xs text-white/45" data-testid="veto-teams">
              <span className="text-brand">Team A</span>: {block.team_a.name}{block.team_a.via === "draw" ? " (gelost)" : " (Heim)"} · <span className="text-event">Team B</span>: {block.team_b?.name}
            </p>
          ) : null}
        </div>
        {live ? <VetoCountdown block={block} offset={offset} /> : null}
      </div>
      {/* Was gerade passiert ist, für Bildschirmleser - einmal je Schritt, höflich. */}
      <p className="sr-only" aria-live="polite" data-testid="veto-announce">{live && block.history?.length ? historyLine(block.history[block.history.length - 1]) : ""}</p>
      {block.status === "paused" && block.paused ? (
        <p className="mt-3 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" data-testid="veto-paused">
          {/* Zuschauer bekommen den frei geschriebenen Grund nicht (#1651) - dann steht ihr Hinweis da, kein leeres „Pausiert – “. */}
          {block.paused.reason ? <><strong>Pausiert</strong> – {block.paused.reason}</> : (block.pick_hint || "Das Veto ist pausiert – die Liga-Leitung setzt es fort.")}
        </p>
      ) : null}
      {blocked ? (
        <p className="mt-3 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" role="status" data-testid="veto-blocked">
          Gewertet wird nichts von selbst. Sind beide Seiten eingecheckt, bekommt die Liga-Leitung einen Hinweis. Sobald die Vorgabe steht, bekommt ihr eine Nachricht – das Veto beginnt, wenn beide Seiten hier „Bereit zum Veto“ getippt haben.
        </p>
      ) : null}
      {block.status === "done" ? null : <WeekPresets block={block} />}
      {startReady && !readOnly ? <ReadyToStart block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {startReady && !readOnly ? <LeadStart block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {block.status === "skipped" ? <p className="mt-3 text-xs text-white/55" data-testid="veto-skipped">Die Maps werden beim Ergebnis eingetragen.</p> : null}
      {block.status === "done" && block.planned_games?.length ? <PlannedGames games={block.planned_games} /> : null}
      {live || block.status === "done" ? <VetoTimeline block={block} /> : null}
      {readOnly ? null : <OwnTurn block={block} />}
      {live ? <VetoBoard block={block} busy={busy} onChoose={choose} fresh={fresh} /> : null}
      {block.status === "running" && !block.can_pick && block.pick_hint ? <p className="mt-3 text-xs text-white/55" data-testid="veto-wait">{block.pick_hint} Die Seite aktualisiert sich von selbst.</p> : null}
      {readOnly ? null : <LeadControls block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} />}
      {block.history?.length ? (
        <details className="mt-4 text-xs text-white/60" open={block.status !== "done"} data-testid="veto-history">
          <summary className="cursor-pointer tls-hit inline-flex items-center gap-1.5 text-white/70"><ListOrdered className="h-3.5 w-3.5" aria-hidden="true" /> Verlauf ({block.history.length} {block.history.length === 1 ? "Schritt" : "Schritte"})</summary>
          <ol className="mt-2 space-y-1">
            {block.history.map((row) => <li key={row.index} data-testid={`veto-history-${row.index}`}>{historyLine(row)}</li>)}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
