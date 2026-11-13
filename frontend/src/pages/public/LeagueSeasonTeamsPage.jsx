// Teams der Season (#2268) unter /liga/<liga>/<season>/teams: je Liga N und Staffel die Teams mit großem Logo (Teamseite), Platz
// und Punkten - jede Karte führt zur Teamseite. Sprungziel je Staffel: #staffel-<staffel>.
import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { StaggerIn } from "@/components/tls/motion";
import { SeasonShell } from "@/components/tls/league/public/SeasonShell";
import { SeasonPlaceholder } from "@/components/tls/league/public/SeasonParts";
import { TeamMark, useStaffel } from "@/components/tls/league/public/StaffelPanel";
import { staffelList } from "@/lib/leagueSeasonPage";

function TeamCard({ team, standing }) {
  const meta = standing && Number(standing.played) > 0 ? `Platz ${standing.rank} · ${standing.points ?? 0} ${Number(standing.points) === 1 ? "Punkt" : "Punkte"}` : "noch ohne Spiel";
  const body = (
    <>
      <TeamMark name={team.display_name} logo={team.logo_url} size={72} className="tls-season-team__logo" />
      <span className="tls-season-team__name">{team.display_name}</span>
      <span className="tls-season-team__meta">{meta}</span>
    </>
  );
  return (
    <li className="min-w-0" data-testid={`season-team-${team.id}`}>
      {team.team_id
        ? <Link to={`/teams/${team.team_id}`} className="tls-season-team">{body}</Link>
        : <div className="tls-season-team">{body}</div>}
    </li>
  );
}

function StaffelTeams({ leagueSlug, seasonSlug, staffel }) {
  // Ohne Live-Nachladen: N Staffeln im Takt wären N Abfragen alle 15 s - Platz und Punkte stehen beim nächsten Aufruf frisch da.
  const { data, error } = useStaffel(leagueSlug, seasonSlug, staffel.tournament_id, { live: false });
  const standings = Object.fromEntries((data?.standings || []).map((row) => [row.registration_id, row]));
  const teams = data?.teams || [];
  return (
    <section className="mt-10 scroll-mt-24" id={`staffel-${staffel.key}`} aria-labelledby={`teams-${staffel.key}`} data-testid={`season-teams-${staffel.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-3">
        <h2 id={`teams-${staffel.key}`} className="font-heading text-2xl font-black uppercase [overflow-wrap:anywhere] md:text-3xl">{staffel.label}</h2>
        {data ? <span className="text-xs font-bold uppercase tracking-wider text-white/45">{teams.length} {teams.length === 1 ? "Team" : "Teams"}</span> : null}
      </div>
      {error && !data ? <p className="mt-4 text-sm text-white/55" role="status">Die Teams konnten gerade nicht geladen werden.</p> : null}
      {!data && !error ? <div className="tls-league-skeleton mt-4" aria-busy="true" aria-label="Lade Teams" /> : null}
      {data && !teams.length ? <p className="mt-4 text-sm text-white/55">Noch keine Teams zugeteilt.</p> : null}
      {teams.length ? (
        <StaggerIn as="ul" className="tls-season-teams">
          {teams.map((team) => <TeamCard key={team.id} team={team} standing={standings[team.id]} />)}
        </StaggerIn>
      ) : null}
    </section>
  );
}

function Teams({ data }) {
  const { hash } = useLocation();
  const list = staffelList(data.divisions);
  useEffect(() => {
    if (!hash) return undefined;
    const timer = window.setTimeout(() => document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" }), 120);
    return () => window.clearTimeout(timer);
  }, [hash]);
  if (!list.length) return <SeasonPlaceholder season={data.season} application={data.application} />;
  return list.map((staffel) => (
    <StaffelTeams key={staffel.tournament_id} leagueSlug={data.league.slug} seasonSlug={data.season.slug} staffel={staffel} />
  ));
}

export default function LeagueSeasonTeamsPage() {
  return <SeasonShell section="teams">{(data) => <Teams data={data} />}</SeasonShell>;
}
