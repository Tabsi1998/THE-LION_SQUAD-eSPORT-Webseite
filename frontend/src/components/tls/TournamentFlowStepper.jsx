import { ClipboardList, UserCheck, Shuffle, Network, Flag, Trophy, Check, Users, Play, CalendarDays, ListOrdered } from "lucide-react";
import { countsAsMatch, isCancelled } from "@/lib/bracketGraph";

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

// Was der Schritt „Turnierbaum“ je Format ist (#2111, T6): ohne Baum der Spielplan, beim Schweizer System die Runden,
// bei Gruppen die Gruppen, bei Mehrspieler die Läufe. Zeitfahren und Rennserie bekommen keine Spiele - dort gibt es
// weder Setzliste noch Spiele im Ablauf.
const BRACKET_STEP_LABELS = {
  round_robin: "Spielplan", league: "Spielplan", swiss: "Runden", groups: "Gruppen",
  ffa: "Läufe", battle_royale: "Läufe", ffa_custom_bracket: "Läufe",
};
const NO_MATCH_FORMATS = new Set(["time_trial", "grand_prix"]);

// Ein gewöhnliches Turnier: Anmeldung → Check-in → Setzliste → Turnierbaum → Ergebnisse → Endstand.
function tournamentSteps({ r, approved, checkedIn, totalMatches, completedMatches, published, format }) {
  const hasBracket = totalMatches > 0;
  const steps = [
    { id: "registration", key: "participants", icon: ClipboardList, label: "Anmeldung", meta: `${approved} bestätigt`, done: r >= rank("check_in") },
    { id: "check-in", key: "participants", icon: UserCheck, label: "Check-in", meta: `${checkedIn} eingecheckt`, done: r >= rank("live") },
    { id: "seeding", key: "bracket", icon: Shuffle, label: "Setzliste", meta: hasBracket ? "gesetzt" : "offen", done: hasBracket },
    { id: "bracket", key: "bracket", icon: Network, label: BRACKET_STEP_LABELS[format] || "Turnierbaum", meta: hasBracket ? `${totalMatches} Spiele` : "—", done: hasBracket },
    { id: "results", key: "stages", icon: Flag, label: "Ergebnisse", meta: hasBracket ? `${completedMatches}/${totalMatches}` : "—", done: hasBracket && completedMatches === totalMatches },
    { id: "standings", key: "bracket", icon: Trophy, label: "Endstand", meta: published ? "veröffentlicht" : "offen", done: published },
  ];
  return NO_MATCH_FORMATS.has(format) ? steps.filter((step) => !["seeding", "bracket", "results"].includes(step.id)) : steps;
}

// Liga-Staffel (#2109, S17): keine Anmeldung, kein Check-in, kein Baum. Co-Teams zuteilen → Liga starten → Spieltage →
// Tabelle. Vor dem Start sind die Spiele nur eine Vorschau und zählen nicht.
function staffelSteps({ r, approved, matches, published }) {
  const started = r >= rank("live");
  const real = matches.filter(countsAsMatch);
  const completed = real.filter((match) => DONE_MATCH.has(match.status)).length;
  return [
    { id: "assign", key: "participants", icon: Users, label: "Co-Teams zuteilen", meta: `${approved} zugeteilt`, done: started || approved >= 2 },
    { id: "start", key: "matchplan", icon: Play, label: "Liga starten", meta: started ? "gestartet" : "offen", done: started },
    { id: "matchdays", key: "stages", icon: CalendarDays, label: "Spieltage", meta: started && real.length ? `${completed}/${real.length} Spiele` : "—", done: started && real.length > 0 && completed === real.length },
    { id: "table", key: "bracket", icon: ListOrdered, label: "Tabelle", meta: published ? "veröffentlicht" : "offen", done: published },
  ];
}

// ``stack``: am Handy (unter 640 px) als Liste untereinander statt als Wischleiste - die Staffel-Seite der Liga-Verwaltung (#2262)
// zeigt so alle Schritte auf einen Blick. Ohne Angabe bleibt die Leiste, wie sie ist.
export function TournamentFlowStepper({ tournament, registrations = [], matchesV2 = [], onNavigate, stack = false }) {
  const status = tournament?.status || "draft";
  const r = rank(status);
  const staffel = Boolean(tournament?.league_context);

  const approved = registrations.filter((x) => APPROVED.has(x.status)).length;
  const checkedIn = registrations.filter(
    (x) => CHECKED_IN.has(x.status) || x.checked_in_at
  ).length;
  const allMatches = matchesV2 || [];
  // Zusammengelegte Läufe, ein nicht nötiger Reset und abgekürzte Runden entfallen (#2452) - sie sind keine offenen
  // Spiele. Sonst stand nach dem letzten Lauf „Ergebnisse 9/14“, und der Schritt blieb offen.
  const counted = allMatches.filter((match) => !isCancelled(match));
  const totalMatches = counted.length;
  const completedMatches = counted.filter((m) => DONE_MATCH.has(m.status)).length;
  const published = status === "results_published" || status === "archived";

  const steps = staffel
    ? staffelSteps({ r, approved, matches: allMatches, published })
    : tournamentSteps({ r, approved, checkedIn, totalMatches, completedMatches, published, format: tournament?.format });

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
      <div className={stack ? "flex flex-col gap-1 sm:flex-row sm:items-stretch tls-swipe tls-swipe--room pb-1" : "flex items-stretch gap-1 tls-swipe tls-swipe--room pb-1"}>
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
            <div key={step.id} className={stack ? "flex items-center flex-1 min-w-0 sm:min-w-[120px]" : "flex items-center flex-1 min-w-[120px]"}>
              <button
                type="button"
                data-testid={`flow-step-${step.id}`}
                aria-current={isCurrent ? "step" : undefined}
                onClick={() => onNavigate?.(step.key)}
                className={stack ? "group flex min-h-[44px] flex-1 items-center gap-3 text-left focus:outline-none sm:flex-col sm:gap-1.5 sm:text-center" : "group flex flex-col items-center gap-1.5 flex-1 focus:outline-none"}
              >
                <span
                  className={`relative w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${ring} ${
                    isCurrent ? "animate-pulse" : ""
                  } group-hover:scale-110`}
                >
                  {state === "done" ? <Check className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
                </span>
                <span
                  className={`text-[11px] font-bold uppercase tracking-wider ${stack ? "flex-1 sm:flex-none sm:text-center" : "text-center"} transition-colors ${
                    state === "current" ? "text-[#FFD700]" : state === "done" ? "text-white" : "text-white/45"
                  }`}
                >
                  {step.label}
                </span>
                <span className="text-[10px] text-white/40 tabular-nums">{step.meta}</span>
              </button>
              {i < steps.length - 1 && (
                <span
                  className={`h-0.5 w-full max-w-[40px] -mt-6 rounded transition-colors duration-300 ${stack ? "hidden sm:block" : ""} ${
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
