// Liga-Check-in auf der Matchseite (#1652, docs/LIGA.md D.2): geführt (#2023) - Stand und Countdown oben, beide Seiten mit
// Haken, die eigene Seite hakt ihre Anwesenden an, danach „Spiel starten“. Alles, was gerade nicht geht, steht als Satz da.
// Der Ring läuft ohne Sprünge (ein Bild je Frame, direkt ins SVG, ohne React-Durchlauf), der Haken setzt sich sanft; mit
// „Bewegung reduzieren“ steht der Ring, nur die Zahl zählt. Die Liga-Leitung trägt im Notfall für eine Seite ein.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlarmClock, Check, ClipboardCheck, Play, ScrollText, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { motionAllowed } from "@/lib/motion";
import {
  STATE_LABELS, clock, countdownLabel, countdownTarget, otherSide, ownSide, remainingText, ringShare, rulesSentences,
  selectionText, sideStatusText, stateText,
} from "@/lib/leagueCheckin";
import { VetoPanel } from "./VetoPanel";

const RING = 100;
const REASON_MIN = 5;

function CountdownRing({ block }) {
  const target = countdownTarget(block);
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
      if (circle.current) circle.current.setAttribute("stroke-dashoffset", String(RING * (1 - ringShare(block, Date.now()))));
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [moving, block]);
  if (target === null) return null;
  const done = target <= now;
  return (
    <div className="flex items-center gap-3" data-testid="checkin-countdown" role="timer" aria-live="off">
      <svg viewBox="0 0 80 80" width="72" height="72" className="tls-checkin-ring shrink-0" aria-hidden="true">
        <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="6" />
        <circle ref={circle} cx="40" cy="40" r="34" fill="none" stroke="#29B6E8" strokeWidth="6" strokeLinecap="round"
          pathLength={RING} strokeDasharray={RING} strokeDashoffset={moving ? RING * (1 - ringShare(block, now)) : 0} />
      </svg>
      <div className="text-right">
        <div className="text-[10px] uppercase tracking-widest text-white/55">{done ? "" : countdownLabel(block)}</div>
        <div className="font-display text-3xl font-bold tabular-nums text-white" data-testid="checkin-countdown-text">
          {done ? "jetzt" : remainingText(target, now)}
        </div>
      </div>
    </div>
  );
}

function SideCard({ side }) {
  return (
    <li className={`rounded-sm border p-3 ${side.checked_in ? "border-[#00D26A]/50 bg-[#00D26A]/5" : "border-white/10 bg-[#0A0A0A]"}`}
      data-testid={`checkin-side-${side.registration_id}`} data-checked={side.checked_in ? "true" : "false"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-heading text-base font-black uppercase [overflow-wrap:anywhere]">{side.name}{side.own ? <span className="ml-2 text-[10px] font-bold tracking-widest text-[#29B6E8]">ihr</span> : null}</div>
          <div className="mt-1 text-xs text-white/60" data-testid={`checkin-side-status-${side.registration_id}`}>{sideStatusText(side)}</div>
        </div>
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${side.checked_in ? "border-[#00D26A] text-[#00D26A]" : "border-white/15 text-white/30"}`} aria-hidden="true">
          {side.checked_in ? <Check className="tls-checkin-tick h-5 w-5" /> : <AlarmClock className="h-4 w-4" />}
        </span>
      </div>
      {side.present?.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Anwesend bei ${side.name}`}>
          {side.present.map((person) => (
            <li key={person.id} className="max-w-full rounded-sm border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-white/85 [overflow-wrap:anywhere]">{person.name}</li>
          ))}
        </ul>
      ) : null}
      {side.lead_reason ? <div className="mt-2 text-xs text-white/55 [overflow-wrap:anywhere]">Grund der Leitung: {side.lead_reason}</div> : null}
      {side.consent_open ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs text-white/85" data-testid={`checkin-consent-${side.registration_id}`}>
          <ScrollText className="h-3.5 w-3.5 shrink-0 text-warn" aria-hidden="true" />
          <span>Das Regelwerk hat sich geändert – {side.own ? "bitte erst zustimmen" : "diese Seite muss erst zustimmen"}.</span>
          {side.own && side.rules_url ? <Link to={side.rules_url} className="tls-hit font-bold text-[#29B6E8] underline underline-offset-2">Zur neuen Fassung</Link> : null}
        </p>
      ) : null}
    </li>
  );
}

