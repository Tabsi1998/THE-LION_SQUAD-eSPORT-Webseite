import { Timer } from "lucide-react";
import { queueSummaryLine } from "@/lib/liveQueue";
import { StationTile, moveTargets } from "./StationTile";
import "./live.css";

// Warteschlange je Station (#1556) für die Turnierleitung am Handy: je Station eine Kachel (`StationTile`) - was läuft
// (mit Spielzeit-Uhr), was als Nächstes kommt („Aufrufen“, dann „Starten“), was danach; in der Turnierleitung dazu
// „Freigeben“, „Umlegen“ und „Defekt“ (#1162). Die Reihenfolge rechnet der Server (services/live_queue.py) - die Seite
// zeigt nur. Knöpfe nur, wer die Station bedienen darf (`queue.operate`).

export function StationQueueBoard({ queue, busyKey = "", onCall, onStart, onRelease, onBroken, onMove }) {
  const summary = queueSummaryLine(queue?.summary);
  const stations = queue?.stations || [];
  const operate = queue?.operate;
  const canOperate = (station) => Boolean(operate?.all || (operate?.station_ids || []).includes(station.id));
  return (
    <div data-testid="live-board">
      {summary ? (
        <div className="flex items-center gap-2 rounded-sm border border-white/10 bg-[#121212] px-3 py-2 text-sm font-bold text-white" data-testid="live-summary">
          <Timer className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{summary}</span>
        </div>
      ) : null}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {stations.map((station, index) => (
          <StationTile
            key={station.id}
            station={station}
            index={index}
            busy={busyKey === station.id}
            canOperate={canOperate(station)}
            targets={onMove ? moveTargets(stations, station, canOperate) : []}
            onCall={onCall}
            onStart={onStart}
            onRelease={onRelease}
            onBroken={onBroken}
            onMove={onMove}
          />
        ))}
      </div>
      {(queue?.unplaced || []).length ? (
        <p className="mt-3 text-xs text-white/50" data-testid="live-unplaced">
          {queue.unplaced.length === 1 ? "1 Spiel hat keine Station (fester Termin oder freigegeben) – es steht in „Ergebnisse“." : `${queue.unplaced.length} Spiele haben keine Station (fester Termin oder freigegeben) – sie stehen in „Ergebnisse“.`}
        </p>
      ) : null}
    </div>
  );
}
