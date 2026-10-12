import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { HEAT_MODES, HEAT_MODE_KEY, initialState, inputKind, resultSentence, resultsFor, tapGame } from "@/lib/resultEntry";
import { BestOfInput, OrderInput, PointsInput, ScoreInput, WinnerInput } from "@/components/tls/results/ResultInputs";

// Das eine Ergebnis-Fenster (#1156, #1370): Turnierleitung am Handy, Matchplan, Stationen und Matchseite öffnen es -
// dieselben Felder, dieselben Wörter („Nicht erschienen“, „Aufgegeben“), derselbe Satz vor dem Speichern und danach
// dasselbe „Rückgängig“. Am Handy und Tablet ein Blatt von unten, am PC ein Fenster in der Mitte.
//
// Gespeichert wird immer über POST /matches/{id}/result mit `hold: true`: der Server hält das Ergebnis 10 Sekunden
// zurück. Ein fertiges Ergebnis zu ändern ist eine Korrektur - mit Grund, der im Protokoll steht.

function readHeatMode() {
  try {
    return window.localStorage.getItem(HEAT_MODE_KEY) === "points" ? "points" : "order";
  } catch {
    return "order";
  }
}

function rememberHeatMode(mode) {
  try {
    window.localStorage.setItem(HEAT_MODE_KEY, mode);
  } catch {
    // Ohne Speicher gilt beim nächsten Mal wieder „Reihenfolge“.
  }
}

