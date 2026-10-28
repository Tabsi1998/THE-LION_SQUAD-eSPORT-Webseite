// Eine Staffel auf der Ligaseite (docs/LIGA.md, P5, #1625): links die Tabelle (Punkte der Season) und die Teams,
// rechts der Spielplan in Kalenderwochen - Pausen sichtbar, die laufende Woche offen, Ergebnisse mit Maps. Daten aus
// GET /api/leagues/<liga>/<season>/staffeln/<staffel>; Live-Änderungen laden leise nach. Farben über die Marke (text-brand)
// bzw. --league-accent-rgb - auf der Ligaseite ist das die Akzentfarbe der Liga (#2107), sonst die Vereinsfarbe.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronDown, Coffee, ExternalLink, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { StandingsTable, standingKey } from "@/components/tls/tournament/StandingsTable";
import { StaggerIn } from "@/components/tls/motion";
import { useChangedKeys, useFlipRows } from "@/hooks/useLiveChanges";
import { standingSignature } from "@/lib/liveChanges";
import { LazyImg } from "@/components/tls/LazyImg";
import {
  SOURCE_LABELS,
  matchWhen,
  openWeek,
  progressLine,
  scoreLine,
  weekHeading,
  winnerSide,
} from "@/lib/leaguePage";
import "./league.css";

function TeamName({ side, won }) {
  if (!side) return <span className="text-white/40">–</span>;
  const tone = won ? "text-white font-bold" : "text-white/75";
  return side.team_id ? (
    <Link to={`/teams/${side.team_id}`} title={side.name}
      className={`tls-league-match__team ${tone} hover:text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand rounded-sm`}>
      {side.name}
    </Link>
  ) : <span className={`tls-league-match__team ${tone}`} title={side.name}>{side.name}</span>;
}

