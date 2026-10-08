import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { countdown } from "@/lib/tvCalls";
import { asInstant, viennaTime } from "@/lib/vienna";

// Aufruf (#1137): Hat die Turnierleitung das Spiel einer Station zugewiesen, steht hier groß, wohin es geht und wie
// lange noch - derselbe Countdown wie auf der Aufruf-Tafel am TV (#1122). Das Ende („antreten bis“) rechnet der Server.
// Bei 0 steht „Jetzt geht es los“; mit „Bewegung reduzieren“ zählt nur die Zahl, nichts blinkt.

export function MatchCallBox({ call }) {
  const dueAt = call?.report_by ? asInstant(call.report_by).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (dueAt === null) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [dueAt]);
  if (!call) return null;
  const left = countdown(Number.isNaN(dueAt) ? null : dueAt, now);
  const station = call.station_text || "deine Station";
  return (
    <div className="mt-6 rounded-sm border border-[#FFD700]/50 bg-[#FFD700]/10 px-4 py-4 sm:px-5" role="status" data-testid="match-call">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#FFD700] flex items-center gap-2"><BellRing className="w-4 h-4" /> Aufgerufen</div>
          <div className="mt-1 font-heading text-2xl font-black uppercase text-white [overflow-wrap:anywhere]" data-testid="match-call-station">Bitte jetzt zu {station}</div>
          {call.report_by && <div className="mt-1 text-sm text-white/70">Antreten bis {viennaTime(call.report_by, { hour: "2-digit", minute: "2-digit" })}</div>}
        </div>
        {left.seconds !== null && (
          <div className="text-right" data-testid="match-call-countdown">
            {left.done ? (
              <div className="font-heading text-xl font-black uppercase text-[#FFD700]">Jetzt geht es los</div>
            ) : (
              <>
                <div className="text-[10px] uppercase tracking-widest text-white/55">noch</div>
                <div className="font-display text-4xl font-bold tabular-nums text-white">{left.text}</div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
