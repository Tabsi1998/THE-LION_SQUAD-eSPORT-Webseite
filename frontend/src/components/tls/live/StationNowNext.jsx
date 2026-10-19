import { BellRing, Radio } from "lucide-react";
import { delayText } from "@/lib/liveQueue";
import { stationWho } from "@/lib/tvQueue";
import { viennaTime } from "@/lib/vienna";
import { MatchClock } from "./MatchClock";

// Öffentlicher Spielplan, Sicht je Station (#1556): oben „Jetzt“ mit Spielzeit-Uhr und „Als Nächstes“ aus der
// Warteschlange des Servers (`stations[]` von GET /tournaments/<id>/live-queue). Die Liste darunter bleibt der Plan.
// Ohne Eintrag für die Station: nichts.

const clock = (value) => (value ? viennaTime(value, { hour: "2-digit", minute: "2-digit" }) : "");

function nextLine(entry) {
  if (entry.state === "called") return ["Aufgerufen", entry.report_by ? `antreten bis ${clock(entry.report_by)}` : ""].filter(Boolean).join(" · ");
  return [entry.forecast_at ? `${entry.forecast ? "voraussichtlich " : ""}ca. ${clock(entry.forecast_at)}` : "", delayText(entry.delay_minutes)].filter(Boolean).join(" · ");
}

export function StationNowNext({ station, stationKey }) {
  if (!station || (!station.running && !station.next)) return null;
  const { running, next } = station;
  return (
    <div className="mt-3 grid gap-2 rounded-md border border-white/10 bg-[var(--tls-surface-2)] p-3 sm:grid-cols-2" data-testid={`schedule-now-${stationKey}`}>
      {running ? (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-live"><Radio className="h-3.5 w-3.5" aria-hidden="true" /> Jetzt</div>
          <div className="mt-0.5 text-sm font-bold text-white [overflow-wrap:anywhere]">{stationWho(running)}</div>
          <MatchClock startedAt={running.started_at} durationMinutes={running.duration_minutes} testId={`schedule-clock-${running.match_id}`} className="mt-1" />
        </div>
      ) : null}
      {next ? (
        <div className={`min-w-0 ${running ? "sm:border-l sm:border-white/10 sm:pl-3" : ""}`}>
          <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest ${next.state === "called" ? "text-brand" : "text-white/50"}`}>
            {next.state === "called" ? <BellRing className="h-3.5 w-3.5" aria-hidden="true" /> : null} Als Nächstes
          </div>
          <div className="mt-0.5 text-sm font-bold text-white [overflow-wrap:anywhere]">{stationWho(next)}</div>
          <div className={`text-xs ${next.state === "called" ? "text-brand" : "text-white/60"}`}>{nextLine(next)}</div>
        </div>
      ) : null}
    </div>
  );
}
