import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Erfolge sofort (#301): Ereignisse stellen die Betroffenen in eine Warteschlange, ein Job
// arbeitet sie alle 30 Sekunden ab. Hier sieht man den Stand - und kann alle vormerken.

function when(value) {
  return value ? new Date(value).toLocaleString("de-DE") : "noch nie";
}

export function EvaluationPanel() {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get("/admin/achievements/evaluation").then(({ data }) => setState(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const evaluateAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/admin/achievements/evaluation/all");
      toast.success(`${data.queued} Konten vorgemerkt – die Auswertung läuft im Hintergrund.`);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border border-white/10 bg-[#121212] rounded-sm p-4 flex flex-col md:flex-row md:items-center gap-3" data-testid="ach-evaluation">
      <div className="text-xs text-white/60 flex-1">
        <div className="font-bold uppercase tracking-widest text-white/80 mb-1">Auswertung</div>
        Erfolge werden vergeben, sobald etwas passiert (Ergebnis, Turnierabschluss, Bestzeit …) – nicht erst beim Profilbesuch.
        Warten gerade: <strong>{state?.waiting ?? "–"}</strong> · noch zu melden: <strong>{state?.unannounced ?? "–"}</strong> ·
        letzter Lauf: {when(state?.last_queue_run_at)} · letzte Runde über alle: {when(state?.last_full_sweep_at)}
      </div>
      <button type="button" onClick={evaluateAll} disabled={busy} data-testid="ach-evaluate-all"
        className="px-4 py-2 border border-[#FFD700]/50 text-[#FFD700] text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 disabled:opacity-40">
        <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} /> Alle jetzt auswerten
      </button>
    </div>
  );
}
