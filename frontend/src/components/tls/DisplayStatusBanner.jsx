import { AlertTriangle, RefreshCw, Wifi } from "lucide-react";

export function DisplayStatusBanner({ error, lastUpdated, label = "Live-Daten", onRetry, compact = false }) {
  if (!error && !lastUpdated) return null;
  const timeLabel = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className={`border-y ${error ? "border-[#FF3B30]/30 bg-[#FF3B30]/10 text-[#FF3B30]" : "border-white/5 bg-[#0A0A0A]/70 text-white/45"} ${compact ? "px-4 py-1.5" : "px-8 py-2"}`}>
      <div className="flex items-center justify-between gap-4 text-[11px] font-bold uppercase tracking-widest">
        <div className="inline-flex items-center gap-2 min-w-0">
          {error ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <Wifi className="w-3.5 h-3.5 shrink-0" />}
          <span className="truncate">
            {error ? `${label} konnten nicht aktualisiert werden` : `${label} aktuell`}
          </span>
          {timeLabel && <span className="text-white/35 normal-case tracking-normal">Stand {timeLabel}</span>}
        </div>
        {error && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 border border-current/30 px-2 py-1 rounded-sm hover:bg-current/10 shrink-0"
          >
            <RefreshCw className="w-3 h-3" /> Neu laden
          </button>
        )}
      </div>
    </div>
  );
}
