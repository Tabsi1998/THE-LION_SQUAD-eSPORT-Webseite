import { CalendarClock, Check } from "lucide-react";
import { formatDateTime } from "@/lib/datetime";
import { AddToCalendar } from "@/components/tls/AddToCalendar";
import { useCountdownDays } from "@/hooks/useCountdownDays";
import { COUNTDOWN_DAYS_DEFAULT, whenPhrase, whenText } from "@/lib/countdownRule";
import { effectiveCheckIn } from "@/lib/checkInTimes";
import { publicState } from "@/lib/publicPhase";

// Turnierseite (#401): die Termine genau einmal - als Zeitleiste Anmeldung → Check-in → Start → Ende,
// mit dem nächsten Schritt hervorgehoben und einem Countdown in Worten. Vorher standen sie im grünen
// Kasten oben und noch einmal in der Seitenleiste.
//
// Nach Status und Phase (#1938), nicht nur nach der Uhr: was das Turnier schon erreicht hat, ist abgehakt - auch wenn
// die eingestellte Zeit noch vor uns liegt (Check-in von Hand, Start vor der Planzeit). Was gerade läuft (Anmeldung,
// Check-in, Turnier), steht als „läuft“; einen Countdown gibt es nur für Kommendes. Die Check-in-Zeiten sind die
// wirksamen (lib/checkInTimes).

// Wie weit das Turnier ist: 1 Anmeldung offen, 2 geschlossen, 3 Check-in, 4 Check-in beendet, 5 läuft, 6 vorbei.
const OVER = new Set(["completed", "results_published", "archived"]);
const RUNNING_STATE = { registration_open: "registration_open", check_in: "checkin_open", live: "start" };
const RUNNING_LABEL = { registration_open: "Anmeldung läuft", checkin_open: "Check-in läuft", start: "Turnier läuft" };

function stageOf(t) {
  const state = publicState(t);
  const status = String(t?.status || "").toLowerCase();
  if (OVER.has(state) || OVER.has(status)) return 6;
  if (["live", "paused", "day_break"].includes(state) || ["live", "paused"].includes(status)) return 5;
  if (t?.check_in_closed_at) return 4;
  if (state === "check_in" || ["check_in", "checkin_open"].includes(status)) return 3;
  if (state === "registration_closed" || status === "registration_closed") return 2;
  if (state === "registration_open" || status === "registration_open") return 1;
  return 0;
}

export function timelineSteps(t, now = Date.now()) {
  const checkIn = effectiveCheckIn(t, now);
  const raw = [
    { key: "registration_open", label: "Anmeldung öffnet", at: t.registration_open_from, stage: 1 },
    { key: "registration_close", label: "Anmeldung endet", at: t.registration_open_until, stage: 2 },
    { key: "checkin_open", label: "Check-in öffnet", at: checkIn.from, stage: 3 },
    { key: "checkin_close", label: "Check-in endet", at: checkIn.until, stage: 4 },
    { key: "start", label: "Start", at: t.start_date, stage: 5 },
    { key: "end", label: "Ende", at: t.end_date, stage: 6 },
  ].filter((step) => step.at);
  const stage = stageOf(t);
  const runningKey = RUNNING_STATE[publicState(t)] || null;
  const steps = raw.map(({ stage: reachedAt, ...step }) => {
    const ms = new Date(step.at).getTime();
    const running = step.key === runningKey;
    const past = running || stage >= reachedAt || (Number.isFinite(ms) && ms <= now);
    return { ...step, label: running ? RUNNING_LABEL[step.key] : step.label, ms, past, running };
  }).filter((step) => Number.isFinite(step.ms))
    // Erreichtes vor Kommendem, sonst nach der Zeit - ein früher gestarteter Check-in steht nie hinter dem Start.
    .sort((a, b) => (a.past === b.past ? a.ms - b.ms : Number(b.past) - Number(a.past)));
  const next = steps.find((step) => !step.past) || null;
  return steps.map((step) => ({ ...step, next: next ? step.key === next.key : false }));
}

