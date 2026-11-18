import { useEffect } from "react";
import { BellRing, Clock, Radio } from "lucide-react";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useLiveQueue, useStaleExpired } from "@/hooks/useLiveQueue";
import { LiveStaleNote } from "@/components/tls/live/LiveStaleNote";
import { QUEUE_GONE_STATUSES, QUEUE_ME_GONE_STATUSES, myQueueLine, noteOwnMatches, queuePollMs } from "@/lib/liveQueue";

// Spieler-Sicht vor Ort (#1556): „Du bist als Nächstes an Station 2 · ca. 18:40“, „Läuft an Station 2“, „Du bist dran“.
// Ohne `matchId` die eigenen Spiele (GET /tournaments/<id>/live-queue/me, angemeldet) - für die Turnierseite. Mit
// `matchId` genau dieses Spiel aus der öffentlichen Warteschlange - für die Matchseite; dort zeigt die Aufruf-Karte
// den Aufruf selbst (`hideCalled`). Online, ohne Spiel oder wenn schon der erste Abruf scheitert: nichts. Scheitert ein
// späterer Abruf (Netz, Server), bleibt der letzte Stand mit „Letzter Stand vor X s“ stehen - höchstens 3 Minuten
// (QUEUE_STALE_MAX_MS), dann fällt er weg, damit kein falsches „Du bist dran“ stehen bleibt. 404/403 nimmt ihn sofort
// weg, bei den eigenen Spielen auch 401 (Sitzung abgelaufen) - dann endet der Takt (#2440, hooks/useLiveQueue).
// Die Prognose ändert sich mit der Zeit, auch ohne Ereignis - deshalb fragt der Baustein vor Ort zusätzlich jede Minute;
// online (`applies: false`) nicht.

const TONE = {
  live: ["border-live/40 bg-live/10", Radio, "text-live"],
  call: ["border-brand/60 bg-brand/10", BellRing, "text-brand"],
  next: ["border-brand/40 bg-brand/5", Clock, "text-brand"],
  later: ["border-white/10 bg-white/[0.03]", Clock, "text-white/50"],
};

// `eventId` (#1801): Die Turniere eines Events teilen sich Stationen - die Warteschlange lädt bei Änderungen dieses
// Turniers und der anderen Turniere desselben Events nach. Ohne `eventId` bei jedem Turnier mit Event.
export function LiveQueueStatus({ tournamentId, eventId = null, matchId = null, hideCalled = false, className = "" }) {
  // Auf der Matchseite (`matchId`) schauen auch Zuschauer - dort ohne „du“.
  const personal = !matchId;
  const path = tournamentId ? `/tournaments/${encodeURIComponent(tournamentId)}/live-queue${matchId ? "" : "/me"}` : "";
  const { queue: view, status, staleSince, failures, reload } = useLiveQueue(path, { gone: matchId ? QUEUE_GONE_STATUSES : QUEUE_ME_GONE_STATUSES });
  const expired = useStaleExpired(staleSince);
  const entry = view && !expired ? (matchId ? view.matches?.[matchId] || null : (view.entries || [])[0] || null) : null;
  // Im Takt vor Ort - und wenn schon der erste Abruf scheiterte (weiter versuchen, mit wachsendem Abstand).
  const asks = status === "applies" || status === "unknown";
  useLiveRefresh(reload, ["tournaments", "matches-v2", "stations"], { fallbackMs: asks ? queuePollMs(30000, failures) : 0, pollMs: queuePollMs(asks ? 60000 : 0, failures), tournamentId, eventId });
  // Turniertag (#1169): die eigenen Spiele vor Ort - aufgerufen oder laufend pausiert die Saison-Deko überall.
  // Fällt ein Spiel aus der Warteschlange dieses Turniers heraus, ist sein Ergebnis da - dann kommt die Deko zurück.
  const ownEntries = personal && view && !expired ? view.entries : null;
  useEffect(() => {
    if (Array.isArray(ownEntries)) noteOwnMatches(ownEntries, "queue", { scope: tournamentId ? `tournament:${tournamentId}` : null });
  }, [ownEntries, tournamentId]);

  if (!entry || (hideCalled && entry.state === "called")) return null;
  const line = myQueueLine(entry, { personal });
  const [box, Icon, iconClass] = TONE[line.tone] || TONE.later;
  return (
    <div className={`flex items-start gap-3 rounded-sm border px-4 py-3 ${box} ${className}`} role="status" aria-live="polite" data-tone={line.tone} data-testid="live-queue-status">
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-heading text-base font-black uppercase text-white [overflow-wrap:anywhere]">{line.title}</div>
        {line.detail ? <div className="mt-0.5 text-sm text-white/70">{line.detail}</div> : null}
        <LiveStaleNote since={staleSince} className="mt-1.5" testId="live-queue-status-stale" inRegion />
      </div>
    </div>
  );
}
