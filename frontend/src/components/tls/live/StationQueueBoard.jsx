import { useState } from "react";
import { BellRing, Timer } from "lucide-react";
import { queueSummaryLine } from "@/lib/liveQueue";
import { StationTile, callAllTargets, callableFor, moveTargets } from "./StationTile";
import "./live.css";

// Warteschlange je Station (#1556) für die Turnierleitung am Handy: je Station eine Kachel (`StationTile`) - was läuft
// (mit Spielzeit-Uhr), was als Nächstes kommt („Aufrufen“, dann „Starten“), was danach; in der Turnierleitung dazu
// „Freigeben“, „Umlegen“ und „Defekt“ (#1162). Die Reihenfolge rechnet der Server (services/live_queue.py) - die Seite
// zeigt nur. Knöpfe nur, wer die Station bedienen darf (`queue.operate`).

export function StationQueueBoard({ queue, busyKey = "", onCall, onStart, onRelease, onBroken, onMove, onClear, onCallAll }) {
  const summary = queueSummaryLine(queue?.summary);
  const stations = queue?.stations || [];
  const operate = queue?.operate;
  const canOperate = (station) => Boolean(operate?.all || (operate?.station_ids || []).includes(station.id));
  // „Alle freien Stationen aufrufen“ (#1162): je freie Station ihr „Als Nächstes“ - nach Rückfrage mit der Anzahl.
  const callAll = onCallAll ? callAllTargets(stations, canOperate) : [];
  const [asking, setAsking] = useState(false);
  return (
    <div data-testid="live-board">
      {callAll.length ? (
        <div className="mb-3 rounded-sm border border-brand/30 bg-brand/5 p-3" data-testid="live-call-all-box">
          {asking ? (
            <div className="tls-live-reveal" data-testid="live-call-all-confirm">
              <p className="text-sm text-white">{callAll.length === 1 ? "1 Station" : `${callAll.length} Stationen`} aufrufen? Die Spieler bekommen „Du bist dran“, gestartet wird nichts.</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center justify-center rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider" onClick={() => setAsking(false)}>Abbrechen</button>
                <button type="button" disabled={Boolean(busyKey)} className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center justify-center rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider" onClick={() => { setAsking(false); onCallAll(callAll.map((station) => [station, station.next])); }} data-testid="live-call-all-yes">Alle aufrufen</button>
              </div>
            </div>
          ) : (
            <button type="button" disabled={Boolean(busyKey)} onClick={() => setAsking(true)} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider" data-testid="live-call-all">
              <BellRing className="h-4 w-4 shrink-0" aria-hidden="true" /> Alle freien Stationen aufrufen ({callAll.length})
            </button>
          )}
        </div>
      ) : null}
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
            callable={onCallAll ? callableFor(station, queue?.matches) : []}
            onCall={onCall}
            onStart={onStart}
            onRelease={onRelease}
            onBroken={onBroken}
            onMove={onMove}
            onClear={onClear}
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
