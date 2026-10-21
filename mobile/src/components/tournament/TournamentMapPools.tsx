import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { api } from "../../lib/api";
import { idSegment } from "../../lib/apiIds";
import { tournamentPoolSections } from "../../lib/teamLeague";
import { Card } from "../Card";
import { MapPoolView } from "../references/MapCards";

// Map-Pool eines Turniers in der App (#1616, #1974), wie auf der Turnierseite im Web (TournamentMapPools.jsx): der Pool
// des Turniers und je Phase mit eigenem Pool „Map-Pool · Phase“, je Modus mit Bild. Geladen nur mit Spiel; kommt nichts
// (älterer Server, kein Pool, kein Zugriff), steht nichts da.

type Overview = Parameters<typeof tournamentPoolSections>[0];

export function TournamentMapPools({ tournamentId, gameId }: { tournamentId: string; gameId?: string | null }) {
  const [overview, setOverview] = useState<Overview>(null);
  useEffect(() => {
    if (!gameId || !tournamentId) {
      setOverview(null);
      return undefined;
    }
    let alive = true;
    api.get<Overview>(`/map-pools/tournaments/${idSegment(tournamentId)}`)
      .then(({ data }) => { if (alive) setOverview(data && typeof data === "object" && !Array.isArray(data) ? data : null); })
      .catch(() => { if (alive) setOverview(null); });
    return () => { alive = false; };
  }, [gameId, tournamentId]);
  const sections = tournamentPoolSections(overview);
  if (!sections.length) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.sections} testID="tournament-map-pools">
        {sections.map((section) => <MapPoolView key={section.key} title={section.title} groups={section.groups} testID={`tournament-map-pool-${section.key}`} />)}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  sections: { gap: 18 },
});
