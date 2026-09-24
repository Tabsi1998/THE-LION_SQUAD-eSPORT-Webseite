import { CalendarClock, Check } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { AddToCalendar } from "@/components/tls/AddToCalendar";

// Turnierseite (#401): die Termine genau einmal - als Zeitleiste Anmeldung → Check-in → Start → Ende,
// mit dem nächsten Schritt hervorgehoben und einem Countdown in Worten. Vorher standen sie im grünen
// Kasten oben und noch einmal in der Seitenleiste.

export function timelineSteps(t, now = Date.now()) {
  const raw = [
    { key: "registration_open", label: "Anmeldung öffnet", at: t.registration_open_from },
    { key: "registration_close", label: "Anmeldung endet", at: t.registration_open_until },
    { key: "checkin_open", label: "Check-in öffnet", at: t.check_in_from },
    { key: "checkin_close", label: "Check-in endet", at: t.check_in_until },
    { key: "start", label: "Start", at: t.start_date },
    { key: "end", label: "Ende", at: t.end_date },
  ].filter((step) => step.at);
  const steps = raw.map((step) => {
    const ms = new Date(step.at).getTime();
    return { ...step, ms, past: Number.isFinite(ms) && ms <= now };
  }).filter((step) => Number.isFinite(step.ms)).sort((a, b) => a.ms - b.ms);
  const next = steps.find((step) => !step.past) || null;
  return steps.map((step) => ({ ...step, next: next ? step.key === next.key : false }));
}

export function countdownText(ms, now = Date.now()) {
  const diff = ms - now;
  if (diff <= 0) return "jetzt";
  const minutes = Math.round(diff / 60000);
  if (minutes < 60) return `in ${minutes} Min.`;
  const hours = Math.round(diff / 3600000);
  if (hours < 48) return `in ${hours} Std.`;
  const days = Math.round(diff / 86400000);
  return `in ${days} Tagen`;
}

export function TournamentTimeline({ tournament: t, calendarItem = null }) {
  const steps = timelineSteps(t);
  const next = steps.find((step) => step.next);
  if (!steps.length) return null;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="tournament-timeline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-heading font-bold uppercase text-sm inline-flex items-center gap-2"><CalendarClock className="w-4 h-4 text-[#29B6E8]" /> Termine</div>
        {next ? <div className="text-xs text-[#29B6E8] font-bold uppercase tracking-wider" data-testid="tournament-timeline-next">{next.label} {countdownText(next.ms)}</div> : <div className="text-xs text-white/40">Alle Termine vorbei</div>}
      </div>
      <ol className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {steps.map((step) => (
          <li key={step.key} data-testid={`tournament-timeline-${step.key}`} className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-sm ${step.next ? "border-[#29B6E8]/50 bg-[#29B6E8]/5" : step.past ? "border-white/5 text-white/40" : "border-white/10"}`}>
            <span className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 inline-flex items-center justify-center ${step.past ? "border-[#00FF88]/60 text-[#00FF88]" : step.next ? "border-[#29B6E8]" : "border-white/20"}`}>{step.past ? <Check className="w-3 h-3" /> : null}</span>
            <span>
              <span className="block text-[10px] font-bold uppercase tracking-widest text-white/50">{step.label}</span>
              <span className="block">{formatDateTime(step.at)}</span>
            </span>
          </li>
        ))}
      </ol>
      {calendarItem ? <AddToCalendar className="mt-3" item={calendarItem} /> : null}
    </section>
  );
}

export default TournamentTimeline;