function RosterPicker({ roster, selected, onToggle, testId, minimum }) {
  return (
    <>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2" data-testid={testId}>
        {roster.map((person) => {
          const checked = selected.includes(person.id);
          return (
            <li key={person.id}>
              <label className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-sm border px-3 py-2 text-sm ${person.blocked ? "cursor-not-allowed border-white/5 text-white/40" : checked ? "border-[#29B6E8]/60 bg-[#29B6E8]/10 text-white" : "border-white/10 text-white/80"}`}>
                <input type="checkbox" className="mt-1 accent-[#29B6E8]" checked={checked} disabled={Boolean(person.blocked)}
                  onChange={() => onToggle(person.id)} data-testid={`${testId}-${person.id}`} />
                <span className="min-w-0">
                  <span className="block [overflow-wrap:anywhere]">{person.name}</span>
                  {person.blocked ? <span className="block text-xs text-warn [overflow-wrap:anywhere]">{person.blocked}</span> : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-white/60" data-testid={`${testId}-count`}>{selectionText(selected.length, minimum)}</p>
    </>
  );
}

function OwnCheckin({ block, matchId, busy, run, onChanged, onAskLead }) {
  const own = ownSide(block);
  const [selected, setSelected] = useState(() => (own?.present || []).map((person) => person.id));
  if (!own || !["waiting", "open", "closed", "no_time"].includes(block.state)) return null;
  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const minimum = Number(block.min_present || 1);
  const enough = selected.length >= minimum;
  const submit = () => run(async () => {
    const { data } = await api.post(`/matches/${matchId}/checkin`, { present: selected });
    toast.success(data?.ready ? "Eingecheckt – beide Seiten sind da, ihr könnt starten." : own.checked_in ? "Anwesende aktualisiert." : "Eingecheckt – jetzt fehlt noch die Gegenseite.");
    await onChanged();
  }, "Einchecken hat nicht geklappt.");
  const hint = block.checkin_hint;
  const consent = own.consent_open;
  const asksLead = Boolean(hint && hint.includes("@leitung"));
  // Geht es gerade nicht, steht der Grund vor der Liste - niemand hakt erst an und sucht dann den Knopf.
  const hintBox = !block.can_checkin && hint ? (
    <p className={`mt-3 rounded-sm border px-3 py-2 text-sm text-white/80 ${consent ? "border-warn/40 bg-warn/10" : "border-white/10 bg-white/[0.03]"}`} data-testid="checkin-hint">
      {hint}{" "}
      {consent && own.rules_url ? <Link to={own.rules_url} className="tls-hit font-bold text-[#29B6E8] underline underline-offset-2" data-testid="checkin-rules-link">Zur neuen Fassung</Link> : null}
      {asksLead && onAskLead ? <button type="button" onClick={onAskLead} className="tls-btn tls-btn--quiet tls-hit ml-1 rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider">@leitung schreiben</button> : null}
    </p>
  ) : null;
  return (
    <div className="mt-5 rounded-sm border border-[#29B6E8]/30 bg-[#0A0A0A] p-4" data-testid="checkin-own">
      <h3 className="text-xs font-bold uppercase tracking-widest text-[#29B6E8]">{own.checked_in ? "Eure Anwesenden" : "Wer ist da?"}</h3>
      <p className="mt-1 text-xs text-white/60">Nur Spieler aus eurem Kader, nur wer spielen darf – wer nicht wählbar ist, steht grau mit Grund da.</p>
      {hintBox}
      <RosterPicker roster={block.roster || []} selected={selected} onToggle={toggle} testId="checkin-roster" minimum={minimum} />
      {block.can_checkin ? (
        <button type="button" disabled={busy || !enough} onClick={submit} data-testid="checkin-submit"
          className="tls-btn tls-btn--primary mt-3 inline-flex min-h-11 items-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" /> {own.checked_in ? "Anwesende aktualisieren" : "Einchecken"}
        </button>
      ) : null}
    </div>
  );
}

function StartBlock({ block, matchId, busy, run, onChanged }) {
  const [conflictReason, setConflictReason] = useState("");
  const [problem, setProblem] = useState("");
  if (!["ready", "veto"].includes(block.state)) return null;
  // Startet die Leitung (keine eigene Seite) ihr eigenes Spiel, geht das nur als Notausnahme des Superadmins mit Grund (#2203) -
  // wie beim Eintragen für eine Seite; sonst antwortet der Server 403.
  const needsConflictReason = !block.own_registration_id && Boolean(block.lead?.conflict?.override);
  const start = () => {
    if (needsConflictReason && conflictReason.trim().length < REASON_MIN) return setProblem("Als Notausnahme braucht es einen Grund (mindestens fünf Zeichen).");
    setProblem("");
    return run(async () => {
      await api.post(`/matches/${matchId}/checkin/start`, needsConflictReason ? { conflict_reason: conflictReason.trim() } : {});
      toast.success("Gestartet – Map 1 läuft. Viel Erfolg!");
      await onChanged();
    }, "Starten hat nicht geklappt.");
  };
  return (
    <div className="mt-5 rounded-sm border border-[#00D26A]/40 bg-[#00D26A]/5 p-4" data-testid="checkin-start">
      {block.can_start ? (
        <>
          {needsConflictReason ? (
            <>
              <p className="mb-3 text-xs text-warn" data-testid="checkin-start-conflict">Du bist an diesem Spiel selbst beteiligt – als Superadmin startest du nur als Notausnahme mit Grund.</p>
              <label className="mb-3 block text-xs text-white/60">
                Grund für die Notausnahme
                <input value={conflictReason} maxLength={500} onChange={(event) => setConflictReason(event.target.value)} className="input mt-1 w-full" data-testid="checkin-start-conflict-reason" />
              </label>
            </>
          ) : null}
          <button type="button" disabled={busy} onClick={start} data-testid="checkin-start-button"
            className="tls-btn tls-btn--primary inline-flex min-h-12 items-center gap-2 rounded-sm px-5 py-3 text-sm font-bold uppercase tracking-wider disabled:opacity-50">
            <Play className="h-4 w-4" aria-hidden="true" /> Spiel starten – Map 1 läuft
          </button>
          <p className="mt-2 text-xs text-white/60">Ab jetzt zählt die Spielzeit; der Termin lässt sich nicht mehr verschieben.</p>
          {problem ? <p className="mt-2 text-xs text-warn" role="alert" data-testid="checkin-start-problem">{problem}</p> : null}
        </>
      ) : (
        <p className="text-sm text-white/80" data-testid="checkin-start-hint">{block.start_hint || "Starten geht erst, wenn beide Seiten eingecheckt sind."}</p>
      )}
    </div>
  );
}

function LeadEntry({ block, matchId, busy, run, onChanged }) {
  const [sideId, setSideId] = useState(() => (block.sides || []).find((side) => !side.checked_in)?.registration_id || block.sides?.[0]?.registration_id || "");
  const [selected, setSelected] = useState([]);
  const [reason, setReason] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [problem, setProblem] = useState("");
  if (!block.lead?.can_enter) return null;
  const roster = block.lead.rosters?.[sideId] || [];
  const side = (block.sides || []).find((row) => row.registration_id === sideId);
  const minimum = Number(block.min_present || 1);
  const needsConflictReason = Boolean(block.lead.conflict?.override);
  const toggle = (id) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  const submit = async (event) => {
    event.preventDefault();
    if (selected.length < minimum) return setProblem(`Bitte mindestens ${minimum} Anwesende anhaken.`);
    if (reason.trim().length < REASON_MIN) return setProblem("Bitte einen Grund angeben (mindestens fünf Zeichen).");
    if (needsConflictReason && conflictReason.trim().length < REASON_MIN) return setProblem("Als Notausnahme braucht es einen Grund (mindestens fünf Zeichen).");
    setProblem("");
    return run(async () => {
      await api.post(`/matches/${matchId}/checkin`, {
        present: selected, registration_id: sideId, reason: reason.trim(), ...(needsConflictReason ? { conflict_reason: conflictReason.trim() } : {}),
      });
      toast.success(`${side?.name || "Seite"} eingetragen.`);
      setReason("");
      await onChanged();
    }, "Eintragen hat nicht geklappt.");
  };
  return (
    <form onSubmit={submit} className="mt-5 rounded-sm border border-honor/30 bg-honor/5 p-4" data-testid="checkin-lead" noValidate>
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-honor"><ShieldAlert className="h-4 w-4" aria-hidden="true" /> Für eine Seite eintragen (Liga-Leitung)</h3>
      <p className="mt-1 text-xs text-white/60">Notfall, etwa Captain ohne Netz – geht auch nach dem Fenster, mit Grund im Protokoll. Die Regelwerks-Zustimmung der Seite bleibt Pflicht.</p>
      {needsConflictReason ? <p className="mt-2 text-xs text-warn" data-testid="checkin-lead-conflict">Du bist an diesem Spiel selbst beteiligt – als Superadmin nur als Notausnahme mit Grund.</p> : null}
      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Seite">
        {(block.sides || []).map((row) => (
          <button key={row.registration_id} type="button" onClick={() => { setSideId(row.registration_id); setSelected([]); }} aria-pressed={row.registration_id === sideId}
            className={`tls-btn ${row.registration_id === sideId ? "tls-btn--secondary" : "tls-btn--quiet"} min-h-11 rounded-sm px-3 py-2 text-xs font-bold [overflow-wrap:anywhere]`} data-testid={`checkin-lead-side-${row.registration_id}`}>
            {row.name}{row.checked_in ? " ✓" : ""}
          </button>
        ))}
      </div>
      <RosterPicker roster={roster} selected={selected} onToggle={toggle} testId="checkin-lead-roster" minimum={minimum} />
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <label className="block text-xs text-white/60">
          Grund (Pflicht)
          <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className="input mt-1 w-full" placeholder="z. B. Captain ohne Netz, per Telefon bestätigt" data-testid="checkin-lead-reason" />
        </label>
        <button type="submit" disabled={busy} data-testid="checkin-lead-submit"
          className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          Für {side?.name || "Seite"} eintragen
        </button>
      </div>
      {needsConflictReason ? (
        <label className="mt-3 block text-xs text-white/60">
          Grund für die Notausnahme
          <input value={conflictReason} maxLength={500} onChange={(event) => setConflictReason(event.target.value)} className="input mt-1 w-full" data-testid="checkin-lead-conflict-reason" />
        </label>
      ) : null}
      {problem ? <p className="mt-2 text-xs text-warn" role="alert" data-testid="checkin-lead-problem">{problem}</p> : null}
    </form>
  );
}

export function CheckinPanel({ block, matchId, busy, run, onChanged, onAskLead, leadUrl, onPoll }) {
  if (!block) return null;
  const other = otherSide(block);
  // Veto (#1618, D.3): solange es läuft, trägt der Veto-Block die Überschrift - der Check-in-Kopf wird eine Zeile, die Seiten stehen
  // in einem Satz, der Start-Knopf kommt danach (Fabian: nur eine Überschrift „Veto läuft“).
  const vetoRunning = block.state === "veto";
  const tone = { ready: "border-[#00D26A]/50", veto: "border-[#00D26A]/50", running: "border-[#29B6E8]/50", closed: "border-warn/50" }[block.state] || "border-[#29B6E8]/35";
  return (
    <section className={`mt-6 rounded-sm border bg-[#0F1D23] p-5 ${tone}`} data-testid="checkin-panel" data-state={block.state}>
      {/* Am Handy steht der Ring unter dem Satz, am PC rechts neben der Überschrift - so bricht die Überschrift nie. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">Check-in · Regelwerk § 8</div>
          {vetoRunning ? (
            <p className="mt-1 text-sm text-white/75 [overflow-wrap:anywhere]" data-testid="checkin-slim">
              <span className="font-bold text-[#00D26A]">Beide Seiten eingecheckt</span>
              {" – "}{(block.sides || []).map((side) => `${side.name} (${Number(side.present_count || 0)} Spieler)`).join(" · ")}.
            </p>
          ) : (
            <>
              <h2 className="mt-1 font-heading text-2xl font-black uppercase" data-testid="checkin-headline">{STATE_LABELS[block.state] || "Check-in"}</h2>
              <p className="mt-1 text-sm text-white/75" data-testid="checkin-text">{stateText(block)}</p>
            </>
          )}
        </div>
        {vetoRunning ? null : <CountdownRing block={block} />}
      </div>

      {vetoRunning ? null : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2" data-testid="checkin-sides">
          {(block.sides || []).map((side) => <SideCard key={side.registration_id} side={side} />)}
        </ul>
      )}

      {block.proposal ? (
        <p className="mt-4 rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white/85" data-testid="checkin-proposal">
          <strong>Check-in abgelaufen</strong> – {block.proposal.missing?.join(" und ") || "eine Seite"} {(block.proposal.missing || []).length > 1 ? "haben" : "hat"} nicht eingecheckt (Fenster bis {clock(block.proposal.due_at)}).
          {" "}Die Liga-Leitung entscheidet: {(block.proposal.missing || []).length > 1 ? "„Beide nicht erschienen“, die Seiten nachtragen oder verlängern" : "kampflos werten, die Seite nachtragen oder verlängern"}. Gewertet wird nichts von selbst.
          {block.lead && leadUrl ? <Link to={leadUrl} className="tls-hit ml-2 font-bold text-white underline underline-offset-2" data-testid="checkin-proposal-decide">Nicht erschienen entscheiden</Link> : null}
        </p>
      ) : null}

      <OwnCheckin key={`${block.state}-${ownSide(block)?.updated_at || ""}`} block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} onAskLead={onAskLead} />
      <VetoPanel block={block.veto} matchId={matchId} busy={busy} run={run} onChanged={onChanged} onPoll={onPoll} />
      {vetoRunning ? null : <StartBlock block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} />}
      {block.state === "open" && other && !other.checked_in && ownSide(block)?.checked_in ? (
        <p className="mt-3 text-xs text-white/55" data-testid="checkin-waiting">Die Seite aktualisiert sich von selbst, sobald {other.name} eingecheckt hat.</p>
      ) : null}
      <LeadEntry block={block} matchId={matchId} busy={busy} run={run} onChanged={onChanged} />

      <details className="mt-4 text-xs text-white/60" data-testid="checkin-rules">
        <summary className="cursor-pointer tls-hit text-white/70">So läuft der Check-in in dieser Season</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {rulesSentences(block.rules).map((sentence) => <li key={sentence}>{sentence}</li>)}
        </ul>
      </details>
    </section>
  );
}