// Die Zeitangabe nach der einen Regel (#1264): ab der Schwelle „in 3 Tagen“, „morgen 14:00“, „in 45 Minuten“; weiter
// weg das Datum oder der Monat - keine „Min.“ und „Std.“ mehr.
export function countdownText(ms, now = Date.now(), days = COUNTDOWN_DAYS_DEFAULT) {
  return whenText(ms, { now, days })?.text || "";
}

/** Der Schritt mit seiner Zeitangabe: „Start in 3 Tagen“, „Anmeldung endet am Fr 30. Oktober“, „Start im März“. */
export function stepCountdown(step, now = Date.now(), days = COUNTDOWN_DAYS_DEFAULT) {
  if (!step) return "";
  return whenPhrase(step.label, whenText(step.ms, { now, days }));
}

/** Der Kopf der Zeitleiste: der Countdown zum nächsten Termin, sonst was läuft, sonst „Alle Termine vorbei“. */
export function timelineHeadline(steps, now = Date.now(), days = COUNTDOWN_DAYS_DEFAULT) {
  const next = steps.find((step) => step.next);
  if (next) return stepCountdown(next, now, days);
  const running = steps.find((step) => step.running);
  return running ? running.label : "Alle Termine vorbei";
}

function StepMark({ step, highlighted }) {
  if (step.running) {
    return (
      <span className="mt-0.5 w-4 h-4 rounded-full border border-[#29B6E8] shrink-0 inline-flex items-center justify-center" aria-hidden="true">
        <span className="w-1.5 h-1.5 rounded-full bg-[#29B6E8]" />
      </span>
    );
  }
  const tone = step.past ? "border-[#00FF88]/60 text-[#00FF88]" : highlighted ? "border-[#29B6E8]" : "border-white/20";
  return <span className={`mt-0.5 w-4 h-4 rounded-full border shrink-0 inline-flex items-center justify-center ${tone}`}>{step.past ? <Check className="w-3 h-3" /> : null}</span>;
}

export function TournamentTimeline({ tournament: t, calendarItem = null }) {
  const days = useCountdownDays();
  const now = Date.now();
  const steps = timelineSteps(t, now);
  if (!steps.length) return null;
  // Hervorgehoben ist, was gerade läuft - sonst der nächste Termin.
  const highlight = steps.find((step) => step.running) || steps.find((step) => step.next) || null;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="tournament-timeline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-heading font-bold uppercase text-sm inline-flex items-center gap-2"><CalendarClock className="w-4 h-4 text-[#29B6E8]" /> Termine</div>
        {highlight ? <div className="text-xs text-[#29B6E8] font-bold uppercase tracking-wider" data-testid="tournament-timeline-next">{timelineHeadline(steps, now, days)}</div> : <div className="text-xs text-white/40">Alle Termine vorbei</div>}
      </div>
      <ol className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {steps.map((step) => {
          const highlighted = step.key === highlight?.key;
          return (
            <li key={step.key} data-testid={`tournament-timeline-${step.key}`} data-state={step.running ? "running" : step.past ? "past" : step.next ? "next" : "upcoming"} className={`flex items-start gap-2 rounded-sm border px-3 py-2 text-sm ${highlighted ? "border-[#29B6E8]/50 bg-[#29B6E8]/5" : step.past ? "border-white/5 text-white/40" : "border-white/10"}`}>
              <StepMark step={step} highlighted={highlighted} />
              <span>
                <span className={`block text-[10px] font-bold uppercase tracking-widest ${step.running ? "text-[#29B6E8]" : "text-white/50"}`}>{step.label}</span>
                <span className="block">{formatDateTime(step.at)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {calendarItem ? <AddToCalendar className="mt-3" item={calendarItem} /> : null}
    </section>
  );
}

export default TournamentTimeline;
