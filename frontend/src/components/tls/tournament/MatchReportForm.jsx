import { useEffect, useMemo, useState } from "react";
import { Check, ClipboardCheck } from "lucide-react";
import { REPORT_STATE_TEXT, rankingMode } from "@/lib/matchReport";
import { initialState, inputKind, resultSentence, resultsFor, tapGame } from "@/lib/resultEntry";
import { BestOfInput, OrderInput, ScoreInput, WinnerInput } from "@/components/tls/results/ResultInputs";
import { ProofPhotoPicker } from "@/components/tls/results/ProofPhotoPicker";

// Ergebnis melden (#1132, #1157): Wer im Spiel steht und melden darf, meldet hier - mit denselben großen Knöpfen wie
// das Ergebnis-Fenster der Turnierleitung (#1156): Plus/Minus je Seite, bei Best-of je Spiel den Sieger antippen, bei
// Durchgängen die Zielreihenfolge. Dazu auf Wunsch ein Foto vom Ergebnis. Vor dem Absenden steht der Satz in Worten.
// Melden beide Seiten dasselbe, steht das Ergebnis fest; hat die Gegenseite schon gemeldet, genügt „Ja, stimmt“.

const TONE = {
  waiting: "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#BFE9F8]",
  conflict: "border-[#FF3B30]/40 bg-[#FF3B30]/10 text-[#FFD2CF]",
  confirm: "border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFF2B3]",
};

/** Ohne Beschreibung vom Server: aus den Teilnehmern der Matchseite. */
function fallbackEntry(participants, match, allowsDraw) {
  const sides = participants.filter((participant) => participant.registration_id);
  return {
    id: match?.id,
    kind: sides.length === 2 ? "duel" : "heat",
    best_of: 1,
    ranking_mode: rankingMode(match),
    allows_draw: allowsDraw,
    participants: sides.map((side) => ({ registration_id: side.registration_id, name: side.display_name || "Teilnehmer" })),
    advance: {},
  };
}

export function MatchReportForm({ participants = [], match = {}, entry: serverEntry = null, state = null, allowsDraw = false, busy = false, onReport }) {
  const status = state?.status || "open";
  const entry = useMemo(() => serverEntry || fallbackEntry(participants, match, allowsDraw), [serverEntry, participants, match, allowsDraw]);
  const kind = inputKind(entry, "order");
  const [editing, setEditing] = useState(status === "open");
  const [form, setForm] = useState(() => initialState({ ...entry, result: [] }));
  const [photo, setPhoto] = useState(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const outcome = resultsFor(entry, kind, form);
  const sentence = outcome.results ? resultSentence({ ...entry, advance: {} }, outcome.results) : "";

  // Ein neuer Stand vom Server (gemeldet, bestätigt, abgewichen) schließt das Formular - außer, es ist noch nichts da.
  useEffect(() => { setEditing(status === "open"); }, [status]);

  const submit = async (event) => {
    event.preventDefault();
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    if (photo?.status === "uploading") {
      setError("Das Foto wird noch hochgeladen – einen Moment.");
      return;
    }
    setError("");
    const done = await onReport({ results: outcome.results, screenshot_url: null, note: note.trim() || null, photo_id: photo?.status === "ready" ? photo.id : null });
    if (done) {
      setPhoto(null);
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
          {kind === "score" && <ScoreInput entry={entry} state={form} onChange={setForm} showFlags={false} />}
          {kind === "bestof" && (
            <BestOfInput
              entry={entry}
              state={form}
              onChange={setForm}
              showFlags={false}
              onTap={(index, winner) => setForm((current) => ({ ...current, games: tapGame(current.games, index, winner, { sides: current.sides, bestOf: entry.best_of }) }))}
            />
          )}
          {kind === "winner" && <WinnerInput entry={entry} state={form} onChange={setForm} showFlags={false} />}
          {kind === "order" && <OrderInput entry={entry} state={form} onChange={setForm} showFlags={false} />}

          <ProofPhotoPicker matchId={match.id} value={photo} onChange={setPhoto} />
          <input value={note} onChange={(e) => setNote(e.target.value)} className="input" placeholder="Notiz für die Turnierleitung (freiwillig)" data-testid="match-report-note" />
          <p className={`rounded-sm border px-3 py-2 text-sm font-bold ${sentence ? "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#BFE9F8]" : "border-white/10 bg-white/5 text-white/45"}`} data-testid="match-report-sentence">
            {sentence || outcome.error}
          </p>
          {error && <p className="text-sm text-[#FF6B60]" role="alert" data-testid="match-report-error">{error}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={busy} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-report-submit">Ergebnis melden</button>
            <p className="text-xs text-white/50">Meldet die Gegenseite dasselbe, steht das Ergebnis fest. Weicht es ab, entscheidet die Turnierleitung.</p>
          </div>
        </form>
      )}
    </div>
  );
}
