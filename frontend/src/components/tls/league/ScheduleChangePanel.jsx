// Liga-Termine auf der Matchseite (#2194, docs/LIGA.md D.1): Verschiebung beantragen, zustimmen, ablehnen, zurückziehen,
// die Grenzen im Klartext und der Verlauf des Termins. Geführt (#2023): Wer was tun kann, sieht genau diesen Schritt -
// alles andere steht als Satz da. Die Liga-Leitung legt den Termin hier mit Grund fest.
import { useState } from "react";
import { CalendarClock, Check, History, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { fromViennaInput, viennaInputValue } from "@/lib/vienna";
import { historyLine, homeRuleText, limitText, requestStatusLabel, rulesSentences, shortWhen, weekText } from "@/lib/leagueSchedule";

const REASON_MIN = 5;
const LEAD_MS = 5 * 60 * 1000;

function earliest() {
  return viennaInputValue(new Date(Date.now() + LEAD_MS).toISOString());
}

function RequestRow({ request, busy, onDecide }) {
  return (
    <li className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3" data-testid={`reschedule-request-${request.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold">{shortWhen(request.from_at)} → {shortWhen(request.to_at)}</div>
          <div className="mt-1 text-xs text-white/50 [overflow-wrap:anywhere]" data-testid={`reschedule-status-${request.id}`}>
            {[request.side_name, request.requested_by_name].filter(Boolean).join(" · ")} · {requestStatusLabel(request)}
          </div>
          <div className="mt-1 text-xs text-white/70 [overflow-wrap:anywhere]">Grund: {request.reason}</div>
          {request.decision_note ? <div className="mt-1 text-xs text-white/55 [overflow-wrap:anywhere]">Antwort: {request.decision_note}</div> : null}
        </div>
        {request.can_answer ? (
          <div className="flex gap-2 shrink-0">
            <button type="button" disabled={busy} onClick={() => onDecide(request, "accept")} data-testid={`reschedule-accept-${request.id}`}
              className="tls-btn tls-btn--primary min-h-11 inline-flex items-center gap-1.5 rounded-sm px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50">
              <Check className="w-3.5 h-3.5" aria-hidden="true" /> Zustimmen
            </button>
            <button type="button" disabled={busy} onClick={() => onDecide(request, "decline")} data-testid={`reschedule-decline-${request.id}`}
              className="tls-btn tls-btn--quiet min-h-11 inline-flex items-center gap-1.5 rounded-sm px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50">
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Ablehnen
            </button>
          </div>
        ) : null}
        {request.can_withdraw ? (
          <button type="button" disabled={busy} onClick={() => onDecide(request, "withdraw")} data-testid={`reschedule-withdraw-${request.id}`}
            className="tls-btn tls-btn--quiet min-h-11 shrink-0 rounded-sm px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50">
            Zurückziehen
          </button>
        ) : null}
      </div>
    </li>
  );
}

function DateReasonForm({ testId, title, hint, submitLabel, busy, onSubmit, initial }) {
  const [at, setAt] = useState(viennaInputValue(initial));
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    const scheduledAt = fromViennaInput(at);
    if (!scheduledAt) return setProblem("Bitte Tag und Uhrzeit wählen.");
    if (new Date(scheduledAt).getTime() < Date.now() + LEAD_MS) return setProblem("Der Termin liegt in der Vergangenheit – bitte frühestens 5 Minuten ab jetzt.");
    if (reason.trim().length < REASON_MIN) return setProblem("Bitte einen Grund angeben (mindestens fünf Zeichen).");
    setProblem("");
    const done = await onSubmit({ scheduled_at: scheduledAt, reason: reason.trim() });
    if (done) setReason("");
  };
  return (
    <form onSubmit={submit} className="mt-4 rounded-sm border border-[#29B6E8]/30 bg-[#0F1D23] p-4" data-testid={testId} noValidate>
      <h4 className="text-xs font-bold uppercase tracking-widest text-[#29B6E8]">{title}</h4>
      {hint ? <p className="mt-1 text-xs text-white/60">{hint}</p> : null}
      <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] md:items-end">
        <label className="block text-xs text-white/60">
          Neuer Termin (Wiener Zeit)
          <input type="datetime-local" min={earliest()} value={at} onChange={(event) => setAt(event.target.value)} className="input mt-1 w-full"
            data-testid={`${testId}-at`} />
        </label>
        <label className="block text-xs text-white/60">
          Grund (Pflicht)
          <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} className="input mt-1 w-full"
            placeholder="z. B. zwei Spieler auf Dienstreise" data-testid={`${testId}-reason`} />
        </label>
        <button type="submit" disabled={busy} data-testid={`${testId}-submit`}
          className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {submitLabel}
        </button>
      </div>
      {problem ? <p className="mt-2 text-xs text-warn" role="alert" data-testid={`${testId}-problem`}>{problem}</p> : null}
    </form>
  );
}

