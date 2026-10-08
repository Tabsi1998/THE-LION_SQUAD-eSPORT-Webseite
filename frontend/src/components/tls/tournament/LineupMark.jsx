import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

// Team am Spieltag (#1192) für die Turnierleitung beim Check-in: wer laut Aufstellung spielt, wer Ersatz ist und wie
// viele schon „Ich bin da“ getippt haben. Nur bei Team-Turnieren; ohne Aufstellung steht „ganzes Team“ da.

export function useTeamLineups(tournament) {
  const [lineups, setLineups] = useState({});
  const teamMode = (tournament?.team_mode || "solo") !== "solo";
  const id = tournament?.id;
  const load = useCallback(async () => {
    if (!id || !teamMode) return;
    try {
      const { data } = await api.get(`/team-day/${id}/lineups`);
      setLineups(data || {});
    } catch {
      setLineups({});
    }
  }, [id, teamMode]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments"]);
  return lineups;
}

export function LineupMark({ info }) {
  if (!info) return null;
  const names = (rows) => rows.map((row) => row.name).join(", ");
  return (
    <div className="mt-1 text-[11px] text-white/55" data-testid="admin-reg-lineup">
      {info.lineup_set ? (
        <>
          <span className="text-white/75">Spielt: {names(info.starters)}</span>
          {info.substitutes?.length ? <span> · Ersatz: {names(info.substitutes)}</span> : null}
        </>
      ) : <span>Keine Aufstellung – ganzes Team</span>}
      {info.total ? <span className="text-[#29B6E8]"> · {info.present} von {info.total} da</span> : null}
    </div>
  );
}

export default LineupMark;
