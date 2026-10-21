// Map-Pools auf der Turnierseite (#1616): der Pool des Turniers und jede Phase mit eigenem Pool als eigener Abschnitt.
// Ohne Pool (maploser Cup) oder wenn der Abruf scheitert, erscheint nichts.
import { useCallback, useEffect, useState } from "react";
import { Map as MapIcon } from "lucide-react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { poolSections } from "@/lib/mapPools";
import { MapPoolView } from "./MapPoolView";

export function TournamentMapPools({ tournamentId }) {
  const [overview, setOverview] = useState(null);
  const load = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const { data } = await api.get(`/map-pools/tournaments/${tournamentId}`);
      setOverview(data || null);
    } catch {
      setOverview(null);
    }
  }, [tournamentId]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["map-pools"]);

  const sections = poolSections(overview);
  if (!sections.length) return null;
  return (
    <div className="space-y-8" data-testid="tournament-map-pools">
      {sections.map((section) => (
        <MapPoolView key={section.key} pool={section.pool} title={section.title} className="" headingId={`map-pool-${section.key}`}
          headingClass="font-heading text-2xl font-bold uppercase mb-3 flex items-center gap-2" icon={MapIcon} />
      ))}
    </div>
  );
}
