// Map-Veto auf der Matchseite (#1618, docs/LIGA.md D.3) - schlicht im Check-in-Block: wer am Zug ist, Countdown, die Maps je Modus mit
// Stand, die Wahl der eigenen Seite, der Verlauf und am Ende die Spielreihenfolge. Die Liga-Leitung pausiert, setzt fort, nimmt einen
// Schritt zurück oder startet neu - mit Grund. Kurzes Polling, solange das Veto läuft; die Live-Oberfläche mit Animationen ist D.4.
import { useEffect, useRef, useState } from "react";
import { Ban, Check, ListOrdered, Pause, Pin, Play, RotateCcw, ShieldAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { LazyImg } from "@/components/tls/LazyImg";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { api } from "@/lib/api";
import { remainingText } from "@/lib/leagueCheckin";
import { actionWord, historyLine, mapStatusText, plannedRoleLabel, stepLabel, vetoDeadline, vetoHeadline, vetoRingShare, vetoText } from "@/lib/leagueVeto";
import { motionAllowed } from "@/lib/motion";

const POLL_MS = 3000;
const RING = 100;
const REASON_MIN = 5;
const STATUS_TONE = {
  open: "border-white/10 bg-white/[0.03] text-white/85", banned: "border-live/40 bg-live/10 text-white/50 line-through",
  picked: "border-[#29B6E8]/60 bg-[#29B6E8]/10 text-white", decider: "border-honor/60 bg-honor/10 text-white",
  // Vorgabe der Woche (#2326): steht fest, bevor jemand zieht - weder sperrbar noch wählbar.
  preset: "border-[#00D26A]/60 bg-[#00D26A]/10 text-white",
  // Jede Map nur einmal je Serie: anderswo schon gewählt - gedimmt, nicht „offen“.
  elsewhere: "border-white/5 bg-white/[0.02] text-white/40 line-through",
};

function Countdown({ block }) {
  const target = vetoDeadline(block);
  const circle = useRef(null);
  const [now, setNow] = useState(() => Date.now());
  const moving = target !== null && motionAllowed();
  useEffect(() => {
    if (target === null) return undefined;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, [target]);
  useEffect(() => {
    if (!moving || !circle.current) return undefined;
    let frame = 0;
    const draw = () => {
      if (circle.current) circle.current.setAttribute("stroke-dashoffset", String(RING * (1 - vetoRingShare(block, Date.now()))));
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [moving, block]);
  if (block.status === "paused") {
    return (
      <div className="text-right" data-testid="veto-countdown" data-paused="true">
        <div className="text-[10px] uppercase tracking-widest text-white/55">Pause · Rest</div>
        <div className="font-display text-3xl font-bold tabular-nums text-white" data-testid="veto-countdown-text">{remainingText(Date.now() + (Number(block.paused?.remaining_seconds) || 0) * 1000, Date.now())}</div>
      </div>
    );
  }
  if (target === null) return null;
  return (
    <div className="flex items-center gap-3" data-testid="veto-countdown" role="timer" aria-live="off">
      <svg viewBox="0 0 80 80" width="72" height="72" className="tls-checkin-ring shrink-0" aria-hidden="true">
        <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        <circle ref={circle} cx="40" cy="40" r="34" fill="none" stroke={block.own_turn ? "#29B6E8" : "var(--tls-honor)"} strokeWidth="6" strokeLinecap="round"
          pathLength={RING} strokeDasharray={RING} strokeDashoffset={moving ? RING * (1 - vetoRingShare(block, now)) : 0} />
      </svg>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-widest text-white/55">{target <= now ? "" : "noch"}</div>
        <div className="font-display text-3xl font-bold tabular-nums text-white" data-testid="veto-countdown-text">{target <= now ? "jetzt" : remainingText(target, now)}</div>
      </div>
    </div>
  );
}

function ModeBoard({ remaining }) {
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="veto-board">
      {remaining.map((group) => (
        <li key={group.mode} className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3" data-testid={`veto-mode-${group.mode}`}>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/70">
            <ModeIcon src={group.icon_url} size="xs" /> <span className="min-w-0 [overflow-wrap:anywhere]">{group.label}</span>
          </div>
          <ul className="mt-2 space-y-1">
            {group.maps.map((row) => (
              <li key={row.map_id} className={`flex items-center justify-between gap-2 rounded-sm border px-2 py-1 text-sm ${STATUS_TONE[row.status] || STATUS_TONE.open}`}
                data-testid={`veto-map-${group.mode}-${row.map_id}`} data-status={row.status}>
                <span className="min-w-0 truncate">{row.name}</span>
                <span className="shrink-0 text-[11px] text-white/60">{mapStatusText(row)}</span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

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

function OwnTurn({ block, matchId, busy, run, onChanged }) {
  if (!block.can_pick || !block.current) return null;
  const word = actionWord(block.current.kind);
  const choose = (option) => run(async () => {
    const { data } = await api.post(`/matches/${matchId}/veto/pick`, { map_id: option.map_id, version: block.version });
    toast.success(data?.status === "done" ? "Veto abgeschlossen – die Spielreihenfolge steht." : `${option.name} ${block.current.kind === "ban" ? "gesperrt" : "gewählt"}.`);
    await onChanged();
  }, `${word} hat nicht geklappt.`);
  return (
    <div className="mt-4 rounded-sm border border-[#29B6E8]/40 bg-[#29B6E8]/5 p-4" data-testid="veto-own">
      <h3 className="text-xs font-bold uppercase tracking-widest text-[#29B6E8]">
        {block.current.kind === "ban" ? `Welche Map sperrt ihr (${block.current.mode_label})?` : `Welche Map spielt ihr als Map ${block.current.position} (${block.current.mode_label})?`}
      </h3>
      <div role="group" aria-label={`${word} ${block.current.mode_label}`} className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {block.options.map((option) => (
          <button key={option.map_id} type="button" disabled={busy || !option.allowed} onClick={() => choose(option)} title={option.hint || undefined}
            className={`tls-btn ${block.current.kind === "ban" ? "tls-btn--quiet" : "tls-btn--primary"} group relative min-h-11 min-w-0 overflow-hidden rounded-sm border border-white/15 p-0 text-left disabled:cursor-not-allowed disabled:opacity-35`}
            data-testid={`veto-option-${option.map_id}`} data-allowed={option.allowed ? "true" : "false"}>
            {option.image_url ? <LazyImg src={option.image_url} alt="" sizes="(min-width: 640px) 180px, 45vw" className="h-16 w-full object-cover opacity-80" /> : <span className="block h-10 bg-white/5" />}
            <span className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm font-bold">
              <span className="min-w-0 truncate">{option.name}</span>
              {block.current.kind === "ban" ? <Ban className="h-4 w-4 shrink-0 text-live" aria-hidden="true" /> : <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            </span>
          </button>
        ))}
      </div>
      {block.options.some((option) => !option.allowed) ? (
        <p className="mt-2 text-xs text-white/55" data-testid="veto-options-hint">
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

export function VetoPanel({ block, matchId, busy, run, onChanged, onPoll, bothIn = false }) {
  const live = block && (block.status === "running" || block.status === "paused");
  // Vorgabe der Woche fehlt (#2326): Das Veto wartet. Sind beide Seiten eingecheckt (`bothIn`), fragt die Seite weiter nach, damit es
  // ohne Neuladen beginnt, sobald die Vorgabe steht - vor dem Check-in gibt es noch nichts abzuwarten.
  const blocked = Boolean(block && block.status === "waiting" && block.blocked);
  // Die Vorgabe wurde nachgetragen: Das Veto wartet auf „Bereit zum Veto“ beider Seiten - auch dann fragt die Seite nach, damit jede
  // sieht, wenn die andere bereit ist oder das Veto beginnt.
  const startReady = Boolean(block && block.status === "waiting" && block.start);
  const polling = live || ((blocked || startReady) && bothIn);
  useEffect(() => {
    if (!polling || !onPoll) return undefined;
    const tick = window.setInterval(() => { if (typeof document === "undefined" || !document.hidden) onPoll(); }, POLL_MS);
    return () => window.clearInterval(tick);
  }, [polling, onPoll]);
  // Vor dem Start zeigt der Block nur etwas, wenn es eine Vorgabe der Woche gibt - oder wenn sie fehlt.
  if (!block || (block.status === "waiting" && !blocked && !startReady && !block.presets?.length)) return null;
  const tone = blocked ? "border-warn/50" : startReady ? "border-[#29B6E8]/60"
    : { running: block.own_turn ? "border-[#29B6E8]/60" : "border-honor/40", paused: "border-warn/50", done: "border-[#00D26A]/50", skipped: "border-white/15" }[block.status] || "border-white/15";
  return (
    <section className={`mt-5 rounded-sm border bg-[#0A0A0A] p-4 ${tone}`} data-testid="veto-panel" data-status={block.status} data-own-turn={block.own_turn ? "true" : "false"}
      data-blocked={blocked ? "true" : "false"} data-start-ready={startReady ? "true" : "false"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">Map-Veto · Regelwerk § 6</div>
          <h3 className="mt-1 font-heading text-xl font-black uppercase" data-testid="veto-headline">{vetoHeadline(block)}</h3>
          <p className="mt-1 text-sm text-white/75" data-testid="veto-text">{vetoText(block)}</p>
          {block.current ? <p className="mt-1 text-xs text-white/55" data-testid="veto-step">{stepLabel(block.current)}</p> : null}
          {block.team_a ? (
            <p className="mt-1 text-xs text-white/45" data-testid="veto-teams">Team A: {block.team_a.name}{block.team_a.via === "draw" ? " (gelost)" : " (Heim)"} · Team B: {block.team_b?.name}</p>
          ) : null}
        </div>
        {live ? <Countdown block={block} /> : null}
      </div>
      {block.status === "paused" && block.paused ? (
        <p className="mt-3 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" data-testid="veto-paused">
          <strong>Pausiert</strong> – {block.paused.reason}
        </p>
      ) : null}
      {blocked ? (
        <p className="mt-3 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" role="status" data-testid="veto-blocked">
          Gewertet wird nichts von selbst. Sind beide Seiten eingecheckt, bekommt die Liga-Leitung einen Hinweis. Sobald die Vorgabe steht, bekommt ihr eine Nachricht – das Veto beginnt, wenn beide Seiten hier „Bereit zum Veto“ getippt haben.
        </p>
      ) : null}
      {block.status === "done" ? null : <WeekPresets block={block} />}
      {startReady ? <ReadyToStart block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {startReady ? <LeadStart block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {block.status === "skipped" ? <p className="mt-3 text-xs text-white/55" data-testid="veto-skipped">Die Maps werden beim Ergebnis eingetragen.</p> : null}
      {block.status === "done" && block.planned_games?.length ? <PlannedGames games={block.planned_games} /> : null}
      {block.status === "running" || block.status === "paused" ? <ModeBoard remaining={block.remaining || []} /> : null}
      <OwnTurn block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} />
      {block.status === "running" && !block.can_pick && block.pick_hint ? <p className="mt-3 text-xs text-white/55" data-testid="veto-wait">{block.pick_hint} Die Seite aktualisiert sich von selbst.</p> : null}
      <LeadControls block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} />
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
