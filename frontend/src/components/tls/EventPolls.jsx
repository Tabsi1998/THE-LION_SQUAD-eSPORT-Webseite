import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Vote } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { StatusChip } from "@/components/tls/StatusChip";
import { BallotChoice, BallotResult, normalizeBallotList } from "@/components/tls/ballot/BallotParts";
import { chosenOf, pollChip, pollDeadlineText, pollHiddenText, pollRuleText, toggleChoice } from "@/lib/eventPolls";

// Abstimmungen am Event (#2612): Frage, Frist und Stand je Abstimmung; Angemeldete wählen und stimmen ab, ändern bis zur
// Frist. Wer nicht abstimmen darf, liest den Grund (Warteliste, nicht angemeldet). Das Ergebnis zeigt die Seite nur so,
// wie die Verwaltung es eingestellt hat - wer wie gestimmt hat, steht nirgends. Auswahl und Ergebnis kommen aus demselben
// Baustein wie bei den Versammlungen (ballot/BallotParts).

function sameChoices(a, b) {
  return a.length === b.length && a.every((code) => b.includes(code));
}

function PollCard({ poll, eventId, accessToken, onSaved, now }) {
  const own = chosenOf(poll);
  const [chosen, setChosen] = useState(own);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { setChosen(chosenOf(poll)); }, [poll]);
  const right = poll.rights[0];
  const chip = pollChip(poll);
  const voted = right?.state === "used";
  const changed = !sameChoices(chosen, own);
  const ownLabels = poll.options.filter((option) => own.includes(option.code)).map((option) => option.label);

  const submit = async () => {
    if (!chosen.length || !changed) return;
    setBusy(true);
    setMessage("");
    try {
      const { data } = await api.put(`/events/${eventId}/polls/${poll.id}/vote`, { choices: chosen }, accessToken ? { params: { access: accessToken } } : undefined);
      onSaved(data);
      toast.success(voted ? "Deine Stimme ist geändert." : "Danke – deine Stimme ist angekommen.");
    } catch (err) {
      setMessage(formatApiError(err?.response?.data?.detail) || "Die Stimme ist nicht angekommen – bitte noch einmal versuchen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border border-white/10 bg-surface-1 rounded-sm p-4 sm:p-5 space-y-4 min-w-0" data-testid={`event-poll-${poll.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="tls-type-card break-words">{poll.question}</h3>
          <p className="mt-1 tls-type-small text-white/60" data-testid={`event-poll-${poll.id}-deadline`}>{pollDeadlineText(poll, now)}</p>
          <p className="tls-type-small text-quiet" data-testid={`event-poll-${poll.id}-rule`}>{pollRuleText(poll)}</p>
        </div>
        <StatusChip kind={chip.kind} label={chip.label} testId={`event-poll-${poll.id}-status`} />
      </div>

      {voted && ownLabels.length ? (
        <p className="inline-flex items-start gap-2 tls-type-small text-white/85" data-testid={`event-poll-${poll.id}-own`}>
          <CheckCircle2 className="w-4 h-4 text-ok shrink-0 mt-0.5" aria-hidden="true" />
          <span className="min-w-0 break-words">Deine Stimme: {ownLabels.join(", ")}</span>
        </p>
      ) : null}

      {poll.can_vote && right ? (
        <div className="space-y-3">
          <BallotChoice ballot={poll} right={right} label={poll.multiple ? `Wähle bis zu ${poll.max_choices}` : "Wähle eine Antwort"}
            multiple={poll.multiple} chosen={chosen} disabled={busy}
            onChoose={(code) => setChosen((current) => toggleChoice(current, code, poll.max_choices))} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={submit} disabled={busy || !chosen.length || !changed}
              className="tls-btn tls-btn--primary inline-flex min-h-11 items-center gap-2 px-4 py-2 rounded-sm tls-type-label disabled:opacity-40"
              data-testid={`event-poll-${poll.id}-submit`}>
              <Vote className="w-4 h-4" aria-hidden="true" /> {voted ? "Stimme ändern" : "Abstimmen"}
            </button>
            {voted ? <span className="tls-type-small text-quiet">Ändern geht bis zur Frist.</span> : null}
          </div>
        </div>
      ) : null}

      {!poll.can_vote && poll.reason_text && poll.status === "open" ? (
        <p className="tls-type-small text-white/60" data-testid={`event-poll-${poll.id}-reason`}>
          {poll.reason_text}
          {poll.reason === "login" ? <> <Link to={`/login?next=${encodeURIComponent(typeof window !== "undefined" ? window.location.pathname : "/")}`} className="font-bold text-brand hover:underline underline-offset-4">Anmelden</Link></> : null}
        </p>
      ) : null}

      {message ? <p className="tls-type-small text-warn" role="status" data-testid={`event-poll-${poll.id}-message`}>{message}</p> : null}

      {poll.result ? (
        <BallotResult result={poll.result} bars title={poll.status === "closed" ? "Ergebnis" : "Stand"} testId={`event-poll-${poll.id}-result`}
          className="border-t border-white/10 pt-4" />
      ) : poll.result_hidden ? (
        <p className="border-t border-white/10 pt-4 tls-type-small text-white/60" data-testid={`event-poll-${poll.id}-hidden`}>{pollHiddenText(poll, now)}</p>
      ) : null}
    </li>
  );
}

/** Die Abstimmungen eines Events - nichts, wenn es keine gibt. */
export function EventPolls({ event, accessToken = "", now }) {
  const [polls, setPolls] = useState(() => normalizeBallotList(event?.polls));
  useEffect(() => { setPolls(normalizeBallotList(event?.polls)); }, [event?.polls]);
  if (!polls.length) return null;
  const replace = (fresh) => {
    const [next] = normalizeBallotList([fresh]);
    if (next) setPolls((current) => current.map((poll) => (poll.id === next.id ? next : poll)));
  };
  return (
    // Ohne data-section: die Reihenfolge der Abschnitte (EVENT_SECTIONS) teilt die Seite mit der App, die Abstimmungen
    // dort noch nicht zeigt - sie hängen am Abschnitt „Dein Event“.
    <section data-testid="event-polls" className="min-w-0">
      <h2 className="tls-type-section mb-4 inline-flex items-center gap-2">
        <Vote className="w-5 h-5 text-event" aria-hidden="true" /> Abstimmungen
      </h2>
      <p className="mb-4 tls-type-small text-white/60 max-w-2xl">
        Abstimmen können alle, die angemeldet sind. Deine Stimme siehst nur du – angezeigt werden nur die Zahlen.
      </p>
      <ul className="space-y-4">
        {polls.map((poll) => <PollCard key={poll.id} poll={poll} eventId={event.id} accessToken={accessToken} onSaved={replace} now={now || new Date()} />)}
      </ul>
    </section>
  );
}

export default EventPolls;
