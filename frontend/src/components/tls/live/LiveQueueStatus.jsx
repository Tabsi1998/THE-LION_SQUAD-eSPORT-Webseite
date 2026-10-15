import { useCallback, useEffect, useState } from "react";
import { BellRing, Clock, Radio } from "lucide-react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { myQueueLine } from "@/lib/liveQueue";

// Spieler-Sicht vor Ort (#1556): „Du bist als Nächstes an Station 2 · ca. 18:40“, „Läuft an Station 2“, „Du bist dran“.
// Ohne `matchId` die eigenen Spiele (GET /tournaments/<id>/live-queue/me, angemeldet) - für die Turnierseite. Mit
// `matchId` genau dieses Spiel aus der öffentlichen Warteschlange - für die Matchseite; dort zeigt die Aufruf-Karte
// den Aufruf selbst (`hideCalled`). Online, ohne Spiel oder bei einem Fehler: nichts.
// Die Prognose ändert sich mit der Zeit, auch ohne Ereignis - deshalb fragt der Baustein zusätzlich jede Minute.

const TONE = {
  live: ["border-live/40 bg-live/10", Radio, "text-live"],
  call: ["border-brand/60 bg-brand/10", BellRing, "text-brand"],
  next: ["border-brand/40 bg-brand/5", Clock, "text-brand"],
  later: ["border-white/10 bg-white/[0.03]", Clock, "text-white/50"],
};

export function LiveQueueStatus({ tournamentId, matchId = null, hideCalled = false, className = "" }) {
  // Auf der Matchseite (`matchId`) schauen auch Zuschauer - dort ohne „du“.
  const personal = !matchId;
  const [entry, setEntry] = useState(null);
  const load = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const path = `/tournaments/${encodeURIComponent(tournamentId)}/live-queue${matchId ? "" : "/me"}`;
      const { data } = await api.get(path);
      if (!data?.applies) return setEntry(null);
      setEntry(matchId ? data.matches?.[matchId] || null : (data.entries || [])[0] || null);
    } catch {
      setEntry(null);
    }
  }, [tournamentId, matchId]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["tournaments", "matches-v2", "stations"], { fallbackMs: 30000, pollMs: 60000 });

  if (!entry || (hideCalled && entry.state === "called")) return null;
  const line = myQueueLine(entry, { personal });
  const [box, Icon, iconClass] = TONE[line.tone] || TONE.later;
  return (
    <div className={`flex items-start gap-3 rounded-sm border px-4 py-3 ${box} ${className}`} role="status" aria-live="polite" data-tone={line.tone} data-testid="live-queue-status">
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-heading text-base font-black uppercase text-white [overflow-wrap:anywhere]">{line.title}</div>
        {line.detail ? <div className="mt-0.5 text-sm text-white/70">{line.detail}</div> : null}
      </div>
    </div>
  );
}
