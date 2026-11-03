// Team-Seite (docs/LIGA.md, B.4, #2205): der Stand der Liga-Anmeldung je Co-Team, mit Link zur Ligaseite. Dort stehen Knopf, Zurückziehen und alles Weitere.
import { Link } from "react-router-dom";
import { ApplicationStateBadge } from "./LeagueApplicationPanel";

export function SquadApplicationStatus({ items = [] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 space-y-2 border-t border-white/10 pt-3" aria-label="Liga-Anmeldungen">
      {items.map((row) => (
        <li key={row.id} data-testid={`squad-application-${row.id}`}>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={row.url} className="min-w-0 text-sm font-semibold text-[#29B6E8] hover:underline [overflow-wrap:anywhere]">{row.title}</Link>
            <ApplicationStateBadge state={row.status} />
          </div>
          {row.staffel ? <p className="mt-0.5 text-xs text-white/65">{row.staffel_left ? `Nicht mehr in ${row.staffel}.` : `Spielt in ${row.staffel}.`}</p> : null}
          {row.decision_reason ? <p className="mt-0.5 text-xs text-white/65 [overflow-wrap:anywhere]">Grund: {row.decision_reason}</p> : null}
        </li>
      ))}
    </ul>
  );
}
