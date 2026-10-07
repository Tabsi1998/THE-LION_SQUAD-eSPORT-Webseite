import { AlertTriangle, RefreshCw, Wifi } from "lucide-react";
import { viennaTime } from "@/lib/vienna";

// Stand-Zeile der TV-Seiten: „aktuell, Stand 14:20:03“ oder - wenn das Nachladen klemmt - die Bitte um „Neu laden“.
// Größen und Farben kommen aus components/tv/tv.css (#1111): auch diese Zeile hält die Mindestgröße.
export function DisplayStatusBanner({ error, lastUpdated, label = "Live-Daten", onRetry, message = "" }) {
  if (!error && !lastUpdated) return null;
  const timeLabel = lastUpdated
    ? viennaTime(lastUpdated, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className={`tv-status tv-t-meta ${error ? "tv-status--error" : ""}`} data-testid="tv-status">
      <div className="inline-flex items-center gap-[0.6em] min-w-0">
        {error ? <AlertTriangle className="tv-icon" /> : <Wifi className="tv-icon" />}
        <span className="min-w-0">
          {error ? message || `${label} konnten nicht aktualisiert werden` : `${label} aktuell`}
        </span>
        {timeLabel && <span className="tv-status__time">Stand {timeLabel}</span>}
      </div>
      {error && onRetry && (
        <button type="button" onClick={onRetry} className="tv-status__retry tv-t-meta">
          <RefreshCw className="tv-icon" /> Neu laden
        </button>
      )}
    </div>
  );
}
