import { Link } from "react-router-dom";
import { CalendarClock, ChevronRight, Swords, Trophy } from "lucide-react";
import { outcomeLabel, recentLine, upcomingLine } from "@/lib/teamPage";

// Team-Seite (#1191): „Angemeldet für“ (kommende Team-Turniere mit Tag und Stand) und „Letzte Spiele“ (mit Sieg oder
// Niederlage) aus den Team-Anmeldungen. Farben nach „Jede Farbe hat eine Aufgabe“: Sieg hell mit Cyan, Niederlage
// grau - Rot heißt auf der Seite nur „läuft gerade“.

const OUTCOME_TONES = {
  win: "border-[#29B6E8]/45 bg-[#29B6E8]/10 text-[#7FDBFF]",
  draw: "border-white/20 bg-white/[0.06] text-white/75",
  loss: "border-white/10 bg-white/[0.03] text-white/45",
};

export function TeamSchedule({ overview }) {
  const upcoming = overview?.upcoming || [];
  const recent = overview?.recent || [];
  if (!upcoming.length && !recent.length) return null;
  return (
    <div className="space-y-8" data-testid="team-schedule">
      {upcoming.length > 0 && (
        <section data-testid="team-upcoming">
          <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2"><CalendarClock className="w-5 h-5 text-[#29B6E8]" /> Angemeldet für</h2>
          <div className="grid gap-3">
            {upcoming.map((row) => (
              <Link
                key={row.registration_id}
                to={`/tournaments/${row.tournament.slug || row.tournament.id}`}
                data-testid={`team-upcoming-${row.registration_id}`}
                className="tls-card group flex items-center gap-4 border border-white/10 bg-[#121212] rounded-sm p-3 sm:p-4"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 rounded-sm border border-[#FFD700]/30 bg-[#FFD700]/[0.06] flex items-center justify-center">
                  <Trophy className="w-5 h-5 text-[#FFD700]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-[#FFD700]">Turnier</div>
                  <div className="tls-card__title font-heading text-lg font-bold truncate">{row.tournament.title}</div>
                  <div className="text-xs text-white/55 truncate">{upcomingLine(row)}</div>
                  <span className="mt-1.5 inline-flex px-2 py-0.5 border border-[#FFD700]/40 bg-[#FFD700]/10 text-[#FFD700] rounded-sm text-[10px] font-bold uppercase tracking-wider" data-testid={`team-upcoming-status-${row.registration_id}`}>
                    {row.status_label}
                  </span>
                </div>
                <ChevronRight className="tls-card__arrow w-4 h-4 text-white/35 shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      )}
      {recent.length > 0 && (
        <section data-testid="team-recent">
          <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2"><Swords className="w-5 h-5 text-[#29B6E8]" /> Letzte Spiele</h2>
          <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5">
            {recent.map((row) => (
              <Link key={row.match_id} to={`/matches/${row.match_id}`} data-testid={`team-recent-${row.match_id}`} className="flex items-center gap-3 px-3 sm:px-4 py-3 hover:bg-white/[0.03] transition">
                <div className={`w-9 h-9 shrink-0 rounded-sm border flex items-center justify-center ${OUTCOME_TONES[row.outcome] || OUTCOME_TONES.draw}`}>
                  <Trophy className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className={`font-bold text-sm truncate ${row.outcome === "loss" ? "text-white/60" : "text-white"}`}>{recentLine(row)}</div>
                  <div className="text-xs text-white/45 truncate">{[row.tournament?.title, row.round_label].filter(Boolean).join(" · ")}</div>
                </div>
                <span className={`shrink-0 px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-wider ${OUTCOME_TONES[row.outcome] || OUTCOME_TONES.draw}`} data-testid={`team-recent-outcome-${row.match_id}`}>
                  {outcomeLabel(row)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default TeamSchedule;