export function ScheduleChangePanel({ block, matchId, busy, run, onChanged, onAskLead }) {
  if (!block) return null;
  const pending = (block.requests || []).filter((request) => request.status === "pending");
  const older = (block.requests || []).filter((request) => request.status !== "pending").slice(0, 5);
  const history = (block.history || []).map((entry) => ({ entry, line: historyLine(entry) }));
  const limit = limitText(block);
  const homeRule = homeRuleText(block);
  const week = weekText(block.window);

  const requestChange = (payload) => run(async () => {
    await api.post(`/matches/${matchId}/reschedule`, payload);
    toast.success("Verschiebung beantragt – die Gegenseite muss zustimmen.");
    await onChanged();
  }, "Verschiebung konnte nicht beantragt werden.");

  const decide = (request, action) => run(async () => {
    await api.post(`/matches/${matchId}/reschedule/${request.id}/decision`, { action });
    toast.success(action === "accept" ? "Zugestimmt – der neue Termin gilt." : action === "decline" ? "Abgelehnt – der Termin bleibt." : "Antrag zurückgezogen.");
    await onChanged();
  }, "Antwort konnte nicht gespeichert werden.");

  const leadSet = ({ scheduled_at: scheduledAt, reason }) => run(async () => {
    await api.patch(`/matches/${matchId}`, { scheduled_at: scheduledAt, schedule_reason: reason });
    toast.success("Termin festgelegt – beide Seiten bekommen Bescheid.");
    await onChanged();
  }, "Termin konnte nicht gesetzt werden.");

  return (
    <section className="mt-6 border-t border-white/10 pt-5" data-testid="schedule-change">
      <h3 className="font-heading text-base font-black uppercase flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-[#29B6E8]" aria-hidden="true" /> Termin und Verschiebung
      </h3>
      {limit ? <p className="mt-2 text-sm text-white/80" data-testid="schedule-limit">{limit}</p> : null}
      {homeRule ? <p className="mt-1 text-sm text-[#FFD700]" data-testid="schedule-home-rule">{homeRule}</p> : null}
      {week ? <p className="mt-1 text-xs text-white/50" data-testid="schedule-week">Spielwoche: {week}</p> : null}
      <details className="mt-2 text-xs text-white/60" data-testid="schedule-rules">
        <summary className="cursor-pointer tls-hit text-white/70">So laufen Termine in dieser Season</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {rulesSentences(block.rules).map((sentence) => <li key={sentence}>{sentence}</li>)}
        </ul>
      </details>

      {pending.length ? (
        <ul className="mt-4 space-y-2" data-testid="schedule-open-requests">
          {pending.map((request) => <RequestRow key={request.id} request={request} busy={busy} onDecide={decide} />)}
        </ul>
      ) : null}

      {block.can_request ? (
        <DateReasonForm testId="reschedule-form" title="Verschiebung beantragen" busy={busy} onSubmit={requestChange} initial={block.scheduled_at}
          hint="Die Gegenseite stimmt zu oder lehnt ab. Bis dahin gilt der bisherige Termin." submitLabel="Beantragen" />
      ) : block.request_hint && !pending.length && block.fixed ? (
        <p className="mt-4 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-white/75" data-testid="reschedule-hint">
          {block.request_hint}{" "}
          {onAskLead ? <button type="button" onClick={onAskLead} className="tls-btn tls-btn--quiet tls-hit ml-1 rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider">@leitung schreiben</button> : null}
        </p>
      ) : null}

      {block.can_lead_set ? (
        <DateReasonForm testId="lead-schedule-form" title="Termin festlegen (Liga-Leitung)" busy={busy} onSubmit={leadSet} initial={block.scheduled_at}
          hint="Gilt sofort, auch außerhalb der Grenzen. Offene Anträge sind damit erledigt; der Grund steht im Verlauf." submitLabel="Festlegen" />
      ) : null}

      {older.length ? (
        <ul className="mt-4 space-y-2" data-testid="schedule-closed-requests">
          {older.map((request) => <RequestRow key={request.id} request={request} busy={busy} onDecide={decide} />)}
        </ul>
      ) : null}

      {history.length ? (
        <div className="mt-5">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-white/55"><History className="w-3.5 h-3.5" aria-hidden="true" /> Verlauf</h4>
          <ol className="mt-2 space-y-1.5" data-testid="schedule-history">
            {history.map(({ entry, line }) => (
              <li key={entry.id || `${entry.at}-${entry.kind}`} className="text-xs text-white/65 [overflow-wrap:anywhere]" data-testid={`schedule-history-${entry.kind}`}>
                <span className="font-bold text-white/85">{line.kind}</span>: {line.to}
                {line.from ? <span className="text-white/45"> (vorher {line.from})</span> : null}
                {line.who ? <span> · {line.who}</span> : null}
                {line.at ? <span className="text-white/40"> · {line.at}</span> : null}
                {line.reason ? <div className="text-white/55">Grund: {line.reason}</div> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
