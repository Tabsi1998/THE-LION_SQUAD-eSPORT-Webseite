import { ClipboardList, UserCheck, Shuffle, Network, Flag, Trophy, Check, Users, Play, CalendarDays, ListOrdered } from "lucide-react";

const CHECKED_IN = new Set(["checked_in"]);
const APPROVED = new Set(["approved", "checked_in", "confirmed"]);
const DONE_MATCH = new Set(["completed", "forfeit"]);

// Status ordering for the tournament lifecycle.
const STATUS_RANK = {
  draft: 0,
  scheduled: 1,
  registration_open: 2,
  registration_closed: 3,
  check_in: 4,
  live: 5,
  paused: 5,
  completed: 6,
  results_published: 7,
  archived: 8,
  cancelled: 8,
};

function rank(status) {
  return STATUS_RANK[status] ?? 0;
}

// Ein gewöhnliches Turnier: Anmeldung → Check-in → Setzliste → Turnierbaum → Ergebnisse → Endstand.
function tournamentSteps({ r, approved, checkedIn, totalMatches, completedMatches, published }) {
  const hasBracket = totalMatches > 0;
  return [
    { id: "registration", key: "participants", icon: ClipboardList, label: "Anmeldung", meta: `${approved} bestätigt`, done: r >= rank("check_in") },
    { id: "check-in", key: "participants", icon: UserCheck, label: "Check-in", meta: `${checkedIn} eingecheckt`, done: r >= rank("live") },
    { id: "seeding", key: "bracket", icon: Shuffle, label: "Setzliste", meta: hasBracket ? "gesetzt" : "offen", done: hasBracket },
    { id: "bracket", key: "bracket", icon: Network, label: "Turnierbaum", meta: hasBracket ? `${totalMatches} Spiele` : "—", done: hasBracket },
    { id: "results", key: "stages", icon: Flag, label: "Ergebnisse", meta: hasBracket ? `${completedMatches}/${totalMatches}` : "—", done: hasBracket && completedMatches === totalMatches },
    { id: "standings", key: "bracket", icon: Trophy, label: "Endstand", meta: published ? "veröffentlicht" : "offen", done: published },
  ];
}

// Liga-Staffel (#2109, S17): keine Anmeldung, kein Check-in, kein Baum. Co-Teams zuteilen → Liga starten → Spieltage →
// Tabelle. Vor dem Start sind die Spiele nur eine Vorschau und zählen nicht.
function staffelSteps({ r, approved, matches, published }) {
  const started = r >= rank("live");
  const real = matches.filter((match) => !match.is_preview && match.status !== "preview" && match.status !== "cancelled");
  const completed = real.filter((match) => DONE_MATCH.has(match.status)).length;
  return [
    { id: "assign", key: "participants", icon: Users, label: "Co-Teams zuteilen", meta: `${approved} zugeteilt`, done: started || approved >= 2 },
    { id: "start", key: "matchplan", icon: Play, label: "Liga starten", meta: started ? "gestartet" : "offen", done: started },
    { id: "matchdays", key: "stages", icon: CalendarDays, label: "Spieltage", meta: started && real.length ? `${completed}/${real.length} Spiele` : "—", done: started && real.length > 0 && completed === real.length },
    { id: "table", key: "bracket", icon: ListOrdered, label: "Tabelle", meta: published ? "veröffentlicht" : "offen", done: published },
  ];
}

export function TournamentFlowStepper({ tournament, registrations = [], matchesV2 = [], onNavigate }) {
  const status = tournament?.status || "draft";
  const r = rank(status);
  const staffel = Boolean(tournament?.league_context);

  const approved = registrations.filter((x) => APPROVED.has(x.status)).length;
  const checkedIn = registrations.filter(
    (x) => CHECKED_IN.has(x.status) || x.checked_in_at
  ).length;
  const allMatches = matchesV2 || [];
  const totalMatches = allMatches.length;
  const completedMatches = allMatches.filter((m) => DONE_MATCH.has(m.status)).length;
  const published = status === "results_published" || status === "archived";

  const steps = staffel
    ? staffelSteps({ r, approved, matches: allMatches, published })
    : tournamentSteps({ r, approved, checkedIn, totalMatches, completedMatches, published });

  // Current step = first not-done step, else the last one.
  let current = steps.findIndex((step) => !step.done);
  if (current === -1) current = steps.length - 1;
  if (status === "cancelled") current = -1;

  return (
    <div
      data-testid="tournament-flow-stepper"
      className="mb-5 rounded-lg border border-white/10 bg-gradient-to-br from-[#0E0E0E] to-[#0A0A0A] p-4"
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{staffel ? "Liga-Ablauf" : "Turnier-Ablauf"}</span>
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className="flex items-stretch gap-1 tls-swipe tls-swipe--room pb-1">
        {steps.map((step, i) => {
          const isDone = step.done;
          const isCurrent = i === current;
          const Icon = step.icon;
          const state = isCurrent ? "current" : isDone ? "done" : "todo";
          const ring =
            state === "current"
              ? "border-[#FFD700] text-[#FFD700] shadow-[0_0_18px_rgba(255,215,0,0.35)]"
              : state === "done"
              ? "border-[#29B6E8] bg-[#29B6E8] text-black"
              : "border-white/15 text-white/40";
          return (
            <div key={step.id} className="flex items-center flex-1 min-w-[120px]">
              <button
                type="button"
                data-testid={`flow-step-${step.id}`}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onNavigate?.(step.key)}
                className="group flex flex-col items-center gap-1.5 flex-1 focus:outline-none"
              >
                <span
                  className={`relative w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${ring} ${
                    isCurrent ? "animate-pulse" : ""
                  } group-hover:scale-110`}
                >
                  {state === "done" ? <Check className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
                </span>
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider text-center transition-colors ${
                    state === "current" ? "text-[#FFD700]" : state === "done" ? "text-white" : "text-white/45"
                  }`}
                >
                  {step.label}
                </span>
                <span className="text-[10px] text-white/40 tabular-nums">{step.meta}</span>
              </button>
              {i < steps.length - 1 && (
                <span
                  className={`h-0.5 w-full max-w-[40px] -mt-6 rounded transition-colors duration-300 ${
                    isDone ? "bg-[#29B6E8]" : "bg-white/10"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
