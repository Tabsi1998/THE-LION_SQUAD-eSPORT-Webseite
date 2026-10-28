import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { leagueTrail } from "@/lib/leagueTrail";

// Der Liga-Weg einer Staffel (#2110): fragt GET /api/leagues nur bei Turnieren mit ``league_context`` - alle anderen
// Seiten bleiben ohne Abruf. Bis die Antwort da ist (oder ohne sichtbare Season) null.
export function useLeagueTrail(tournament) {
  const leagueId = tournament?.league_context?.league_id || "";
  const [leagues, setLeagues] = useState(null);
  useEffect(() => {
    if (!leagueId) return undefined;
    let alive = true;
    api.get("/leagues")
      .then(({ data }) => { if (alive) setLeagues(Array.isArray(data?.leagues) ? data.leagues : []); })
      .catch(() => { if (alive) setLeagues([]); });
    return () => { alive = false; };
  }, [leagueId]);
  return leagueId && leagues ? leagueTrail(leagues, tournament) : null;
}
