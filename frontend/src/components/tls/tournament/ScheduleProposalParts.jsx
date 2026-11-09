// Terminabstimmung auf der Matchseite (#2110, #2325): bis zu drei Termine auf einmal vorschlagen, die Vorschläge der
// Gegenseite als Liste mit „Annehmen“ je Termin, „Alle ablehnen“ und Gegenvorschlag (ebenfalls bis zu drei Termine).
import { useId, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import {
  MAX_PROPOSAL_TIMES,
  bundleProposals,
  isOwnProposal,
  proposeButtonLabel,
  proposalStatusLabel,
} from "@/lib/scheduleProposals";
import { shortWhen } from "@/lib/leagueSchedule";

const ROW_BUTTON = "tls-btn min-h-11 min-w-11 inline-flex items-center justify-center rounded-sm disabled:opacity-50";
// Annehmen in Grün, Ablehnen rot wie jeder gefährliche Knopf - ohne `tls-btn--quiet`, dessen Grau die Farbe sonst überdeckt.
const ACCEPT = "border border-[#00D26A]/45 text-[#00D26A] hover:bg-[#00D26A]/10";
const DECLINE = "tls-btn--danger";
// Zur Auswahl mit Wochentag: „Do 12.11. 20:00 Uhr“ - so vergleicht man Tage auf einen Blick.
const dayTime = (value) => (value ? `${shortWhen(value)} Uhr` : "ohne Zeit");
const TEXT_BUTTON = "tls-btn shrink-0 min-h-11 px-3 py-2 rounded-sm text-[10px] uppercase tracking-wider font-bold disabled:opacity-50";

/**
 * Ein bis drei Felder für Datum und Uhrzeit, jedes mit eigenem Fehler. „+ weiteren Termin“ fügt eins hinzu, das X entfernt
 * eins (das letzte bleibt). Das erste Feld trägt `testId`, die weiteren `testId-2`, `testId-3`.
 */
export function ProposalTimesEditor({ values, onChange, errors = [], hints = [], min, label = "Termin", testId, disabled = false }) {
  const baseId = useId();
  const update = (index, value) => onChange(values.map((current, at) => (at === index ? value : current)));
  const remove = (index) => onChange(values.filter((_, at) => at !== index));
  const add = () => onChange([...values, ""]);
  const many = values.length > 1;
  return (
    <div className="space-y-2" data-testid={testId ? `${testId}-list` : undefined}>
      {values.map((value, index) => {
        const error = errors[index];
        // Ein Hinweis hält nichts auf (Spielwoche) - er steht nur, solange kein Fehler da ist.
        const hint = error ? null : hints[index];
        const errorId = `${baseId}-fehler-${index}`;
        const hintId = `${baseId}-hinweis-${index}`;
        const name = many ? `${label} ${index + 1}` : label;
        return (
          // Die Stelle ist die Kennung: die Felder haben keine eigene, die Werte stehen im Zustand.
          <div key={index}>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                min={min}
                value={value}
                disabled={disabled}
                onChange={(event) => update(index, event.target.value)}
                aria-label={`${name}: Datum und Uhrzeit`}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : hint ? hintId : undefined}
                className={`input min-w-0 flex-1 ${error ? "border-warn focus:border-warn" : ""}`}
                data-testid={index === 0 ? testId : `${testId}-${index + 1}`}
              />
              {many && (
                <button type="button" onClick={() => remove(index)} disabled={disabled} aria-label={`${name} entfernen`} title="Entfernen"
                  data-testid={`${testId}-entfernen-${index + 1}`} className={`${ROW_BUTTON} border border-white/15 text-white/60 hover:text-white`}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {error && <p id={errorId} role="alert" className="mt-1 text-xs text-warn [overflow-wrap:anywhere]" data-testid={`${testId}-fehler-${index + 1}`}>{error}</p>}
            {hint && <p id={hintId} className="mt-1 text-xs text-white/60 [overflow-wrap:anywhere]" data-testid={`${testId}-hinweis-${index + 1}`}>{hint}</p>}
          </div>
        );
      })}
      {values.length < MAX_PROPOSAL_TIMES && (
        <button type="button" onClick={add} disabled={disabled} data-testid={`${testId}-weiter`}
          className="tls-btn min-h-11 w-full inline-flex items-center justify-center gap-1.5 rounded-sm border border-dashed border-white/20 px-3 text-xs font-bold text-[#29B6E8] hover:border-[#29B6E8]/60 hover:text-white disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> weiteren Termin
        </button>
      )}
    </div>
  );
}

/** Gegenvorschlag zu einem Vorschlag oder einer ganzen Gruppe: bis zu drei Termine, eine Antwort, ein Knopf. */
function CounterForm({ bundleKey, min, busy, onCounter, onClose, initial, hintsFor }) {
  const [times, setTimes] = useState([initial || ""]);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const change = (next) => {
    setTimes(next);
    setErrors([]);
  };
  const submit = async () => {
    const result = await onCounter(times, note);
    if (result?.errors) setErrors(result.errors);
    if (result?.ok) onClose();
  };
  return (
    <div className="mt-3 border-t border-white/10 pt-3 space-y-3" data-testid={`match-counter-${bundleKey}`}>
      <p className="text-xs text-white/55">Euer Gegenvorschlag – bis zu {MAX_PROPOSAL_TIMES} Termine.</p>
      <ProposalTimesEditor values={times} onChange={change} errors={errors} hints={hintsFor ? hintsFor(times) : []} min={min} label="Gegenvorschlag" testId={`match-counter-at-${bundleKey}`} disabled={busy} />
      <input aria-label="Antwort oder Grund" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="input" placeholder="Antwort / Grund (optional)" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={submit} data-testid={`match-counter-send-${bundleKey}`} className="tls-btn tls-btn--secondary min-h-11 px-3 py-2 rounded-sm text-[10px] uppercase tracking-wider font-bold disabled:opacity-50">{proposeButtonLabel(times.length, true)}</button>
        <button type="button" disabled={busy} onClick={onClose} className={`${TEXT_BUTTON} tls-btn--quiet`}>Abbrechen</button>
      </div>
    </div>
  );
}

function actorName(proposal) {
  return proposal?.actor?.display_name || proposal?.actor?.username || "Teilnehmer";
}

/**
 * Alle Vorschläge des Spiels: offene einer Gruppe als eine Karte (#2325), alles andere wie bisher je Zeile.
 * `onDecide(proposal, action)` für annehmen, ablehnen und zurückziehen eines einzelnen; `onGroupDecide(proposal, action)` für
 * alle ablehnen und alle zurückziehen; `onCounter(proposal, times, note)` mit Antwort `{ ok, errors }`.
 */
export function ScheduleProposalList({ proposals, page, userId, canManage, fixedTime, busy, min, formatDateTime, onDecide, onGroupDecide, onCounter, toLocal, hintsFor }) {
  const [counterFor, setCounterFor] = useState(null);
  const bundles = bundleProposals(proposals);
  return bundles.map((bundle) => {
    const first = bundle.proposals[0];
    const open = first?.status === "pending";
    // Der eigene Vorschlag (#2110): annehmen oder ablehnen kann nur die Gegenseite - hier „Zurückziehen“.
    const own = open && isOwnProposal(first, page, userId);
    const answer = canManage && open && !own;
    // Fester Termin (#2194): ein alter Vorschlag lässt sich nur noch ablehnen - Annehmen und Gegenvorschlag gehen über die Verschiebung.
    const agree = answer && !fixedTime;
    const counterOpen = agree && counterFor === bundle.key;
    const counter = agree && (
      counterOpen ? (
        <CounterForm bundleKey={bundle.key} min={min} busy={busy} initial={toLocal?.(first.scheduled_at)} onClose={() => setCounterFor(null)} hintsFor={hintsFor}
          onCounter={(times, note) => onCounter(first, times, note)} />
      ) : null
    );
    const counterToggle = agree && !counterOpen && (
      <button type="button" disabled={busy} onClick={() => setCounterFor(bundle.key)} aria-expanded="false"
        data-testid={`match-counter-open-${bundle.key}`} className={`${TEXT_BUTTON} tls-btn--secondary`}>Gegenvorschlag</button>
    );
    if (bundle.group) {
      const count = bundle.proposals.length;
      return (
        <div key={bundle.key} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3" data-testid={`match-proposal-group-${bundle.groupId}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-bold">{own ? `${count} Termine vorgeschlagen` : `${count} Termine zur Auswahl`}</div>
              <div className="text-xs text-white/45 mt-1 [overflow-wrap:anywhere]" data-testid={`match-proposal-group-status-${bundle.groupId}`}>
                {actorName(first)} · {own ? "wartet auf die Gegenseite" : `${first.kind === "counter" ? "Gegenvorschlag – " : ""}${answer ? "einen annehmen" : "offen"}`}
              </div>
              {first.note && <div className="text-xs text-white/60 mt-2 [overflow-wrap:anywhere]">{first.note}</div>}
            </div>
            {own && canManage && (
              <button type="button" disabled={busy} onClick={() => onGroupDecide(first, "withdraw")} data-testid={`match-proposal-group-withdraw-${bundle.groupId}`} className={`${TEXT_BUTTON} tls-btn--quiet`}>Zurückziehen</button>
            )}
          </div>
          <ul className="mt-3 space-y-2">
            {bundle.proposals.map((proposal) => (
              <li key={proposal.id} className="flex items-center justify-between gap-3 rounded-sm border border-white/10 bg-[#121212] px-3 py-1.5 min-h-11" data-testid={`match-proposal-${proposal.id}`}>
                <span className="text-sm font-bold min-w-0 [overflow-wrap:anywhere]">{dayTime(proposal.scheduled_at)}</span>
                {agree && (
                  <button type="button" disabled={busy} onClick={() => onDecide(proposal, "accept")} aria-label={`${dayTime(proposal.scheduled_at)} annehmen`}
                    data-testid={`match-proposal-accept-${proposal.id}`}
                    className={`tls-btn shrink-0 min-h-11 px-3 inline-flex items-center gap-1.5 rounded-sm text-[10px] uppercase tracking-wider font-bold disabled:opacity-50 ${ACCEPT}`}>
                    <Check className="w-3.5 h-3.5" aria-hidden="true" /> Annehmen
                  </button>
                )}
              </li>
            ))}
          </ul>
          {answer && (
            <div className="mt-3 flex flex-wrap gap-2">
              {counterToggle}
              <button type="button" disabled={busy} onClick={() => onGroupDecide(first, "decline")} data-testid={`match-proposal-group-decline-${bundle.groupId}`}
                className={`${TEXT_BUTTON} tls-btn--danger`}>Alle ablehnen</button>
            </div>
          )}
          {counter}
        </div>
      );
    }
    const p = first;
    // Wer nicht zum Spiel gehört, bekommt keine Kennung (#2201) - dann zählt die Stelle in der Liste.
    const rowId = bundle.key;
    return (
      <div key={rowId} className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3" data-testid={`match-proposal-${rowId}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-bold">{formatDateTime(p.scheduled_at)}</div>
            <div className="text-xs text-white/45 mt-1 [overflow-wrap:anywhere]" data-testid={`match-proposal-status-${rowId}`}>{actorName(p)} · {own ? "wartet auf die Gegenseite" : proposalStatusLabel(p)}</div>
            {p.note && <div className="text-xs text-white/60 mt-2 [overflow-wrap:anywhere]">{p.note}</div>}
          </div>
          {answer && (
            <div className="flex gap-1 shrink-0">
              {agree && <button type="button" disabled={busy} onClick={() => onDecide(p, "accept")} aria-label="Termin annehmen" title="Annehmen" data-testid={`match-proposal-accept-${p.id}`} className={`${ROW_BUTTON} ${ACCEPT}`}><Check className="w-3.5 h-3.5" /></button>}
              <button type="button" disabled={busy} onClick={() => onDecide(p, "decline")} aria-label="Termin ablehnen" title="Ablehnen" data-testid={`match-proposal-decline-${p.id}`} className={`${ROW_BUTTON} ${DECLINE}`}><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {own && canManage && (
            <button type="button" disabled={busy} onClick={() => onDecide(p, "withdraw")} data-testid={`match-proposal-withdraw-${p.id}`} className={`${TEXT_BUTTON} tls-btn--quiet`}>Zurückziehen</button>
          )}
        </div>
        {counterToggle && <div className="mt-3">{counterToggle}</div>}
        {counter}
      </div>
    );
  });
}
