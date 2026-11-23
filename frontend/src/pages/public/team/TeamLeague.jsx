import { LeagueCurrent } from "@/components/tls/league/LeagueCurrent";

// Teamseite (docs/LIGA.md, P5, #1625): „Liga“ - die Co-Teams des Teams in laufenden Seasons mit Liga-Abzeichen (#1638), Staffel,
// Platz von N, Zone und nächstem Spiel (#1630), beste Liga N oben (der Server sortiert). Der Weg führt auf die Ligaseite (oder das
// Staffel-Turnier, wenn die Season für die Person nicht sichtbar ist).
export function TeamLeague({ overview }) {
  return <LeagueCurrent rows={overview?.league} title="Liga" testId="team-league" />;
}
