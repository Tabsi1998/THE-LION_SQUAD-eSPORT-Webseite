import { useMemo, useState } from "react";
import { Check, ClipboardCheck, X } from "lucide-react";
import { chatAttachmentSrc } from "@/lib/chatAttachments";
import { viennaDateTime } from "@/lib/vienna";
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

function clock(value) {
  try {
    return value ? viennaDateTime(value, { hour: "2-digit", minute: "2-digit" }) : "";
  } catch {
    return "";
  }
}

// `readOnly`: Team-Mitglieder ohne Leitung sehen die Meldung der Gegenseite, bestätigen kann die Teamleitung (#1159).
// `onWrongResult`: „Stimmt nicht“ öffnet „Problem melden“ mit „Falsches Ergebnis“ (#1158).
export function MatchReportForm({ participants = [], match = {}, entry: serverEntry = null, state = null, allowsDraw = false, busy = false, readOnly = false, onReport, onWrongResult }) {
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
  // Abgeleitet beim Rendern statt in einem Effekt: der Effekt lief auch beim ersten Aufbau und konnte, wenn er spät kam,
  // ein schnelles „Meldung ändern“ gleich wieder schließen.
  const [seenStatus, setSeenStatus] = useState(status);
  if (seenStatus !== status) {
    setSeenStatus(status);
    setEditing(status === "open");
  }

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
          {/* Bestätigen mit einem Tipp (#1159): die Meldung der Gegenseite in Worten, von wem und wann, mit Foto. */}
          {status === "confirm" && (state?.proposal_text || state?.proposal_summary) && (
            <p className="mt-1 text-base font-bold text-white" data-testid="match-report-proposal">{state.proposal_text || `Die Gegenseite meldet: ${state.proposal_summary}`}</p>
          )}
          {status === "confirm" && state?.proposal_by && <p className="mt-0.5 text-xs opacity-80">gemeldet von {state.proposal_by}{state.proposal_at ? ` um ${clock(state.proposal_at)}` : ""}</p>}
          {status === "confirm" && state?.proposal_photo?.url && (
            <a href={chatAttachmentSrc(state.proposal_photo.url)} target="_blank" rel="noreferrer" className="mt-2 block w-32 overflow-hidden rounded-sm border border-white/15" data-testid="match-report-proposal-photo">
              <img src={chatAttachmentSrc(state.proposal_photo.url, 400)} alt="Foto der Gegenseite" className="h-20 w-full object-cover" />
            </a>
          )}
          {status !== "confirm" && state?.own_summary && <p className="mt-1">Deine Meldung: <strong>{state.own_summary}</strong></p>}
          {/* Das eigene Foto nach dem Senden (#2124, TP5) - erst nach der Bildprüfung liefert der Server es aus. */}
          {status !== "confirm" && state?.own_photo?.url && (
            <a href={chatAttachmentSrc(state.own_photo.url)} target="_blank" rel="noreferrer" className="mt-2 block w-32 overflow-hidden rounded-sm border border-white/15" data-testid="match-report-own-photo">
              <img src={chatAttachmentSrc(state.own_photo.url, 400)} alt="Dein Foto zur Meldung" width={128} height={80} className="h-20 w-full object-cover" />
            </a>
          )}
          {status === "confirm" && (readOnly || state?.can_confirm === false ? (
            <p className="mt-2 text-xs opacity-80" data-testid="match-report-lead-confirms">Bestätigen kann die Teamleitung.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <button type="button" disabled={busy} onClick={() => onReport({ results: state.proposal, screenshot_url: null, note: null })} className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-report-confirm">
                <Check className="w-3.5 h-3.5" /> Stimmt
              </button>
              <button type="button" disabled={busy} onClick={() => onWrongResult?.()} className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center justify-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-50" data-testid="match-report-wrong">
                <X className="w-3.5 h-3.5" /> Stimmt nicht
              </button>
            </div>
          ))}
          {(status === "waiting" || status === "conflict") && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="mt-2 text-xs font-bold uppercase tracking-wider underline underline-offset-2 hover:text-white" data-testid="match-report-change">Meldung ändern</button>
          )}
        </div>
      )}

      {editing && !readOnly && (
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
