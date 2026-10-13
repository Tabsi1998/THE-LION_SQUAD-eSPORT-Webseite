import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle, Clock, Flag, Trophy, Users, X } from "lucide-react";
import { api, formatRequestError } from "@/lib/api";
import { formatCents } from "@/lib/pricing";
import { initialSelection, playAlongRows, resultSentence, selectionTotal } from "@/lib/playAlong";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";

// „Spielst du auch mit?“ (#1184): nach der Event-Anmeldung die Turniere des Events in einem Schritt. Am Handy ein Blatt
// von unten, ab 640 px mittig. Haken nur bei Einzel-Turnieren; Team-Turniere sagen, dass der Kapitän anmeldet (Kapitäne
// bekommen den Link), Fast Laps brauchen keine Anmeldung. „Anmelden“ legt je Haken eine normale Turnier-Anmeldung an
// (dieselben Regeln, voll → Warteliste); danach steht je Eintrag, was passiert ist. „Nein danke“ beendet ohne Rückfrage.

const RESULT_TONE = {
  registered: "text-[#29B6E8]",
  pending: "text-[#29B6E8]",
  already: "text-[#29B6E8]",
  waitlist: "text-[#FFD700]",
  error: "text-[#FF6B6B]",
};

function ResultIcon({ state }) {
  if (state === "error") return <AlertTriangle className="w-4 h-4 shrink-0 text-[#FF6B6B]" aria-hidden="true" />;
  if (state === "waitlist") return <Clock className="w-4 h-4 shrink-0 text-[#FFD700]" aria-hidden="true" />;
  return <CheckCircle className="w-4 h-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />;
}

function When({ row }) {
  return (
    <span className="w-14 shrink-0 text-center">
      {row.dayLabel ? <span className="block text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">{row.dayLabel}</span> : null}
      <span className="block text-sm font-bold tabular-nums text-white/85">{row.timeLabel || "–"}</span>
    </span>
  );
}

