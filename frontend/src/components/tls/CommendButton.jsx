import { useCallback, useEffect, useState } from "react";
import { HeartHandshake } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// GG (#616): nach einem Match lobt eine Seite die andere - einmal je Match, nur Beteiligte, nur nach dem
// Ende. Zählt für „Fair Play“ (bekommen) und „Guter Verlierer“ (gegeben); wer wem, sieht niemand.

export function CommendButton({ matchId, completed }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!matchId || !completed) return;
    try {
      const { data } = await api.get(`/matches/${matchId}/commend`, { skipInvalidation: true });
      setState(data);
    } catch {
      setState(null);
    }
  }, [matchId, completed]);
  useEffect(() => { load(); }, [load]);

  if (!completed || !state?.participant) return null;
  const give = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post(`/matches/${matchId}/commend`);
      setState(data);
      toast.success(data.already ? "Du hast schon GG gegeben." : "GG! Danke fürs faire Spiel.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };
  if (state.given) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm border border-[#00FF88]/30 bg-[#00FF88]/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#00FF88]" data-testid="commend-given">
        <HeartHandshake className="w-3.5 h-3.5" /> GG gegeben
      </span>
    );
  }
  if (!state.can_commend) return null;
  return (
    <button type="button" onClick={give} disabled={busy} data-testid="commend-button" className="inline-flex items-center gap-1.5 rounded-sm border border-[#00FF88]/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#00FF88] hover:bg-[#00FF88]/10 transition disabled:opacity-50">
      <HeartHandshake className="w-3.5 h-3.5" /> GG geben
    </button>
  );
}
