import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCheck } from "lucide-react";
import { REPORT_STATE_TEXT, duelResults, heatResults, rankingMode } from "@/lib/matchReport";
import { slotName } from "@/lib/tournamentLabels";

// Ergebnis melden (#1132): Wer selbst im Spiel steht und melden darf, meldet hier - im Duell, wer gewonnen hat, sonst
// die Plätze, freiwillig mit Spielstand, Beweis-Link und Notiz. Melden beide Seiten dasselbe, steht das Ergebnis fest;
// hat die Gegenseite schon gemeldet, genügt „Ja, stimmt“. Weichen die Meldungen ab, entscheidet die Turnierleitung.

const TONE = {
  waiting: "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#BFE9F8]",
  conflict: "border-[#FF3B30]/40 bg-[#FF3B30]/10 text-[#FFD2CF]",
  confirm: "border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFF2B3]",
};

function valueLabel(mode) {
  if (mode === "time") return "Zeit in ms";
  return mode === "lower_score" ? "Score" : "Punkte";
}

export function MatchReportForm({ participants = [], match = {}, state = null, allowsDraw = false, busy = false, onReport }) {
  const status = state?.status || "open";
  const mode = rankingMode(match);
  const sides = useMemo(() => participants.filter((participant) => participant.registration_id), [participants]);
  const isDuel = sides.length === 2;
  const [editing, setEditing] = useState(status === "open");
  const [winner, setWinner] = useState("");
  const [values, setValues] = useState({});
  const [rows, setRows] = useState(() => sides.map((side, index) => ({ registration_id: side.registration_id, rank: String(index + 1), value: "" })));
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // Ein neuer Stand vom Server (gemeldet, bestätigt, abgewichen) schließt das Formular - außer, es ist noch nichts da.
  useEffect(() => { setEditing(status === "open"); }, [status]);

  const nameOf = (participant) => slotName(participant?.display_name, participant, match);

  const submit = async (event) => {
    event.preventDefault();
    const outcome = isDuel ? duelResults({ sides: sides.map((side) => side.registration_id), winner, values, mode }) : heatResults(rows, mode);
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    setError("");
    const done = await onReport({ results: outcome.results, screenshot_url: proofUrl.trim() || null, note: note.trim() || null });
    if (done) {
      setProofUrl("");
      setNote("");
    }
  };

  return (
    <div className="space-y-4" data-testid="match-report">
      <div className="text-xs text-[#29B6E8] font-bold uppercase tracking-wider flex items-center gap-2"><ClipboardCheck className="w-3.5 h-3.5" /> Ergebnis melden</div>

      {status !== "open" && status !== "agreed" && (
        <div className={`rounded-sm border px-4 py-3 text-sm ${TONE[status] || TONE.waiting}`} data-testid="match-report-state" data-status={status}>
          <p className="font-bold">{REPORT_STATE_TEXT[status]}</p>
          {status === "confirm" && state?.proposal_summary && <p className="mt-1">Die Gegenseite meldet: <strong>{state.proposal_summary}</strong></p>}
          {status !== "confirm" && state?.own_summary && <p className="mt-1">Deine Meldung: <strong>{state.own_summary}</strong></p>}
          {status === "confirm" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => onReport({ results: state.proposal, screenshot_url: null, note: null })} className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-report-confirm">
                <Check className="w-3.5 h-3.5" /> Ja, stimmt
              </button>
              {!editing && (
                <button type="button" onClick={() => setEditing(true)} className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="match-report-differs">Nein, anderes Ergebnis</button>
              )}
            </div>
          )}
          {(status === "waiting" || status === "conflict") && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="mt-2 text-xs font-bold uppercase tracking-wider underline underline-offset-2 hover:text-white" data-testid="match-report-change">Meldung ändern</button>
          )}
        </div>
      )}

      {editing && (
        <form onSubmit={submit} className="space-y-4" data-testid="match-report-form" noValidate>
          {isDuel ? (
            <>
              <fieldset>
                <legend className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Wer hat gewonnen?</legend>
                <div className="flex flex-wrap gap-2">
                  {sides.map((side) => (
                    <button
                      key={side.registration_id}
                      type="button"
                      aria-pressed={winner === side.registration_id}
                      onClick={() => setWinner(side.registration_id)}
                      className={`rounded-sm border px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${winner === side.registration_id ? "border-[#29B6E8]/70 bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/10 bg-white/5 text-white/70 hover:border-[#29B6E8]/45"}`}
                      data-testid={`match-report-winner-${side.registration_id}`}
                    >
                      {nameOf(side)}
                    </button>
                  ))}
                  {allowsDraw && (
                    <button type="button" aria-pressed={winner === "draw"} onClick={() => setWinner("draw")} className={`rounded-sm border px-3 py-2 text-xs font-bold uppercase tracking-wider transition ${winner === "draw" ? "border-[#FFD700]/70 bg-[#FFD700]/15 text-[#FFD700]" : "border-white/10 bg-white/5 text-white/70 hover:border-[#FFD700]/45"}`} data-testid="match-report-draw">
                      Unentschieden
                    </button>
                  )}
                </div>
              </fieldset>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Spielstand (freiwillig)</div>
                <div className="grid grid-cols-2 gap-3">
                  {sides.map((side) => (
                    <label key={side.registration_id} className="block min-w-0">
                      <span className="block text-xs text-white/55 truncate mb-1">{valueLabel(mode)} {nameOf(side)}</span>
                      <input inputMode="decimal" value={values[side.registration_id] || ""} onChange={(e) => setValues((current) => ({ ...current, [side.registration_id]: e.target.value }))} className="input text-center font-display text-xl font-bold" data-testid={`match-report-value-${side.registration_id}`} />
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-3">
              {rows.map((row, index) => (
                <div key={row.registration_id} className="grid grid-cols-[minmax(0,1fr)_5rem_7rem] gap-2 items-end border border-white/10 bg-[#0A0A0A] rounded-sm p-3">
                  <div className="font-heading font-bold uppercase truncate">{nameOf(sides.find((side) => side.registration_id === row.registration_id))}</div>
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-widest text-white/45 mb-1">Platz</span>
                    <input inputMode="numeric" value={row.rank} onChange={(e) => setRows((current) => current.map((item, i) => (i === index ? { ...item, rank: e.target.value } : item)))} className="input text-center font-bold" data-testid={`match-report-rank-${row.registration_id}`} />
                  </label>
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-widest text-white/45 mb-1">{valueLabel(mode)}</span>
                    <input inputMode="decimal" value={row.value} onChange={(e) => setRows((current) => current.map((item, i) => (i === index ? { ...item, value: e.target.value } : item)))} className="input text-center font-bold" />
                  </label>
                </div>
              ))}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            <input type="url" value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} className="input" placeholder="Screenshot-/Beweis-Link (freiwillig)" />
            <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="Notiz für die Turnierleitung (freiwillig)" />
          </div>
          {error && <p className="text-sm text-[#FF6B60]" role="alert" data-testid="match-report-error">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={busy} className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-report-submit">Ergebnis melden</button>
            <p className="text-xs text-white/50">Meldet die Gegenseite dasselbe, steht das Ergebnis fest. Weicht es ab, entscheidet die Turnierleitung.</p>
          </div>
        </form>
      )}
    </div>
  );
}
