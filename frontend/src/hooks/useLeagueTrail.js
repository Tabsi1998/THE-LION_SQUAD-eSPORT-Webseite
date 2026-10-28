import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { leagueTrail } from "@/lib/leagueTrail";

// Der Liga-Weg einer Staffel (#2110): fragt GET /api/leagues nur bei Turnieren mit ``league_context`` - alle anderen
// Seiten bleiben ohne Abruf. Seite und Reiter derselben Staffel teilen sich einen Abruf (30 Sekunden); nach einer
// Änderung an Ligen oder der Anmeldung wird neu gefragt. Bis die Antwort da ist (oder ohne sichtbare Season) null.
const FRESH_MS = 30_000;
let shared = null;

function loadLeagues() {
  if (!shared || Date.now() - shared.at > FRESH_MS) {
    shared = {
      at: Date.now(),
      request: api.get("/leagues")
        .then(({ data }) => (Array.isArray(data?.leagues) ? data.leagues : []))
        .catch(() => []),
    };
  }
  return shared.request;
}

/** Für Tests und nach Änderungen: der nächste Aufruf fragt neu. */
export function resetLeagueTrail() {
  shared = null;
}

export function useLeagueTrail(tournament) {
  const leagueId = tournament?.league_context?.league_id || "";
  const [leagues, setLeagues] = useState(null);
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => {
    resetLeagueTrail();
    setGeneration((value) => value + 1);
  }, []);
  useApiInvalidation(refresh, ["leagues", "auth"]);
  useEffect(() => {
    if (!leagueId) return undefined;
    let alive = true;
    loadLeagues().then((rows) => { if (alive) setLeagues(rows); });
    return () => { alive = false; };
  }, [leagueId, generation]);
  return leagueId && leagues ? leagueTrail(leagues, tournament) : null;
}