function EntryRow({ row, checked, onToggle }) {
  const Icon = row.kind === "fastlap" ? Flag : row.team ? Users : Trophy;
  const inputId = `play-along-${row.id}`;
  if (row.selectable) {
    return (
      <li>
        <label htmlFor={inputId} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-sm border px-3 py-2.5 transition ${checked ? "border-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 bg-[#121212] hover:border-white/25"}`} data-testid={`play-along-row-${row.id}`}>
          <input id={inputId} type="checkbox" checked={checked} onChange={(ev) => onToggle(row.id, ev.target.checked)} className="h-5 w-5 shrink-0 accent-[#29B6E8]" data-testid={`play-along-check-${row.id}`} />
          <When row={row} />
          <span className="min-w-0 flex-1">
            <span className="block font-heading font-bold leading-tight break-words">{row.title}</span>
            <span className="block text-xs text-white/60 break-words">{row.line}</span>
          </span>
        </label>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 rounded-sm border border-white/10 bg-[#0F0F10] px-3 py-2.5" data-testid={`play-along-row-${row.id}`}>
      <Icon className={`w-5 h-5 shrink-0 ${row.kind === "fastlap" ? "text-[#29B6E8]" : "text-[#FFD700]"}`} aria-hidden="true" />
      <When row={row} />
      <span className="min-w-0 flex-1">
        <span className="block font-heading font-bold leading-tight break-words">{row.title}</span>
        <span className="block text-xs text-white/60 break-words">{row.line}</span>
        <span className={`mt-0.5 block text-xs ${row.my_status ? "text-[#29B6E8] font-bold" : "text-white/70"}`} data-testid={`play-along-note-${row.id}`}>{row.reason}</span>
      </span>
      {row.captain ? (
        <Link to={row.path} className="tls-btn tls-btn--secondary inline-flex min-h-11 shrink-0 items-center px-3 text-[11px] font-bold uppercase tracking-wider rounded-sm" data-testid={`play-along-team-${row.id}`}>Team anmelden</Link>
      ) : null}
    </li>
  );
}

export function PlayAlongSheet({ event, from = "", onClose }) {
  const [entries, setEntries] = useState(null);
  const [selected, setSelected] = useState([]);
  const [acceptRules, setAcceptRules] = useState(false);
  const [acceptCosts, setAcceptCosts] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const { submitting, submitOnce } = useSubmissionGuard();
  const dialogRef = useModalBehavior(Boolean(entries?.length), () => onClose?.());

  useEffect(() => {
    let alive = true;
    api.get(`/events/${event.id}/play-along`).then(({ data }) => {
      if (!alive) return;
      if (!data?.show || !data.entries?.length) {
        onClose?.();
        return;
      }
      setEntries(data.entries);
      setSelected(initialSelection(data.entries, from));
    }).catch(() => { if (alive) onClose?.(); });
    return () => { alive = false; };
  }, [event.id]); // eslint-disable-line react-hooks/exhaustive-deps -- nur beim Öffnen laden

  const rows = useMemo(() => playAlongRows(entries, { multiDay: Boolean(event.schedule?.multi_day) }), [entries, event.schedule?.multi_day]);
  const sum = selectionTotal(entries, selected);
  const needsCosts = sum.total_cents > 0 || sum.waitlistFees > 0;
  const canSubmit = selected.length > 0 && acceptRules && (!needsCosts || acceptCosts) && !submitting;
  const selectable = rows.filter((row) => row.selectable);

  if (!entries?.length) return null;

  const toggle = (id, on) => {
    setError("");
    setSelected((current) => (on ? [...new Set([...current, id])] : current.filter((value) => value !== id)));
  };

  const submit = async (ev) => {
    ev.preventDefault();
    if (!canSubmit) return;
    setError("");
    const attempt = await submitOnce(async () => {
      const { data } = await api.post(`/events/${event.id}/play-along`, {
        tournament_ids: selected, accept_rules: true, accept_privacy: true, accept_costs: acceptCosts,
      });
      setResult(data);
    });
    if (attempt.started && attempt.error) setError(formatRequestError(attempt.error, "Die Anmeldung hat nicht geklappt."));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" data-testid="play-along-backdrop">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="play-along-title"
        aria-describedby="play-along-lead"
        className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-md border border-[#FFD700]/30 bg-[#0A0A0A] shadow-2xl shadow-black/60 focus:outline-none sm:rounded-sm"
        data-testid="play-along-sheet"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">{result ? "Erledigt" : "Du bist beim Event dabei"}</div>
            <h2 id="play-along-title" className="font-heading text-2xl font-black uppercase">{result ? "Deine Turniere" : "Spielst du auch mit?"}</h2>
            <p id="play-along-lead" className="mt-1 text-sm text-white/65">
              {result ? resultSentence(result.results) + "." : "Melde dich gleich für die Turniere an – jedes einzeln, mit denselben Regeln wie auf der Turnierseite."}
            </p>
          </div>
          <button type="button" onClick={() => onClose?.()} aria-label="Schließen" className="shrink-0 p-2 text-white/50 hover:text-white" data-testid="play-along-close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {result ? (
          <div className="overflow-y-auto px-5 py-4" data-testid="play-along-result">
            <ul className="space-y-2">
              {result.results.map((row) => (
                <li key={row.id} className="flex items-start gap-3 rounded-sm border border-white/10 bg-[#121212] px-3 py-2.5" data-testid={`play-along-result-${row.id}`} data-state={row.state}>
                  <ResultIcon state={row.state} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-heading font-bold leading-tight break-words">{row.title || "Turnier"}</span>
                    <span className={`block text-xs font-bold ${RESULT_TONE[row.state] || "text-white/70"}`}>{row.label}{row.price ? ` · ${formatCents(row.price.total_cents, row.price.currency)}` : ""}</span>
                    {row.detail ? <span className="block text-xs text-white/60 break-words">{row.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {result.total_cents > 0 ? (
              <div className="mt-4 rounded-sm border border-[#FFD700]/40 bg-[#FFD700]/5 p-3 text-sm" data-testid="play-along-total">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-white/70">Startgeld gesamt</span>
                  <strong className="font-heading text-xl text-white">{formatCents(result.total_cents, result.currency)}</strong>
                </div>
                <div className="mt-1 text-xs text-white/55">Die Rechnungen kommen wie gewohnt in dein Konto unter <Link to="/account/invoices" className="underline hover:text-white">„Meine Rechnungen“</Link>.</div>
              </div>
            ) : null}
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={() => onClose?.({ done: true })} className="tls-btn tls-btn--primary min-h-11 px-5 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="play-along-done">
                {from ? "Zurück zum Turnier" : "Fertig"}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex min-h-0 flex-col" data-testid="play-along-form">
            <div className="overflow-y-auto px-5 py-4">
              <fieldset>
                <legend className="sr-only">Turniere und Fast Laps beim Event</legend>
                <ul className="space-y-2">
                  {rows.map((row) => <EntryRow key={row.id} row={row} checked={selected.includes(row.id)} onToggle={toggle} />)}
                </ul>
              </fieldset>
              {selectable.length ? (
                <div className="mt-4 space-y-2">
                  {needsCosts ? (
                    <div className="rounded-sm border border-[#FFD700]/40 bg-[#FFD700]/5 p-3 text-sm" data-testid="play-along-sum">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-white/70">Summe Startgeld</span>
                        <strong className="font-heading text-xl text-white">{formatCents(sum.total_cents, sum.currency)}</strong>
                      </div>
                      <div className="mt-1 text-xs text-white/55">Die Rechnungen kommen wie gewohnt unter „Meine Rechnungen“.{sum.waitlistFees ? " Volle Turniere (Warteliste) zahlst du erst, wenn du nachrückst." : ""}</div>
                    </div>
                  ) : null}
                  <label className="flex min-h-11 items-start gap-3 text-sm text-white/80">
                    <input type="checkbox" checked={acceptRules} onChange={(ev) => setAcceptRules(ev.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#29B6E8]" data-testid="play-along-rules" />
                    <span>Ich akzeptiere die Regeln der gewählten Turniere und den <Link to="/privacy" className="underline hover:text-white">Datenschutz</Link>.</span>
                  </label>
                  {needsCosts ? (
                    <label className="flex min-h-11 items-start gap-3 text-sm text-white/80">
                      <input type="checkbox" checked={acceptCosts} onChange={(ev) => setAcceptCosts(ev.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#29B6E8]" data-testid="play-along-costs" />
                      <span>Ich übernehme die Startgelder (Rechnung an mich).</span>
                    </label>
                  ) : null}
                </div>
              ) : null}
              {error ? <div className="mt-3 text-sm font-bold text-[#FF6B6B]" role="alert" data-testid="play-along-error">{error}</div> : null}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-white/10 px-5 py-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => onClose?.()} className="tls-btn tls-btn--quiet min-h-11 px-4 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="play-along-skip">
                Nein danke
              </button>
              {selectable.length ? (
                <button type="submit" disabled={!canSubmit} className="tls-btn tls-btn--primary min-h-11 px-5 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-50" data-testid="play-along-submit">
                  {submitting ? "Melde an …" : selected.length ? `Anmelden (${selected.length})` : "Anmelden"}
                </button>
              ) : null}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
