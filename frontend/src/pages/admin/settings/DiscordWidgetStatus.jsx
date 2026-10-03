import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Discord auf der Website (#581): ob das Server-Widget läuft, das Startseite und Mitgliederbereich mit
// „online“ und „im Voice“ füttert - und wenn nicht, warum, mit Klickweg. „Jetzt prüfen“ nach dem
// Einschalten im Discord, statt eine Minute zu warten.

export function widgetText(widget) {
  if (!widget) return "";
  if (widget.available) {
    const when = widget.fetched_at ? ` · Stand ${new Date(widget.fetched_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : "";
    return `Läuft: ${widget.online || 0} online, ${widget.in_voice || 0} im Voice${when}.`;
  }
  return widget.reason_text || "Noch nicht abgefragt – das passiert jede Minute von selbst.";
}

export function DiscordWidgetStatus() {
  const [widget, setWidget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/settings/discord/bot/widget");
      setWidget(data || null);
    } catch {
      setWidget(null);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const check = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/settings/discord/bot/widget/refresh");
      setWidget(data || null);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  if (!widget) return null;
  return (
    <div className={`border rounded-sm p-3 text-xs space-y-2 ${widget.available ? "border-white/10 text-white/60" : "border-[#FFD700]/30 bg-[#FFD700]/5 text-white/75"}`} data-testid="discord-widget">
      <div className="font-bold uppercase tracking-wider text-[10px] text-white/70 inline-flex items-center gap-2"><Users className="w-3.5 h-3.5 text-[#5865F2]" /> Discord auf der Website</div>
      <div data-testid="discord-widget-text">{widgetText(widget)}</div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-white/40">Startseite: „online · im Voice“, Mitgliederbereich: belegte Sprachkanäle – nur Zahlen, nie Namen.</span>
        <button type="button" onClick={check} disabled={busy} data-testid="discord-widget-check"
          className="px-3 py-1.5 border border-white/20 text-white/70 text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
          <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} /> Jetzt prüfen
        </button>
      </div>
    </div>
  );
}
