import { Link } from "react-router-dom";
import { ChevronRight, ListOrdered } from "lucide-react";
import { leagueLine } from "@/lib/teamPage";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";

// Teamseite (docs/LIGA.md, P5, #1625): „Liga“ - die Co-Teams des Teams und ihre Staffel in laufenden Seasons, mit Weg
// auf die Ligaseite (oder das Staffel-Turnier, wenn die Season für die Person nicht sichtbar ist).
export function TeamLeague({ overview }) {
  const rows = overview?.league || [];
  if (!rows.length) return null;
  return (
    <section data-testid="team-league">
      <h2 className="font-heading text-2xl font-bold uppercase mb-4 flex items-center gap-2">
        <ListOrdered className="w-5 h-5 text-[#29B6E8]" aria-hidden="true" /> Liga
      </h2>
      <div className="grid gap-3">
        {rows.map((row) => (
          <Link key={row.registration_id} to={row.link} data-testid={`team-league-${row.registration_id}`}
            className="tls-card group flex items-center gap-4 border border-white/10 bg-[#121212] rounded-sm p-3 sm:p-4">
            {/* Emblem der Season bzw. Liga (#2107) - ohne Bild das Liga-Zeichen. */}
            <LeagueEmblem src={row.emblem_url} size={52} testId={`team-league-emblem-${row.registration_id}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">{row.staffel_label}</div>
              <div className="tls-card__title font-heading text-lg font-bold truncate">{row.squad_name || row.display_name}</div>
              <div className="text-xs text-white/55 truncate">{leagueLine(row)}</div>
            </div>
            <ChevronRight className="tls-card__arrow w-4 h-4 text-white/35 shrink-0" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}
