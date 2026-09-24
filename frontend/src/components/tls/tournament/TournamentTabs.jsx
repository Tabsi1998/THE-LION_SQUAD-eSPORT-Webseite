import { Link, useLocation } from "react-router-dom";
import { GitBranch, LayoutList, ListOrdered, Trophy, Users } from "lucide-react";

// Turnierseite (#401): eine Reihe Reiter statt sechs gleich schwerer Knöpfe - Übersicht, Teilnehmer, Spielplan,
// Rangliste, Turnierbaum. Die Unterseiten bleiben eigene Adressen; die Reiter stehen auf allen gleich.

export function tournamentTabs(t, accessToken = "", participantCount = null) {
  const base = `/tournaments/${t.slug || t.id}`;
  const suffix = accessToken ? `?access=${encodeURIComponent(accessToken)}` : "";
  return [
    { key: "overview", label: "Übersicht", to: `${base}${suffix}`, icon: LayoutList, match: (path) => path === base },
    { key: "participants", label: participantCount === null ? "Teilnehmer" : `Teilnehmer (${participantCount})`, to: `${base}${suffix}#teilnehmer`, icon: Users, match: () => false },
    { key: "schedule", label: "Spielplan", to: `${base}/matches${suffix}`, icon: ListOrdered, match: (path) => path.endsWith("/matches") },
    { key: "standings", label: "Rangliste", to: `${base}/standings${suffix}`, icon: Trophy, match: (path) => path.endsWith("/standings") },
    { key: "bracket", label: "Turnierbaum", to: `${base}/bracket${suffix}`, icon: GitBranch, match: (path) => path.endsWith("/bracket") },
  ];
}

export function TournamentTabs({ tournament, accessToken = "", participantCount = null, className = "" }) {
  const { pathname } = useLocation();
  const tabs = tournamentTabs(tournament, accessToken, participantCount);
  return (
    <nav aria-label="Turnierseiten" className={`flex flex-wrap gap-1 border-b border-white/10 ${className}`} data-testid="tournament-tabs">
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link key={tab.key} to={tab.to} data-testid={`tournament-tab-${tab.key}`} aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 -mb-px transition ${active ? "border-[#29B6E8] text-white" : "border-transparent text-white/55 hover:text-white"}`}>
            <tab.icon className="w-3.5 h-3.5" /> {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default TournamentTabs;