export function ResultWindow({ entry, onClose, onSaved, testId = "result-window" }) {
  const correcting = Boolean(entry?.has_result);
  const [heatMode, setHeatMode] = useState(readHeatMode);
  const [state, setState] = useState(() => initialState(entry));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef(null);
  const kind = inputKind(entry, heatMode);
  const outcome = useMemo(() => resultsFor(entry, kind, state), [entry, kind, state]);
  const sentence = outcome.results ? resultSentence(entry, outcome.results) : "";

  useEffect(() => {
    setState(initialState(entry));
    setReason("");
    setError("");
  }, [entry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  if (!entry) return null;

  const chooseHeatMode = (mode) => {
    setHeatMode(mode);
    rememberHeatMode(mode);
  };

  const save = async () => {
    if (outcome.error) {
      setError(outcome.error);
      return;
    }
    if (correcting && reason.trim().length < 5) {
      setError("Bitte kurz den Grund der Korrektur angeben (mindestens 5 Zeichen).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/matches/${entry.id}/result${correcting ? "?force=true" : ""}`, {
        results: outcome.results,
        hold: true,
        reason: correcting ? reason.trim() : null,
      });
      onSaved?.({ matchId: entry.id, hold: data?.hold || null, sentence });
      onClose?.();
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail) || "Ergebnis konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  };

  const meta = [entry.label, entry.station_text, entry.kind === "duel" && Number(entry.best_of) > 1 ? `Best of ${entry.best_of}` : null].filter(Boolean).join(" · ");

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-end xl:items-center justify-center bg-black/70 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}
      data-testid={`${testId}-backdrop`}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={correcting ? "Ergebnis korrigieren" : "Ergebnis eintragen"}
        data-testid={testId}
        data-kind={kind}
        className="w-full xl:max-w-xl max-h-[92vh] overflow-y-auto rounded-t-xl xl:rounded-xl border border-white/10 bg-[#0F0F10] shadow-2xl shadow-black/60 outline-none"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-[#0F0F10] px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#29B6E8] truncate">{meta}</div>
            <h2 className="font-heading text-xl font-black uppercase">{correcting ? "Ergebnis korrigieren" : "Ergebnis eintragen"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="shrink-0 p-2 text-white/50 hover:text-white" data-testid={`${testId}-close`}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 px-4 py-4">
          {entry.kind !== "duel" && entry.ranking_mode !== "time" ? (
            <div className="grid grid-cols-2 gap-1 rounded-sm border border-white/10 bg-white/5 p-1" role="group" aria-label="Eingabe bei Durchgängen" data-testid="result-heat-mode">
              {HEAT_MODES.map(([mode, label]) => (
                <button key={mode} type="button" aria-pressed={heatMode === mode} onClick={() => chooseHeatMode(mode)} className={`min-h-[40px] rounded-sm text-xs font-bold uppercase tracking-wider ${heatMode === mode ? "bg-[#29B6E8] text-black" : "text-white/60"}`} data-testid={`result-heat-mode-${mode}`}>
                  {mode === "order" ? "Reihenfolge antippen" : `${label} eintragen`}
                </button>
              ))}
            </div>
          ) : null}

          {kind === "score" && <ScoreInput entry={entry} state={state} onChange={setState} />}
          {kind === "bestof" && (
            <BestOfInput
              entry={entry}
              state={state}
              onChange={setState}
              onTap={(index, winner) => setState((current) => ({ ...current, games: tapGame(current.games, index, winner, { sides: current.sides, bestOf: entry.best_of }) }))}
            />
          )}
          {kind === "winner" && <WinnerInput entry={entry} state={state} onChange={setState} />}
          {kind === "order" && <OrderInput entry={entry} state={state} onChange={setState} />}
          {kind === "points" && <PointsInput entry={entry} state={state} onChange={setState} />}

          {correcting ? (
            <label className="block">
              <span className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Grund der Korrektur (steht im Protokoll)</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} className="input" placeholder="z. B. Stand falsch abgelesen" data-testid="result-reason" />
            </label>
          ) : null}

          <p className={`rounded-sm border px-3 py-2 text-sm font-bold ${sentence ? "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#BFE9F8]" : "border-white/10 bg-white/5 text-white/45"}`} data-testid="result-sentence" aria-live="polite">
            {sentence ? `${correcting ? "Neu: " : ""}${sentence}` : outcome.error || "Noch kein Ergebnis gewählt."}
          </p>
          {error ? <p className="text-sm text-[#FF6B60]" role="alert" data-testid="result-error">{error}</p> : null}
        </div>

        <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-white/10 bg-[#0F0F10] px-4 py-3">
          <button type="button" onClick={save} disabled={busy} className="tls-btn tls-btn--primary flex-1 min-h-[48px] px-4 py-3 rounded-sm text-sm uppercase tracking-wider font-bold disabled:opacity-50" data-testid="result-save">
            {busy ? "Speichert …" : correcting ? "Korrektur speichern" : "Ergebnis speichern"}
          </button>
          <p className="w-full text-xs text-white/45">Danach 10 Sekunden „Rückgängig“ – erst dann rückt der Baum weiter und die Spieler bekommen Bescheid.</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Das Ergebnis-Fenster für Stellen, die nur die Kennung des Spiels kennen (Matchplan, Stationen, #1370): die
 * Beschreibung kommt von der Matchseite (`result_entry`, nur mit Ergebnis-Recht) - so sind Felder, Wörter und Satz
 * überall dieselben.
 */
export function ResultWindowLoader({ matchId, onClose, onSaved, testId = "result-window" }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setEntry(null);
    setError("");
    api.get(`/matches/${matchId}/page`)
      .then(({ data }) => {
        if (!alive) return;
        if (data?.result_entry) setEntry(data.result_entry);
        else setError("Für dieses Spiel kannst du kein Ergebnis eintragen.");
      })
      .catch((err) => { if (alive) setError(formatApiError(err.response?.data?.detail) || "Spiel konnte nicht geladen werden."); });
    return () => { alive = false; };
  }, [matchId]);

  if (entry) return <ResultWindow entry={entry} onClose={onClose} onSaved={onSaved} testId={testId} />;
  return (
    <div role="presentation" className="fixed inset-0 z-50 flex items-end xl:items-center justify-center bg-black/70" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }} data-testid={`${testId}-loading`}>
      <div className="w-full xl:max-w-xl rounded-t-xl xl:rounded-xl border border-white/10 bg-[#0F0F10] p-6 text-center text-sm text-white/60">
        {error ? <span className="text-[#FF6B60]" role="alert">{error}</span> : "Wird geladen …"}
        <div className="mt-4"><button type="button" onClick={onClose} className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">Schließen</button></div>
      </div>
    </div>
  );
}
