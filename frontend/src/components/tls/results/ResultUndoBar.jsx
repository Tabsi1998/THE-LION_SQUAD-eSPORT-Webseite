import { useCallback, useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { UNDO_SECONDS } from "@/lib/resultEntry";

// „Rückgängig“ nach dem Speichern (#1156): 10 Sekunden lang unten eine Leiste mit dem Satz und dem Knopf. Der Server
// hält das Ergebnis so lange zurück; danach rückt der Baum weiter und die Seite lädt neu.

export function useResultUndo({ onDone } = {}) {
  const [pending, setPending] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [pending]);

  useEffect(() => {
    if (!pending || now < pending.until) return undefined;
    setPending(null);
    // Der Server veröffentlicht kurz nach Ablauf - dann neu laden, damit Baum und Liste stimmen.
    const reload = setTimeout(() => doneRef.current?.(), 2500);
    return () => clearTimeout(reload);
  }, [now, pending]);

  const start = useCallback(({ matchId, hold, sentence }) => {
    setNow(Date.now());
    setPending({ matchId, holdId: hold?.id || null, sentence, until: Date.now() + UNDO_SECONDS * 1000 });
    doneRef.current?.();
  }, []);

  const undo = useCallback(async () => {
    if (!pending) return;
    const current = pending;
    setPending(null);
    try {
      await api.post(`/matches/${current.matchId}/result/undo`, { hold_id: current.holdId });
      toast.success("Rückgängig gemacht – es ist nichts passiert.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Rückgängig ging nicht.");
    }
    doneRef.current?.();
  }, [pending]);

  const secondsLeft = pending ? Math.max(0, Math.ceil((pending.until - now) / 1000)) : 0;
  return { pending, secondsLeft, start, undo };
}

export function ResultUndoBar({ undo }) {
  if (!undo?.pending) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pointer-events-none" data-testid="result-undo-bar">
      <div className="pointer-events-auto mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-[#29B6E8]/40 bg-[#0F1D23] px-4 py-3 shadow-2xl shadow-black/60" role="status" aria-live="polite">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Gespeichert</div>
          <div className="text-sm text-white/80 truncate" data-testid="result-undo-sentence">{undo.pending.sentence}</div>
        </div>
        <button type="button" onClick={undo.undo} className="tls-btn tls-btn--secondary shrink-0 inline-flex items-center gap-2 min-h-[44px] px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="result-undo">
          <Undo2 className="w-4 h-4" /> Rückgängig ({undo.secondsLeft})
        </button>
      </div>
    </div>
  );
}
