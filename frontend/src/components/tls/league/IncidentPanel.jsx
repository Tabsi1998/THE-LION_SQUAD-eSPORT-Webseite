// Vorfälle im Spiel auf der Matchseite (D.5, #1619; docs/LIGA.md „D.5/E.2-Vertrag“ → „Vorfälle“): geführt und ohne Vorwissen
// bedienbar (#2023). Oben steht, ob gerade etwas das Ergebnis aufhält; darunter jeder Vorfall als Karte mit dem einen Satz, was
// gilt, dem Countdown für die Antwort der Gegenseite, den Nachweisen (ProofList) und - für die Liga-Leitung - Entscheidung und
// „Serie feststellen“. „Vorfall melden“ fragt Schritt für Schritt: welche Map, was ist passiert, wie stand es, was schlagt ihr vor.
// Jede Angabe steht an einer Stelle: Den Stand je Map zeigt die Map-Liste, den Vorfall nur diese Fläche.
// Bewegung: Karten erscheinen gestaffelt, der Balken der Antwortzeit läuft ohne Sprünge, „In Klärung“ atmet leise, eine Einigung
// setzt ihren Haken. Mit „Bewegung reduzieren“ steht alles still, nur die Zahl zählt.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Gavel, Hourglass, Scale, ShieldAlert, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { HelpLink } from "@/components/tls/HelpLink";
import { StaggerIn } from "@/components/tls/motion";
import { ProofList } from "@/components/tls/results/ProofList";
import { motionAllowed } from "@/lib/motion";
import {
  KIND_HELP, OUTCOME_HELP, PAUSE_BETWEEN, PAUSE_BETWEEN_HELP, PAUSE_BETWEEN_LABEL, PROPOSAL_HELP, STATE_LABELS, canSettleAtOnce, clock,
  clockOffset, closeProblem, decisionProblem, emptyIncidentForm, incidentPayload, incidentProblem, mapStateNotes, positionLabel, quotaHint, quotaText,
  remainingMs, remainingShare, remainingText, scoreText, settleProblem, settleSentence, sortedIncidents, stateSentence,
} from "@/lib/leagueIncidents";
import { ConflictReasonField, overrideMissing, overridePayload } from "./ConflictOverride";

const PRIMARY = "tls-btn tls-btn--primary inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const SECONDARY = "tls-btn tls-btn--secondary inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const QUIET = "tls-btn tls-btn--quiet inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50";
const LEGEND = "text-[11px] font-bold uppercase tracking-widest text-white/60";
const TONES = { proposed: "border-honor/45", in_review: "border-warn/55", agreed: "border-[#00D26A]/40", decided: "border-[#29B6E8]/40", withdrawn: "border-white/10", closed: "border-white/10" };

