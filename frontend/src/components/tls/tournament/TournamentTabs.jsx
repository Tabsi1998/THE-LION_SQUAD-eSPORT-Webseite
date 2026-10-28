import { Link, useLocation } from "react-router-dom";
import { GitBranch, LayoutList, ListOrdered, Shield, Trophy, Users } from "lucide-react";
import { useLeagueTrail } from "@/hooks/useLeagueTrail";
import { hasBracketTree } from "@/lib/tournamentLabels";

// Turnierseite (#401): eine Reihe Reiter statt sechs gleich schwerer Knöpfe - Übersicht, Teilnehmer, Spielplan,
// Rangliste, Turnierbaum. Die Unterseiten bleiben eigene Adressen; die Reiter stehen auf allen gleich.
// Liga-Staffel (#2110): dazu der Reiter „Liga“ - zur Staffel auf der Ligaseite, wenn die Person die Season sieht.

export function tournamentTabs(t, accessToken = "", participantCount = null, trail = null) {
  const base = `/tournaments/${t.slug || t.id}`;
  const suffix = accessToken ? `?access=${encodeURIComponent(accessToken)}` : "";
  const tabs = [
    { key: "overview", label: "Übersicht", to: `${base}${suffix}`, icon: LayoutList, match: (path) => path === base },
    { key: "participants", label: participantCount === null ? "Teilnehmer" : `Teilnehmer (${participantCount})`, to: `${base}${suffix}#teilnehmer`, icon: Users, match: () => false },
    { key: "schedule", label: "Spielplan", to: `${base}/matches${suffix}`, icon: ListOrdered, match: (path) => path.endsWith("/matches") },
    { key: "standings", label: "Rangliste", to: `${base}/standings${suffix}`, icon: Trophy, match: (path) => path.endsWith("/standings") },
    // Ohne Turnierbaum (#2124): Jeder gegen jeden, Liga, Zeitfahren, Rennserie - dort kein Reiter „Turnierbaum“.
    ...(hasBracketTree(t) ? [{ key: "bracket", label: "Turnierbaum", to: `${base}/bracket${suffix}`, icon: GitBranch, match: (path) => path.endsWith("/bracket") }] : []),
  ];
  if (trail?.staffelHref) {
    tabs.push({ key: "league", label: "Liga", to: trail.staffelHref, icon: Shield, match: () => false });
  }
  return tabs;
}

export function TournamentTabs({ tournament, accessToken = "", participantCount = null, className = "" }) {
  const { pathname } = useLocation();
  const trail = useLeagueTrail(tournament);
  const tabs = tournamentTabs(tournament, accessToken, participantCount, trail);
  return (
    <nav aria-label="Turnierseiten" className={`flex flex-wrap gap-1 border-b border-white/10 ${className}`} data-testid="tournament-tabs">
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link key={tab.key} to={tab.to} data-testid={`tournament-tab-${tab.key}`} aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-1.5 px-4 py-2.5 text-xs font-bold uppercase tracking-wider border-b-2 -mb-px transition ${active ? "border-[#29B6E8] text-white" : "border-transparent text-white/55 hover:text-white"}`}>
            <tab.icon className="w-3.5 h-3.5" /> {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default TournamentTabs;