function MapChips({ match }) {
  if (!match.games?.length) return null;
  return (
    <ol className="tls-league-maps" aria-label="Maps">
      {match.games.map((game) => {
        const side = game.winner_registration_id === match.home?.registration_id ? "home"
          : game.winner_registration_id === match.away?.registration_id ? "away" : null;
        const winner = side === "home" ? match.home?.name : side === "away" ? match.away?.name : null;
        return (
          <li key={game.position} className="tls-league-map" data-side={side || undefined}
            title={`Map ${game.position}: ${game.map_name || "Map"}${winner ? ` – ${winner}` : ""}`}>
            <span className="tls-league-map__thumb" aria-hidden="true">
              {game.map_image_url ? <LazyImg src={game.map_image_url} alt="" sizes="56px" widths={[160]} className="h-full w-full object-cover" /> : null}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-semibold text-white/85">{game.map_name || `Map ${game.position}`}</span>
              <span className="block truncate text-[10px] text-white/45">{winner ? `für ${winner}` : "offen"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function MatchRow({ match }) {
  const winner = winnerSide(match);
  const score = scoreLine(match);
  return (
    <li className="tls-league-match" data-done={match.done ? "true" : undefined} data-testid={`league-match-${match.id}`}>
      <div className="tls-league-match__teams">
        <TeamName side={match.home} won={winner === "home"} />
        <Link to={`/matches/${match.id}`} className="tls-league-match__score" aria-label={`Zum Spiel ${match.home?.name || ""} gegen ${match.away?.name || ""}`}>
          {score || "vs"}
        </Link>
        <TeamName side={match.away} won={winner === "away"} />
      </div>
      <div className="tls-league-match__meta">
        {match.done
          ? <span>{match.forfeit ? "kampflos" : "gespielt"}</span>
          : <span>{matchWhen(match)}{match.scheduled_at && SOURCE_LABELS[match.schedule_source] ? ` · ${SOURCE_LABELS[match.schedule_source]}` : ""}</span>}
        <Link to={`/matches/${match.id}`} className="inline-flex items-center gap-1 text-brand hover:text-white">
          Spiel <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <MapChips match={match} />
    </li>
  );
}

function Week({ week, open, onToggle }) {
  if (week.kind === "pause") {
    return (
      <li className="tls-league-week" data-kind="pause" data-testid={`league-week-${week.week}`}>
        <div className="tls-league-week__head">
          <Coffee className="h-4 w-4 text-white/40" aria-hidden="true" />
          <span className="font-semibold text-white/70">{week.label}</span>
          <span className="ml-auto text-xs text-white/40 tabular-nums">{weekHeading(week)}</span>
        </div>
      </li>
    );
  }
  const headingId = `league-week-${week.week}-head`;
  return (
    <li className="tls-league-week" data-kind={week.kind} data-open={open ? "true" : undefined} data-testid={`league-week-${week.week}`}>
      <button type="button" className="tls-league-week__head tls-league-week__toggle" aria-expanded={open} aria-controls={`${headingId}-body`}
        id={headingId} onClick={onToggle} disabled={!week.matches.length}>
        <span className="font-display font-bold text-white">{week.label}</span>
        <span className="text-xs text-white/45 tabular-nums">{weekHeading(week)}</span>
        <span className="ml-auto text-[11px] text-white/45">{progressLine(week)}</span>
        {week.matches.length ? <ChevronDown className="tls-league-week__chevron h-4 w-4 text-white/40" aria-hidden="true" /> : null}
      </button>
      {open && week.matches.length ? (
        <StaggerIn as="ul" id={`${headingId}-body`} aria-labelledby={headingId} className="tls-league-week__body">
          {week.matches.map((match) => <MatchRow key={match.id} match={match} />)}
        </StaggerIn>
      ) : null}
    </li>
  );
}

export function StaffelPanel({ leagueSlug, seasonSlug, staffel }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [openWeeks, setOpenWeeks] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/leagues/${leagueSlug}/${seasonSlug}/staffeln/${staffel.tournament_id}`);
      setData(body);
      setError(false);
    } catch {
      setError(true);
    }
  }, [leagueSlug, seasonSlug, staffel.tournament_id]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["tournaments", "matches"], { fallbackMs: 15000, tournamentId: staffel.tournament_id });

  const rows = useMemo(() => (Array.isArray(data?.standings) ? data.standings : []), [data]);
  const changed = useChangedKeys(rows, standingKey, standingSignature);
  const registerRow = useFlipRows(rows, standingKey);
  const weeks = data?.weeks || [];
  const opened = openWeeks ?? new Set([openWeek(weeks, data?.current)].filter(Boolean));
  const toggle = (number) => {
    const next = new Set(opened);
    if (next.has(number)) next.delete(number);
    else next.add(number);
    setOpenWeeks(next);
  };

  if (error && !data) {
    return <p className="text-sm text-white/55" role="status">Die Staffel konnte gerade nicht geladen werden.</p>;
  }
  if (!data) {
    return <div className="tls-league-skeleton" aria-busy="true" aria-label="Lade Staffel" />;
  }
  return (
    <div className="tls-league-staffel" data-testid={`league-staffel-${staffel.staffel}`}>
      <div className="min-w-0 space-y-6">
        <StaggerIn className="tls-league-table" aria-label={`Tabelle Staffel ${staffel.staffel}`}>
          <StandingsTable rows={rows} kind="team_league" changed={changed} registerRow={registerRow}
            label={`Tabelle Staffel ${staffel.staffel}`} mineLabel="Dein Team" />
        </StaggerIn>
        <section aria-labelledby={`league-teams-${staffel.staffel}`}>
          <h4 id={`league-teams-${staffel.staffel}`} className="tls-league-subhead"><Users className="h-4 w-4" aria-hidden="true" /> Teams</h4>
          <ul className="tls-league-teams">
            {data.teams.map((team) => (
              <li key={team.id}>
                {team.team_id
                  ? <Link to={`/teams/${team.team_id}`} className="tls-league-team" data-testid={`league-team-${team.id}`}>{team.display_name}</Link>
                  : <span className="tls-league-team">{team.display_name}</span>}
              </li>
            ))}
            {!data.teams.length ? <li className="text-sm text-white/50">Noch keine Teams zugeteilt.</li> : null}
          </ul>
        </section>
        <Link to={`/tournaments/${staffel.slug || staffel.tournament_id}`} className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/55 hover:text-brand">
          Staffel als Turnier öffnen <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <section className="min-w-0" aria-labelledby={`league-plan-${staffel.staffel}`}>
        <h4 id={`league-plan-${staffel.staffel}`} className="tls-league-subhead"><CalendarDays className="h-4 w-4" aria-hidden="true" /> Spielplan</h4>
        {weeks.length ? (
          <ol className="tls-league-weeks">
            {weeks.map((week) => (
              <Week key={week.week} week={week} open={opened.has(week.week)} onToggle={() => toggle(week.week)} />
            ))}
          </ol>
        ) : <p className="text-sm text-white/55">Der Spielplan steht, sobald die Staffel startet.</p>}
      </section>
    </div>
  );
}
