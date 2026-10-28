import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Shield } from "lucide-react";
import { api } from "@/lib/api";
import { roleOf, rolesSummary } from "@/components/tls/league/squadRoles";

// Teamseite (#2110, L-D13): die Co-Teams des Teams mit Captain und Vertreter - nur für Mitglieder und die Teamleitung
// (GET /api/teams/:id/squads prüft das selbst; Außenstehende sehen nur „Liga“ ohne Kader). Die Nachricht „Du bist
// jetzt Captain“ führt hierher; „Co-Teams verwalten“ öffnet die Verwaltung unter „Deine Teams“ mit genau diesem Team.
export function TeamSquads({ team, userId, canManage = false, enabled = false }) {
  const [squads, setSquads] = useState(null);
  const teamId = team?.id;
  useEffect(() => {
    if (!enabled || !teamId) return undefined;
    let alive = true;
    api.get(`/teams/${teamId}/squads`)
      .then(({ data }) => { if (alive) setSquads(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setSquads([]); });
    return () => { alive = false; };
  }, [enabled, teamId]);
  const rows = (squads || []).filter((squad) => squad.status !== "archived");
  if (!enabled || !rows.length) return null;
  const holdsRole = rows.some((squad) => roleOf(squad, userId));
  return (
    <section data-testid="team-squads">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-heading text-2xl font-bold uppercase flex items-center gap-2">
          <Shield className="w-5 h-5 text-[#29B6E8]" aria-hidden="true" /> Co-Teams
        </h2>
        {canManage || holdsRole ? (
          <Link to={`/teams?team=${encodeURIComponent(teamId)}`} data-testid="team-squads-manage"
            className="tls-btn tls-btn--secondary inline-flex min-h-11 items-center px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">
            Co-Teams verwalten
          </Link>
        ) : null}
      </div>
      <ul className="grid sm:grid-cols-2 gap-3">
        {rows.map((squad) => {
          const mine = roleOf(squad, userId);
          return (
            <li key={squad.id} className="min-w-0 border border-white/10 bg-[#121212] rounded-sm p-4" data-testid={`team-squad-${squad.id}`}>
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0 font-heading text-lg font-bold [overflow-wrap:anywhere]">{squad.name}</div>
                {mine ? <span className="shrink-0 rounded-sm border border-[#FFD700]/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#FFD700]">Du: {mine.label}</span> : null}
              </div>
              <p className="mt-1 text-xs text-white/60 break-words" data-testid={`team-squad-roles-line-${squad.id}`}>{rolesSummary(squad, squad.members)}</p>
              <p className="mt-1 text-xs text-white/40">{(squad.members || []).length} im Kader</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