/** Öffentlich (auch für Gäste): nur, dass eine Map in Klärung ist oder nicht zählt - nie der Vorfall selbst. */
export function MapStateNotes({ league }) {
  const notes = mapStateNotes(league);
  if (!notes.length) return null;
  return (
    <ul className="mt-4 flex flex-wrap gap-2" data-testid="map-state-notes" aria-label="Stand der Maps">
      {notes.map((note) => (
        <li key={`${note.kind}-${note.position}`} data-testid={`map-state-${note.position}`} data-kind={note.kind}
          className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-xs font-bold ${note.kind === "clarification" ? "tls-incident-pulse border-warn/55 bg-warn/10 text-white" : "border-white/15 bg-white/[0.04] text-white/75"}`}>
          {note.kind === "clarification" ? <Scale className="h-3.5 w-3.5 text-warn" aria-hidden="true" /> : null}
          {note.text}
        </li>
      ))}
    </ul>
  );
}

/** Der Countdown der Antwortzeit: Zahl im Sekundentakt, der Balken je Bild ohne React-Durchlauf (nur transform). */
function AnswerCountdown({ incident, offset, onDone }) {
  const bar = useRef(null);
  const fired = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const moving = motionAllowed();
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!moving || !bar.current) return undefined;
    let frame = 0;
    const draw = () => {
      if (bar.current) bar.current.style.transform = `scaleX(${remainingShare(incident, Date.now(), offset)})`;
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [moving, incident, offset]);
  const left = remainingMs(incident.answer_deadline, now, offset);
  useEffect(() => {
    // Ist die Zeit um, holt die Seite den neuen Stand - einmal.
    if (left > 0 || fired.current) return;
    fired.current = true;
    onDone?.();
  }, [left, onDone]);
  return (
    <div className="mt-3" data-testid={`incident-countdown-${incident.id}`} role="timer" aria-live="off">
      <div className="flex items-baseline justify-between gap-3 text-xs text-white/60">
        <span>Antwortzeit bis {clock(incident.answer_deadline)}</span>
        <span className="font-display text-xl font-bold tabular-nums text-white" data-testid={`incident-countdown-text-${incident.id}`}>{left > 0 ? remainingText(left) : "vorbei"}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div ref={bar} className="tls-incident-bar h-full rounded-full bg-honor" style={{ transform: `scaleX(${moving ? remainingShare(incident, now, offset) : 1})` }} />
      </div>
    </div>
  );
}

function StateBadge({ incident }) {
  const state = incident.state;
  const Icon = { proposed: Hourglass, in_review: Scale, agreed: Check, decided: Gavel, withdrawn: Undo2, closed: X }[state] || Hourglass;
  return (
    <span data-testid={`incident-state-${incident.id}`} data-state={state}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${state === "in_review" ? "tls-incident-pulse border-warn/55 bg-warn/10 text-white" : state === "agreed" ? "border-[#00D26A]/50 bg-[#00D26A]/10 text-[#7CF0B4]" : "border-white/15 bg-white/[0.04] text-white/75"}`}>
      <Icon className={`h-3.5 w-3.5 ${state === "agreed" ? "tls-checkin-tick" : ""}`} aria-hidden="true" />
      {STATE_LABELS[state] || state}
    </span>
  );
}

/** Positionen zum Antippen - für fehlende und überzählige Maps. */
function PositionToggles({ legend, bestOf, value, onChange, testId, hint }) {
  const toggle = (position) => onChange(value.includes(position) ? value.filter((item) => item !== position) : [...value, position].sort((a, b) => a - b));
  return (
    <fieldset data-testid={testId}>
      <legend className={LEGEND}>{legend}</legend>
      {hint ? <p className="mt-1 text-xs text-white/55">{hint}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {Array.from({ length: bestOf }, (_, index) => index + 1).map((position) => (
          <button key={position} type="button" aria-pressed={value.includes(position)} onClick={() => toggle(position)} data-testid={`${testId}-${position}`}
            className={`tls-btn ${value.includes(position) ? "tls-btn--secondary" : "tls-btn--quiet"} min-h-11 min-w-11 rounded-sm px-3 py-2 text-xs font-bold`}>
            Map {position}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SettleFields({ league, form, set, testId, withMissing = true }) {
  return (
    <div className="space-y-3">
      {withMissing ? (
        <PositionToggles legend="Fehlt noch eine Map?" bestOf={league.best_of} value={form.missing_positions} onChange={(value) => set("missing_positions", value)}
          testId={`${testId}-missing`} hint="Nur antippen, wenn die Serie mit dem jetzt geltenden Stand nicht entschieden ist. Solange eine Map fehlt, gilt kein Ergebnis." />
      ) : null}
      <PositionToggles legend="Welche Maps zählen nicht?" bestOf={league.best_of} value={form.surplus_positions} onChange={(value) => set("surplus_positions", value)}
        testId={`${testId}-surplus`} hint="Maps, die unter Vorbehalt gespielt wurden, obwohl die Serie schon entschieden war. Meist keine." />
    </div>
  );
}

/** Entscheidung der Liga-Leitung über einen Vorfall in Klärung - auf Wunsch gleich mit „Serie feststellen“. */
function DecisionForm({ league, info, incident, matchId, busy, run, onChanged }) {
  const [form, setForm] = useState({ outcome: "", registration_id: "", reason: "", settle: false, missing_positions: [], surplus_positions: [], conflict: "" });
  const [problem, setProblem] = useState("");
  // Jede Eingabe nimmt den alten Hinweis weg - er stünde sonst neben einer schon behobenen Stelle.
  const set = (key, value) => { setProblem(""); setForm((current) => ({ ...current, [key]: value })); };
  const needsOverride = Boolean(info.conflict?.override);
  const settleNow = form.settle && canSettleAtOnce(form.outcome);
  const submit = (event) => {
    event.preventDefault();
    const missing = decisionProblem(form) || (overrideMissing(needsOverride, form.conflict) ? "Als Notausnahme braucht es einen Grund (mindestens fünf Zeichen)." : "");
    setProblem(missing);
    if (missing) return undefined;
    return run(async () => {
      const { data } = await api.post(`/matches/${matchId}/incidents/${incident.id}/decision`, {
        outcome: form.outcome, registration_id: form.outcome === "awarded" ? form.registration_id : null, reason: form.reason.trim(),
        ...(settleNow ? { settle: { missing_positions: [], surplus_positions: form.surplus_positions } } : {}),
        ...overridePayload(needsOverride, form.conflict),
      });
      toast.success(data?.result_confirmed ? "Entschieden – das Ergebnis gilt jetzt." : settleNow ? "Entschieden und Serie festgestellt." : "Entschieden. Die Serie stellst du danach fest.");
      await onChanged();
    }, "Die Entscheidung ließ sich nicht speichern.");
  };
  return (
    <form onSubmit={submit} className="tls-incident-open mt-4 space-y-4 rounded-sm border border-honor/30 bg-honor/5 p-4" data-testid={`incident-decision-${incident.id}`} noValidate>
      <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-honor"><Gavel className="h-4 w-4" aria-hidden="true" /> Entscheidung der Liga-Leitung</h4>
      <fieldset>
        <legend className={LEGEND}>1 · Wie wird entschieden?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {info.outcomes.map((option) => (
            <label key={option.key} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-sm border px-3 py-2 text-sm ${form.outcome === option.key ? "border-honor/60 bg-honor/10 text-white" : "border-white/10 text-white/80"}`}>
              <input type="radio" name={`outcome-${incident.id}`} className="mt-1 accent-honor" checked={form.outcome === option.key} onChange={() => set("outcome", option.key)} data-testid={`incident-decision-${incident.id}-${option.key}`} />
              <span className="min-w-0 font-bold">{option.label}<span className="block text-xs font-normal text-white/55">{OUTCOME_HELP[option.key]}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {form.outcome === "awarded" ? (
        <fieldset>
          <legend className={LEGEND}>Wem wird die Map zugesprochen?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {league.sides.map((side) => (
              <button key={side.registration_id} type="button" aria-pressed={form.registration_id === side.registration_id} onClick={() => set("registration_id", side.registration_id)}
                className={`tls-btn ${form.registration_id === side.registration_id ? "tls-btn--secondary" : "tls-btn--quiet"} min-h-11 rounded-sm px-3 py-2 text-xs font-bold [overflow-wrap:anywhere]`}
                data-testid={`incident-decision-${incident.id}-side-${side.registration_id}`}>{side.name}</button>
            ))}
          </div>
        </fieldset>
      ) : null}
      <label className="block">
        <span className={LEGEND}>2 · Begründung (Pflicht, beide Seiten lesen sie)</span>
        <textarea value={form.reason} maxLength={500} rows={3} onChange={(event) => set("reason", event.target.value)} className="input mt-1 w-full resize-y"
          placeholder="z. B. Laut Clip beider Seiten stand es 3:4, der Abbruch kam vom Server." data-testid={`incident-decision-${incident.id}-reason`} />
      </label>
      {canSettleAtOnce(form.outcome) ? (
        <div className="space-y-3 rounded-sm border border-white/10 bg-black/20 p-3">
          <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-white/85">
            <input type="checkbox" className="mt-1 accent-honor" checked={form.settle} onChange={(event) => set("settle", event.target.checked)} data-testid={`incident-decision-${incident.id}-settle`} />
            <span className="font-bold">3 · Serie gleich feststellen
              <span className="block text-xs font-normal text-white/55">Anhaken, wenn nichts mehr zu spielen ist. Erst dann kann ein Ergebnis gültig werden. Sonst stellst du die Serie später fest.</span></span>
          </label>
          {form.settle ? <SettleFields league={league} form={form} set={set} testId={`incident-decision-${incident.id}`} withMissing={false} /> : null}
        </div>
      ) : form.outcome ? (
        <p className="rounded-sm border border-white/10 bg-black/20 px-3 py-2 text-xs text-white/65">Die Map wird neu gespielt und wie üblich gemeldet. Danach stellst du hier die Serie fest – erst dann gilt ein Ergebnis.</p>
      ) : null}
      {needsOverride ? <ConflictReasonField value={form.conflict} onChange={(value) => set("conflict", value)} testId={`incident-decision-${incident.id}-conflict`} /> : null}
      {problem ? <p className="text-sm text-warn" role="alert" data-testid={`incident-decision-${incident.id}-problem`}>{problem}</p> : null}
      <button type="submit" disabled={busy} className={PRIMARY} data-testid={`incident-decision-${incident.id}-submit`}><Gavel className="h-4 w-4" aria-hidden="true" /> Entscheiden</button>
    </form>
  );
}

/** „Serie feststellen“ - der zweite Schritt der Leitung, sobald alles gespielt und gemeldet ist. */
function SettleForm({ league, info, incident, matchId, busy, run, onChanged }) {
  const decision = incident.decision || {};
  const [form, setForm] = useState({ missing_positions: [], surplus_positions: decision.surplus_positions || [], reason: "", conflict: "" });
  const [problem, setProblem] = useState("");
  // Jede Eingabe nimmt den alten Hinweis weg - er stünde sonst neben einer schon behobenen Stelle.
  const set = (key, value) => { setProblem(""); setForm((current) => ({ ...current, [key]: value })); };
  const needsOverride = Boolean(info.conflict?.override);
  const submit = (event) => {
    event.preventDefault();
    const missing = settleProblem(form) || (overrideMissing(needsOverride, form.conflict) ? "Als Notausnahme braucht es einen Grund (mindestens fünf Zeichen)." : "");
    setProblem(missing);
    if (missing) return undefined;
    return run(async () => {
      const { data } = await api.post(`/matches/${matchId}/incidents/${incident.id}/settle`, {
        missing_positions: form.missing_positions, surplus_positions: form.surplus_positions, reason: form.reason.trim(), ...overridePayload(needsOverride, form.conflict),
      });
      toast.success(data?.result_confirmed ? "Serie festgestellt – das Ergebnis gilt jetzt." : form.missing_positions.length ? "Festgehalten: Es fehlt noch eine Map." : "Serie festgestellt.");
      await onChanged();
    }, "Die Feststellung ließ sich nicht speichern.");
  };
  return (
    <form onSubmit={submit} className="tls-incident-open mt-4 space-y-4 rounded-sm border border-honor/30 bg-honor/5 p-4" data-testid={`incident-settle-${incident.id}`} noValidate>
      <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-honor"><Scale className="h-4 w-4" aria-hidden="true" /> Serie feststellen</h4>
      <p className="text-xs text-white/65">{decision.settled_at ? "Schon festgestellt – du kannst es ändern, solange das Ergebnis nicht gilt, etwa nachdem die fehlende Map gespielt ist." : "Sobald alle angesetzten Maps gespielt und gemeldet sind: festhalten, ob noch eine Map fehlt und ob Maps nicht zählen. Erst danach gilt ein Ergebnis."}</p>
      <SettleFields league={league} form={form} set={set} testId={`incident-settle-${incident.id}`} />
      <label className="block">
        <span className={LEGEND}>Begründung (Pflicht)</span>
        <textarea value={form.reason} maxLength={500} rows={2} onChange={(event) => set("reason", event.target.value)} className="input mt-1 w-full resize-y"
          placeholder="z. B. Wiederholung gespielt, Serie mit 2:0 entschieden." data-testid={`incident-settle-${incident.id}-reason`} />
      </label>
      {needsOverride ? <ConflictReasonField value={form.conflict} onChange={(value) => set("conflict", value)} testId={`incident-settle-${incident.id}-conflict`} /> : null}
      {problem ? <p className="text-sm text-warn" role="alert" data-testid={`incident-settle-${incident.id}-problem`}>{problem}</p> : null}
      <button type="submit" disabled={busy} className={PRIMARY} data-testid={`incident-settle-${incident.id}-submit`}><Scale className="h-4 w-4" aria-hidden="true" /> Serie feststellen</button>
    </form>
  );
}

function AnswerActions({ incident, matchId, busy, run, onChanged }) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const send = (accept) => run(async () => {
    await api.post(`/matches/${matchId}/incidents/${incident.id}/answer`, { accept, note: accept ? null : note.trim() || null });
    toast.success(accept ? "Zugestimmt – so geht es weiter." : "Abgelehnt – die Liga-Leitung entscheidet.");
    await onChanged();
  }, "Die Antwort ließ sich nicht speichern.");
  return (
    <div className="mt-3 space-y-3" data-testid={`incident-answer-${incident.id}`}>
      {declining ? (
        <div className="tls-incident-open space-y-2 rounded-sm border border-warn/40 bg-warn/5 p-3">
          <label className="block text-xs text-white/65">
            Warum lehnt ihr ab? (freiwillig, die Liga-Leitung liest es)
            <textarea value={note} maxLength={500} rows={2} onChange={(event) => setNote(event.target.value)} className="input mt-1 w-full resize-y" data-testid={`incident-answer-${incident.id}-note`} />
          </label>
          <p className="text-xs text-white/55">Mit der Ablehnung ist die Map in Klärung: Die Liga-Leitung entscheidet, bis dahin gilt kein Ergebnis.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => send(false)} className={SECONDARY} data-testid={`incident-answer-${incident.id}-decline-confirm`}><X className="h-4 w-4" aria-hidden="true" /> Ablehnen und zur Liga-Leitung</button>
            <button type="button" disabled={busy} onClick={() => setDeclining(false)} className={QUIET}>Zurück</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => send(true)} className={PRIMARY} data-testid={`incident-answer-${incident.id}-accept`}><Check className="h-4 w-4" aria-hidden="true" /> Zustimmen</button>
          <button type="button" disabled={busy} onClick={() => setDeclining(true)} className={SECONDARY} data-testid={`incident-answer-${incident.id}-decline`}><X className="h-4 w-4" aria-hidden="true" /> Ablehnen</button>
        </div>
      )}
    </div>
  );
}

/** Die Liga-Leitung schließt einen offenen Vorfall ohne Entscheidung - etwa bevor sie das Spiel kampflos wertet. */
function CloseForm({ info, incident, matchId, busy, run, onChanged }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reason: "", conflict: "" });
  const [problem, setProblem] = useState("");
  const set = (key, value) => { setProblem(""); setForm((current) => ({ ...current, [key]: value })); };
  const needsOverride = Boolean(info.conflict?.override);
  const submit = (event) => {
    event.preventDefault();
    const missing = closeProblem(form) || (overrideMissing(needsOverride, form.conflict) ? "Als Notausnahme braucht es einen Grund (mindestens fünf Zeichen)." : "");
    setProblem(missing);
    if (missing) return undefined;
    return run(async () => {
      await api.post(`/matches/${matchId}/incidents/${incident.id}/close`, { reason: form.reason.trim(), ...overridePayload(needsOverride, form.conflict) });
      toast.success("Vorfall geschlossen.");
      await onChanged();
    }, "Der Vorfall ließ sich nicht schließen.");
  };
  if (!open) {
    return (
      <button type="button" disabled={busy} onClick={() => setOpen(true)} className={`${QUIET} mt-3`} data-testid={`incident-close-${incident.id}-open`}>
        <X className="h-4 w-4" aria-hidden="true" /> Ohne Entscheidung schließen
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="tls-incident-open mt-3 space-y-3 rounded-sm border border-white/15 bg-black/20 p-3" data-testid={`incident-close-${incident.id}`} noValidate>
      <p className="text-xs text-white/65">Schließt den Vorfall, ohne über die Map zu entscheiden – etwa wenn das Spiel kampflos gewertet wird. Solange ein Vorfall offen ist, geht „kampflos“ und „nicht erschienen“ nicht.</p>
      <label className="block">
        <span className={LEGEND}>Begründung (Pflicht, beide Seiten lesen sie)</span>
        <textarea value={form.reason} maxLength={500} rows={2} onChange={(event) => set("reason", event.target.value)} className="input mt-1 w-full resize-y" data-testid={`incident-close-${incident.id}-reason`} />
      </label>
      {needsOverride ? <ConflictReasonField value={form.conflict} onChange={(value) => set("conflict", value)} testId={`incident-close-${incident.id}-conflict`} /> : null}
      {problem ? <p className="text-sm text-warn" role="alert" data-testid={`incident-close-${incident.id}-problem`}>{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={SECONDARY} data-testid={`incident-close-${incident.id}-submit`}><X className="h-4 w-4" aria-hidden="true" /> Vorfall schließen</button>
        <button type="button" disabled={busy} onClick={() => setOpen(false)} className={QUIET}>Zurück</button>
      </div>
    </form>
  );
}

/** Nachweise erst laden, wenn jemand sie aufklappt - ein offener Vorfall zeigt sie gleich. */
function IncidentProofs({ incident, league, matchId }) {
  const [open, setOpen] = useState(Boolean(incident.open));
  const sideLabels = Object.fromEntries(league.sides.map((side) => [side.registration_id, side.name]));
  return (
    <details className="group mt-3 rounded-sm border border-white/10 bg-black/20" open={open} onToggle={(event) => setOpen(event.currentTarget.open)} data-testid={`incident-proofs-${incident.id}`}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/70">
        Nachweise (Screenshot, Clip)
        <ChevronDown className="h-4 w-4 shrink-0 text-white/50 transition-transform duration-fast group-open:rotate-180" aria-hidden="true" />
      </summary>
      {open ? (
        <div className="space-y-4 border-t border-white/10 p-3">
          <ProofList matchId={matchId} kind="incident" refId={incident.id} title="Zum Vorfall" sideLabels={sideLabels} testId={`incident-proof-${incident.id}`} />
          {incident.kind === "moss_crash" ? (
            <ProofList matchId={matchId} kind="moss" refId={incident.id} title="MOSS-Nachweis zum Absturz" sideLabels={sideLabels} testId={`incident-moss-${incident.id}`} />
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function IncidentCard({ league, info, incident, matchId, busy, run, onChanged, offset }) {
  const waiting = incident.state === "proposed" && !incident.expired;
  const reporter = incident.reported_by || {};
  const other = league.sides.find((side) => side.registration_id !== reporter.registration_id);
  // Die Restzeit steht nur im Countdown darunter - der Satz nennt die Uhrzeit der Frist.
  const sentence = stateSentence(incident, { otherName: other?.name });
  const stand = scoreText(incident.score, league.sides);
  const withdraw = () => run(async () => {
    await api.post(`/matches/${matchId}/incidents/${incident.id}/withdraw`);
    toast.success("Vorfall zurückgezogen.");
    await onChanged();
  }, "Zurückziehen hat nicht geklappt.");
  return (
    <li className={`rounded-sm border bg-[#0A0A0A] p-4 ${TONES[incident.state] || "border-white/10"}`} data-testid={`incident-${incident.id}`} data-state={incident.state}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="font-heading text-base font-black uppercase [overflow-wrap:anywhere]">{positionLabel(league, incident.position)} · {incident.between_maps ? PAUSE_BETWEEN_LABEL : incident.kind_label}</h4>
          <p className="mt-0.5 text-xs text-white/55">Gemeldet von {reporter.name || "einer Seite"}{reporter.own ? " (ihr)" : ""} um {clock(incident.at)}</p>
        </div>
        <StateBadge incident={incident} />
      </div>
      <p className="mt-3 text-sm text-white/85" data-testid={`incident-sentence-${incident.id}`}>{sentence}</p>
      {incident.between_maps ? null : (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs text-white/65 sm:grid-cols-2">
          {incident.proposal_label ? <div><dt className="inline text-white/45">Vorschlag: </dt><dd className="inline font-bold text-white/85">{incident.proposal_label}</dd></div> : null}
          {stand ? <div><dt className="inline text-white/45">Stand beim Vorfall: </dt><dd className="inline font-bold tabular-nums text-white/85">{stand}{incident.round != null ? ` · Runde ${incident.round}` : ""}</dd></div> : null}
          {incident.players?.length ? <div className="sm:col-span-2"><dt className="inline text-white/45">Betroffen: </dt><dd className="inline [overflow-wrap:anywhere]">{incident.players.map((person) => person.name).join(", ")}</dd></div> : null}
          {incident.counts_quota && reporter.registration_id ? (
            <div data-testid={`incident-quota-${incident.id}`}><dt className="inline text-white/45">Kontingent {reporter.name}: </dt><dd className="inline">{quotaText(info, reporter.registration_id, incident.position)}</dd></div>
          ) : null}
        </dl>
      )}
      {incident.note ? <p className="mt-2 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/80 whitespace-pre-wrap [overflow-wrap:anywhere]">{incident.note}</p> : null}
      {incident.answer?.note ? <p className="mt-2 text-xs text-white/65 [overflow-wrap:anywhere]"><span className="text-white/45">Antwort von {incident.answer.name || "der Gegenseite"}: </span>{incident.answer.note}</p> : null}
      {waiting ? <AnswerCountdown incident={incident} offset={offset} onDone={onChanged} /> : null}
      {incident.can_answer ? <AnswerActions incident={incident} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {incident.can_withdraw ? (
        <button type="button" disabled={busy} onClick={withdraw} className={`${QUIET} mt-3`} data-testid={`incident-withdraw-${incident.id}`}><Undo2 className="h-4 w-4" aria-hidden="true" /> Zurückziehen</button>
      ) : null}
      {incident.decision ? (
        <div className="mt-3 rounded-sm border border-[#29B6E8]/30 bg-[#29B6E8]/5 px-3 py-2 text-sm text-white/85" data-testid={`incident-decided-${incident.id}`}>
          <p className="[overflow-wrap:anywhere]"><span className="text-white/55">Begründung: </span>{incident.decision.reason}</p>
          <p className="mt-1 text-xs text-white/65" data-testid={`incident-settled-${incident.id}`}>{settleSentence(incident.decision)}{incident.decision.settle_reason ? ` ${incident.decision.settle_reason}` : ""}</p>
        </div>
      ) : null}
      {incident.close_note ? (
        <p className="mt-3 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white/85 [overflow-wrap:anywhere]" data-testid={`incident-close-note-${incident.id}`}>
          <span className="text-white/55">Begründung der Liga-Leitung: </span>{incident.close_note}
        </p>
      ) : null}
      {incident.voided ? (
        <p className="mt-2 text-xs text-white/60" data-testid={`incident-voided-${incident.id}`}>Die erste Austragung{scoreText(incident.voided.score, league.sides) ? ` (Stand ${scoreText(incident.voided.score, league.sides)})` : ""} zählt nicht – die Map wird nur einmal gewertet.</p>
      ) : null}
      {incident.procedure ? <p className="mt-2 text-xs font-bold text-[#29B6E8]" data-testid={`incident-procedure-${incident.id}`}>Dazu läuft ein Verfahren.</p> : null}
      {incident.between_maps ? null : <IncidentProofs incident={incident} league={league} matchId={matchId} />}
      {incident.can_decide ? <DecisionForm league={league} info={info} incident={incident} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {incident.can_settle ? <SettleForm key={incident.decision?.settled_at || "offen"} league={league} info={info} incident={incident} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
      {incident.can_close ? <CloseForm info={info} incident={incident} matchId={matchId} busy={busy} run={run} onChanged={onChanged} /> : null}
    </li>
  );
}

function Choice({ name, value, checked, onChange, label, help, testId }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-sm border px-3 py-2 text-sm ${checked ? "border-[#29B6E8]/60 bg-[#29B6E8]/10 text-white" : "border-white/10 text-white/80"}`}>
      <input type="radio" name={name} value={value} className="mt-1 accent-[#29B6E8]" checked={checked} onChange={onChange} data-testid={testId} />
      <span className="min-w-0 font-bold">{label}{help ? <span className="block text-xs font-normal text-white/55">{help}</span> : null}</span>
    </label>
  );
}

/** „Vorfall melden“ - vier Fragen nacheinander, jede mit einem Satz dazu. */
function ReportForm({ league, info, matchId, busy, run, onChanged, onClose }) {
  const [form, setForm] = useState(() => emptyIncidentForm(info));
  const [problem, setProblem] = useState("");
  // Jede Eingabe nimmt den alten Hinweis weg - er stünde sonst neben einer schon behobenen Stelle.
  const set = (key, value) => { setProblem(""); setForm((current) => ({ ...current, [key]: value })); };
  const ownId = info.as_lead ? null : league.own_registration_id;
  const between = form.kind === PAUSE_BETWEEN;
  const roster = info.as_lead ? Object.values(league.rosters || {}).flat() : league.roster || [];
  const other = league.sides.find((side) => side.registration_id !== ownId);
  const togglePlayer = (id) => set("players", form.players.includes(id) ? form.players.filter((item) => item !== id) : [...form.players, id]);
  const submit = (event) => {
    event.preventDefault();
    const missing = incidentProblem(form, league.sides) || (info.as_lead && overrideMissing(Boolean(info.conflict?.override), form.conflict) ? "Als Notausnahme braucht es einen Grund (mindestens fünf Zeichen)." : "");
    setProblem(missing);
    if (missing) return undefined;
    return run(async () => {
      await api.post(`/matches/${matchId}/incidents`, { ...incidentPayload(form, league.sides), ...(info.as_lead ? overridePayload(Boolean(info.conflict?.override), form.conflict) : {}) });
      toast.success(between ? "Pause festgehalten." : info.as_lead ? "Aufgenommen – die Map ist in Klärung." : `Gemeldet – ${other?.name || "die Gegenseite"} hat ${info.answer_minutes} Minuten zum Antworten.`);
      onClose();
      await onChanged();
    }, "Der Vorfall ließ sich nicht melden.");
  };
  const quota = quotaHint(info, ownId, form.position, form.kind);
  return (
    <form onSubmit={submit} className="tls-incident-open mt-4 space-y-5 rounded-sm border border-[#29B6E8]/35 bg-[#0A0A0A] p-4" data-testid="incident-form" noValidate>
      <fieldset>
        <legend className={LEGEND}>1 · Um welche Map geht es?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {Array.from({ length: league.best_of }, (_, index) => index + 1).map((position) => (
            <button key={position} type="button" aria-pressed={Number(form.position) === position} onClick={() => set("position", position)} data-testid={`incident-form-position-${position}`}
              className={`tls-btn ${Number(form.position) === position ? "tls-btn--secondary" : "tls-btn--quiet"} min-h-11 rounded-sm px-3 py-2 text-xs font-bold [overflow-wrap:anywhere]`}>
              {positionLabel(league, position)}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={LEGEND}>2 · Was ist passiert?</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {info.kinds.map((kind) => (
            <Choice key={kind.key} name="incident-kind" value={kind.key} checked={form.kind === kind.key} onChange={() => set("kind", kind.key)} label={kind.label} help={KIND_HELP[kind.key]} testId={`incident-form-kind-${kind.key}`} />
          ))}
          <Choice name="incident-kind" value={PAUSE_BETWEEN} checked={between} onChange={() => set("kind", PAUSE_BETWEEN)} label={PAUSE_BETWEEN_LABEL} help={PAUSE_BETWEEN_HELP} testId="incident-form-kind-pause-between" />
        </div>
      </fieldset>
      {between ? (
        <label className="block max-w-xs">
          <span className={LEGEND}>3 · Wie lange war die Pause? (Minuten)</span>
          <input type="number" inputMode="numeric" min={0} max={120} value={form.minutes} onChange={(event) => set("minutes", event.target.value)} className="input mt-1 w-full" data-testid="incident-form-minutes" />
          <span className="mt-1 block text-xs text-white/55">Üblich sind {info.break_minutes} Minuten nach Map {info.break_after}. Gemeint ist die Pause nach der oben gewählten Map.</span>
        </label>
      ) : form.kind ? (
        <>
          <fieldset>
            <legend className={LEGEND}>3 · Wie stand es? (freiwillig)</legend>
            <p className="mt-1 text-xs text-white/55">Der letzte Stand, den ihr belegen könnt – Runden oder Punkte. Beide Felder oder keines.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {league.sides.map((side) => (
                <label key={side.registration_id} className="block min-w-0 text-xs text-white/65">
                  <span className="block truncate">{side.name}</span>
                  <input type="number" inputMode="numeric" min={0} value={form.scores[side.registration_id] ?? ""} className="input mt-1 w-full" data-testid={`incident-form-score-${side.registration_id}`}
                    onChange={(event) => set("scores", { ...form.scores, [side.registration_id]: event.target.value })} />
                </label>
              ))}
              <label className="col-span-2 block text-xs text-white/65 sm:col-span-1">
                Runde
                <input type="number" inputMode="numeric" min={0} value={form.round} onChange={(event) => set("round", event.target.value)} className="input mt-1 w-full" data-testid="incident-form-round" />
              </label>
            </div>
            {roster.length ? (
              <div className="mt-3">
                <p className="text-xs text-white/65">Wer war betroffen? (freiwillig)</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {roster.map((person) => (
                    <li key={person.id}>
                      <button type="button" aria-pressed={form.players.includes(person.id)} onClick={() => togglePlayer(person.id)} data-testid={`incident-form-player-${person.id}`}
                        className={`tls-btn ${form.players.includes(person.id) ? "tls-btn--secondary" : "tls-btn--quiet"} min-h-11 rounded-sm px-3 py-2 text-xs [overflow-wrap:anywhere]`}>{person.name}</button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </fieldset>
          <fieldset>
            <legend className={LEGEND}>4 · {info.as_lead ? "Was steht zur Entscheidung?" : "Was schlagt ihr vor?"}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {info.proposals.map((proposal) => (
                <Choice key={proposal.key} name="incident-proposal" value={proposal.key} checked={form.proposal === proposal.key} onChange={() => set("proposal", proposal.key)} label={proposal.label} help={PROPOSAL_HELP[proposal.key]} testId={`incident-form-proposal-${proposal.key}`} />
              ))}
            </div>
          </fieldset>
        </>
      ) : null}
      {form.kind ? (
        <label className="block">
          <span className={LEGEND}>{between ? "4" : "5"} · Beschreibung {form.kind === "other" ? "(Pflicht)" : "(freiwillig)"}</span>
          <textarea value={form.note} maxLength={500} rows={3} onChange={(event) => set("note", event.target.value)} className="input mt-1 w-full resize-y"
            placeholder={between ? "z. B. beide Teams wollten 10 Minuten Pause" : "Was ist passiert, Ursache soweit bekannt"} data-testid="incident-form-note" />
        </label>
      ) : null}
      {quota ? <p className="rounded-sm border border-honor/30 bg-honor/5 px-3 py-2 text-xs text-white/80" data-testid="incident-form-quota">{quota}</p> : null}
      {form.kind && !between ? (
        <p className="text-xs text-white/55" data-testid="incident-form-next">
          {info.as_lead ? "Als Liga-Leitung nimmst du den Vorfall auf: Die Map ist sofort in Klärung, bis du entscheidest."
            : `Nach dem Absenden hat ${other?.name || "die Gegenseite"} ${info.answer_minutes} Minuten zum Antworten. Nachweise (Screenshot, Clip) hängt ihr gleich danach am Vorfall an.`}
        </p>
      ) : null}
      {info.as_lead && info.conflict?.override ? <ConflictReasonField value={form.conflict || ""} onChange={(value) => set("conflict", value)} testId="incident-form-conflict" /> : null}
      {problem ? <p className="text-sm text-warn" role="alert" data-testid="incident-form-problem">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={PRIMARY} data-testid="incident-form-submit">{between ? "Pause festhalten" : info.as_lead ? "Vorfall aufnehmen" : "Vorfall melden"}</button>
        <button type="button" disabled={busy} onClick={onClose} className={QUIET} data-testid="incident-form-cancel">Abbrechen</button>
      </div>
    </form>
  );
}

export function IncidentPanel({ league, matchId, busy, run, onChanged }) {
  const info = league?.incident_info;
  const [formOpen, setFormOpen] = useState(false);
  // Die Uhr des Geräts gegen die des Servers - einmal je geladenem Stand.
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setOffset(clockOffset(info?.server_time));
  }, [info?.server_time]);
  if (!info) return null;
  const incidents = sortedIncidents(league.incidents);
  if (!incidents.length && !info.can_report) return null;
  return (
    <section id="vorfaelle" className="mt-6 scroll-mt-24 rounded-sm border border-white/10 bg-[#121212] p-5" data-testid="incident-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8]">
            Vorfälle · Regelwerk § 9
            <HelpLink thema="liga-captains" schritt="vorfall-melden" className="-my-2" />
          </div>
          <h3 className="mt-1 font-heading text-xl font-black uppercase">Vorfälle im Spiel</h3>
          <p className="mt-1 text-sm text-white/65">Verbindungsabbruch, Rehost oder Pause: Eine Seite meldet mit Vorschlag, die andere antwortet. Ohne Einigung entscheidet die Liga-Leitung.</p>
        </div>
        {info.can_report && !formOpen ? (
          <button type="button" disabled={busy} onClick={() => setFormOpen(true)} className={SECONDARY} data-testid="incident-open-form">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" /> {info.as_lead ? "Vorfall aufnehmen" : "Vorfall melden"}
          </button>
        ) : null}
      </div>
      {info.hold ? (
        <p className="mt-4 flex items-start gap-2 rounded-sm border border-warn/45 bg-warn/10 px-3 py-2.5 text-sm text-white/90" data-testid="incident-hold" data-code={info.hold.code}>
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <span>{info.hold.text}{info.clarification_mode === "pause_series" && info.hold.code === "in_review" ? " Die Serie pausiert: Spätere Maps lassen sich erst danach melden." : info.hold.code === "in_review" ? " Die Serie läuft unter Vorbehalt weiter." : ""}</span>
        </p>
      ) : null}
      {info.conflict && !info.conflict.override && info.can_decide === false ? (
        <p className="mt-4 flex items-start gap-2 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-white/70" data-testid="incident-conflict">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          Du bist an diesem Spiel selbst beteiligt. Über Vorfälle entscheidet hier eine zweite berechtigte Person.
        </p>
      ) : null}
      {formOpen ? <ReportForm league={league} info={info} matchId={matchId} busy={busy} run={run} onChanged={onChanged} onClose={() => setFormOpen(false)} /> : null}
      {incidents.length ? (
        <StaggerIn as="ul" className="mt-4 space-y-3" data-testid="incident-list">
          {incidents.map((incident) => (
            <IncidentCard key={incident.id} league={league} info={info} incident={incident} matchId={matchId} busy={busy} run={run} onChanged={onChanged} offset={offset} />
          ))}
        </StaggerIn>
      ) : (
        <p className="mt-4 text-sm text-white/50" data-testid="incident-empty">Bisher kein Vorfall gemeldet.</p>
      )}
    </section>
  );
}
