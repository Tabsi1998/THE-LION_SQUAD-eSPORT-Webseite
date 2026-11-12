// Eine Staffel auf der Ligaseite (docs/LIGA.md, P5, #1625; Unterseiten #2268). Daten aus
// GET /api/leagues/<liga>/<season>/staffeln/<staffel>; Live-Änderungen laden leise nach.
// - StaffelPanel (Übersicht): links die Tabelle (Punkte der Season, Gold nur für den Meister), rechts der aktuelle Spieltag und die
//   Wege zu Spieltagen und Teams.
// - StaffelPlan (Unterseite Spieltage): Woche für Woche - eine wischbare Leiste aller Wochen, darunter die gewählte Woche mit
//   Ergebnissen, Map-Chips und Modus-Symbolen; offene Spiele zeigen die Map-Reihenfolge der Season.
// Farben über die Marke bzw. --league-accent-rgb - auf der Ligaseite die Akzentfarbe der Liga (#2107), sonst die Vereinsfarbe.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Coffee, Crown, ExternalLink, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { StandingsTable, standingKey } from "@/components/tls/tournament/StandingsTable";
import { StaggerIn } from "@/components/tls/motion";
import { useChangedKeys, useFlipRows } from "@/hooks/useLiveChanges";
import { standingSignature } from "@/lib/liveChanges";
import { LazyImg } from "@/components/tls/LazyImg";
import { SizedImage } from "@/components/tls/SizedImage";
import { ModeIcon } from "@/components/tls/ModeIcon";
import { byMaps, hidesDraws, pointsNote, tiebreakOrder } from "@/lib/leagueTable";
import { notPlayedText } from "../leagueResultRules";
import {
  SOURCE_LABELS,
  matchWhen,
  openWeek,
  progressLine,
  scoreLine,
  weekHeading,
  winnerSide,
} from "@/lib/leaguePage";
import { hasReplay, sectionPath, teamInitials, weekDays, weekShort, weekState } from "@/lib/leagueSeasonPage";
import "./league.css";
import "./season.css";

/** Die Daten einer Staffel laden und live halten. */
export function useStaffel(leagueSlug, seasonSlug, tournamentId) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/leagues/${leagueSlug}/${seasonSlug}/staffeln/${tournamentId}`);
      setData(body);
      setError(false);
    } catch {
      setError(true);
    }
  }, [leagueSlug, seasonSlug, tournamentId]);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["tournaments", "matches"], { fallbackMs: 15000, tournamentId });
  return { data, error };
}

/** Logo eines Teams (Teamseite) - ohne Bild zwei Buchstaben auf der Akzentfarbe. */
export function TeamMark({ name, logo, size = 20, className = "" }) {
  return (
    <span className={`tls-team-mark ${className}`} style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.38)) }} aria-hidden="true">
      <SizedImage src={logo} size={size} alt="" style={{ objectFit: "contain" }} fallback={<span>{teamInitials(name)}</span>} />
    </span>
  );
}

function TeamName({ side, won, logo, align = "left" }) {
  if (!side) return <span className="text-white/40">–</span>;
  const tone = won ? "text-white font-bold" : "text-white/75";
  const inner = (
    <>
      {align === "left" ? <TeamMark name={side.name} logo={logo} /> : null}
      <span className="tls-league-match__name">{side.name}</span>
      {align === "right" ? <TeamMark name={side.name} logo={logo} /> : null}
    </>
  );
  return side.team_id ? (
    <Link to={`/teams/${side.team_id}`} title={side.name} data-align={align}
      className={`tls-league-match__team ${tone} hover:text-brand focus-visible:outline focus-visible:outline-1 focus-visible:outline-brand rounded-sm`}>
      {inner}
    </Link>
  ) : <span className={`tls-league-match__team ${tone}`} title={side.name} data-align={align}>{inner}</span>;
}

/** Zusatz einer Map (C.3, #1617) - wie auf der Matchseite. */
function mapNote(game) {
  if (game.decision === "awarded") return "zugesprochen";
  return game.status === "replayed" ? "wiederholt" : "";
}

export function MapChips({ match }) {
  if (!match.games?.length) return null;
  return (
    <>
      <ol className="tls-league-maps" aria-label="Maps">
        {match.games.map((game) => {
          const side = game.winner_registration_id === match.home?.registration_id ? "home"
            : game.winner_registration_id === match.away?.registration_id ? "away" : null;
          const winner = side === "home" ? match.home?.name : side === "away" ? match.away?.name : null;
          const note = mapNote(game);
          const why = note === "wiederholt" && game.replay_reason ? `: ${game.replay_reason}` : "";
          return (
            <li key={game.position} className="tls-league-map" data-side={side || undefined} data-testid={`league-map-${match.id}-${game.position}`}
              title={`Map ${game.position}: ${game.map_name || "Map"}${game.mode_label ? ` (${game.mode_label})` : ""}${winner ? ` – ${winner}` : ""}${note ? ` · ${note}${why}` : ""}`}>
              <span className="tls-league-map__thumb" aria-hidden="true">
                {game.map_image_url ? <LazyImg src={game.map_image_url} alt="" sizes="56px" widths={[160]} className="h-full w-full object-cover" /> : null}
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-white/85">
                  {/* Modus-Symbol (#2266): Schnappschuss am Spiel, ohne Bild das neutrale Symbol. */}
                  {game.mode ? <ModeIcon src={game.mode_icon_url} label={game.mode_label || ""} size="xs" testId={`league-map-${match.id}-${game.position}-mode`} /> : null}
                  <span className="truncate">{game.map_name || `Map ${game.position}`}</span>
                </span>
                <span className="block truncate text-[10px] text-white/45">{winner ? `für ${winner}` : "offen"}{note ? ` · ${note}` : ""}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {(match.not_played || []).length ? (
        <p className="text-[10px] text-white/45" data-testid={`league-maps-${match.id}-not-played`}>{notPlayedText(match.not_played)}</p>
      ) : null}
    </>
  );
}

/** Woche mit offenen Spielen: die Reihenfolge der Modi je Map (Season) - einmal je Woche, sie gilt für jedes Spiel gleich. */
function PlannedModes({ order, week }) {
  if (!order?.length || !(week.matches || []).some((match) => !match.done)) return null;
  return (
    <ol className="tls-league-planned" aria-label="Modus je Map" data-testid={`league-planned-${week.week}`}>
      <li className="tls-league-planned__title" aria-hidden="true">Modus je Map</li>
      {order.map((row) => (
        <li key={row.position} className="tls-league-planned__map" title={`Map ${row.position}: ${row.label}`}>
          <span className="tls-league-planned__nr" aria-hidden="true">{row.position}</span>
          <ModeIcon src={row.icon_url} label={row.label} size="xs" />
          <span className="truncate">{row.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Badge({ tone = "quiet", children, testId }) {
  return <span className="tls-league-badge" data-tone={tone} data-testid={testId}>{children}</span>;
}

export function MatchRow({ match, logos = {} }) {
  const winner = winnerSide(match);
  const score = scoreLine(match);
  return (
    <li className="tls-league-match" data-done={match.done ? "true" : undefined} data-testid={`league-match-${match.id}`}>
      <div className="tls-league-match__teams">
        <TeamName side={match.home} won={winner === "home"} logo={logos[match.home?.team_id]} />
        <Link to={`/matches/${match.id}`} className="tls-league-match__score" aria-label={`Zum Spiel ${match.home?.name || ""} gegen ${match.away?.name || ""}`}>
          {score || (match.done ? "–" : "vs")}
        </Link>
        <TeamName side={match.away} won={winner === "away"} logo={logos[match.away?.team_id]} align="right" />
      </div>
      <div className="tls-league-match__meta">
        <span className="flex flex-wrap items-center gap-1.5">
          {match.done
            ? (match.double_forfeit ? <Badge tone="warn">beide nicht erschienen</Badge>
              : match.forfeit ? <Badge tone="warn">kampflos</Badge> : <span>gespielt</span>)
            : <span>{matchWhen(match)}{match.scheduled_at && SOURCE_LABELS[match.schedule_source] ? ` · ${SOURCE_LABELS[match.schedule_source]}` : ""}</span>}
          {/* Wiederholte Map (C.3): hier nur, dass wiederholt wurde. */}
          {hasReplay(match) ? <Badge testId={`league-match-${match.id}-replayed`}>Map wiederholt</Badge> : null}
          {/* Vorfälle (D.5, #1619): öffentlich nur, dass eine Map in Klärung ist - das Ergebnis gilt bis zur Entscheidung nicht. */}
          {match.in_clarification ? <span className="font-semibold text-warn" data-testid={`league-match-${match.id}-clarification`}>in Klärung</span> : null}
          {/* Proteste (E.2, #1619): Das Ergebnis zählt vorläufig, ist aber angefochten - öffentlich nur „in Klärung“. */}
          {match.contested ? <span className="font-semibold text-warn" data-testid={`league-match-${match.id}-contested`}>in Klärung</span> : null}
        </span>
        <Link to={`/matches/${match.id}`} className="inline-flex items-center gap-1 text-brand hover:text-white">
          Spiel <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      {match.done ? <MapChips match={match} /> : null}
    </li>
  );
}

/** Der aktuelle Spieltag auf der Übersicht: offen, ohne Klappe - alle Wochen stehen unter Spieltage. */
function Week({ week, logos, order }) {
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
    <li className="tls-league-week" data-kind={week.kind} data-open="true" data-testid={`league-week-${week.week}`}>
      <div className="tls-league-week__head" id={headingId}>
        <span className="font-display font-bold text-white">{week.label}</span>
        <span className="text-xs text-white/45 tabular-nums">{weekHeading(week)}</span>
        <span className="ml-auto text-[11px] text-white/45">{progressLine(week)}</span>
      </div>
      {week.matches.length ? (
        <div className="tls-league-week__body">
          <PlannedModes order={order} week={week} />
          <StaggerIn as="ul" aria-labelledby={headingId} className="grid gap-2">
            {week.matches.map((match) => <MatchRow key={match.id} match={match} logos={logos} />)}
          </StaggerIn>
        </div>
      ) : null}
    </li>
  );
}

function logoMap(teams) {
  return Object.fromEntries((teams || []).filter((team) => team.team_id).map((team) => [team.team_id, team.logo_url || null]));
}

/** Platz 1 allein - geteilte Plätze haben (noch) keinen Meister. */
function soleLeader(rows) {
  const first = rows.filter((row) => Number(row.rank) === 1);
  return first.length === 1 ? first[0] : null;
}

function TableBlock({ data, staffel, champion }) {
  const rows = useMemo(() => (Array.isArray(data?.standings) ? data.standings : []), [data]);
  const tableRules = data?.staffel?.table_rules || null;
  const changed = useChangedKeys(rows, standingKey, standingSignature);
  const registerRow = useFlipRows(rows, standingKey);
  const leader = champion ? soleLeader(rows) : null;
  return (
    <StaggerIn className="tls-league-table" aria-label={`Tabelle Staffel ${staffel.staffel}`}>
      {/* Gold nur für den Meister (LSW-Farbregel): erst wenn die Staffel der obersten Liga beendet ist und Platz 1 allein steht. */}
      {leader ? (
        <p className="tls-league-champion" data-testid={`league-champion-${staffel.staffel}`}>
          <Crown className="h-4 w-4 shrink-0" aria-hidden="true" /> Meister <span className="min-w-0 text-white [overflow-wrap:anywhere]">{leader.display_name}</span>
        </p>
      ) : null}
      <StandingsTable rows={rows} kind="team_league" changed={changed} registerRow={registerRow} championKey={leader ? standingKey(leader) : null}
        label={`Tabelle Staffel ${staffel.staffel}`} mineLabel="Dein Team" hideDraws={hidesDraws(tableRules, rows)} mapPoints={byMaps(tableRules)} />
      {/* Reihenfolge bei Punktgleichheit (E.1, #1625) - dieselbe, nach der der Server sortiert. */}
      {/* Punkte nach gewonnenen Maps (#2312): sagt, was die Spalte „Pkt“ zählt. */}
      {pointsNote(tableRules) ? (
        <p className="mt-2 text-[11px] text-white/55" data-testid={`league-points-note-${staffel.staffel}`}>{pointsNote(tableRules)}</p>
      ) : null}
      {tableRules?.tiebreakers?.length ? (
        <p className={`${pointsNote(tableRules) ? "mt-1" : "mt-2"} text-[11px] text-white/45`} data-testid={`league-tiebreak-order-${staffel.staffel}`}>
          Reihenfolge: {tiebreakOrder(tableRules.tiebreakers)}
        </p>
      ) : null}
    </StaggerIn>
  );
}

const FINISHED = new Set(["completed", "finished", "archived"]);

/**
 * Übersicht: Tabelle und aktueller Spieltag einer Staffel. `topLevel`: die Staffel gehört zur obersten Liga - nur dort ist Platz 1
 * am Ende Meister. `order`: Map-Reihenfolge der Season (offene Spiele).
 */
export function StaffelPanel({ leagueSlug, seasonSlug, staffel, topLevel = false, order }) {
  const { data, error } = useStaffel(leagueSlug, seasonSlug, staffel.tournament_id);
  const logos = useMemo(() => logoMap(data?.teams), [data]);

  if (error && !data) {
    return <p className="text-sm text-white/55" role="status">Die Staffel konnte gerade nicht geladen werden.</p>;
  }
  if (!data) {
    return <div className="tls-league-skeleton" aria-busy="true" aria-label="Lade Staffel" />;
  }
  const weeks = data.weeks || [];
  const currentWeek = openWeek(weeks, data.current);
  const week = weeks.find((row) => row.week === currentWeek);
  const status = data.staffel?.status || staffel.status;
  const key = staffel.slug || staffel.tournament_id;
  const teams = data.teams || [];
  return (
    <div className="tls-league-staffel" data-testid={`league-staffel-${staffel.staffel}`}>
      <div className="min-w-0">
        <TableBlock data={data} staffel={staffel} champion={topLevel && FINISHED.has(status)} />
      </div>
      <section className="min-w-0" aria-labelledby={`league-plan-${staffel.staffel}-${key}`}>
        <h3 id={`league-plan-${staffel.staffel}-${key}`} className="tls-league-subhead">
          <CalendarDays className="h-4 w-4" aria-hidden="true" /> {week ? "Aktueller Spieltag" : "Spielplan"}
        </h3>
        {week ? (
          <ol className="tls-league-weeks">
            <Week week={week} logos={logos} order={order} />
          </ol>
        ) : <p className="text-sm text-white/55">Der Spielplan steht, sobald die Staffel startet.</p>}
        <div className="tls-league-links">
          <Link to={`${sectionPath(leagueSlug, seasonSlug, "spieltage")}?staffel=${encodeURIComponent(key)}`} className="tls-league-link"
            data-testid={`league-plan-link-${staffel.staffel}`}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" /> Spieltage <ArrowRight className="tls-league-link__arrow h-4 w-4" aria-hidden="true" />
          </Link>
          <Link to={`${sectionPath(leagueSlug, seasonSlug, "teams")}#staffel-${key}`} className="tls-league-link" data-testid={`league-teams-link-${staffel.staffel}`}>
            <Users className="h-4 w-4" aria-hidden="true" /> {teams.length} {teams.length === 1 ? "Team" : "Teams"}
            <ArrowRight className="tls-league-link__arrow h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}

/** Eine Woche groß: Kopf mit Tagen und Stand, darunter die Spiele. */
function WeekPanel({ week, logos, order }) {
  if (week.kind === "pause") {
    return (
      <div className="tls-league-weekpanel" data-kind="pause" data-testid={`league-weekpanel-${week.week}`}>
        <p className="flex items-center gap-2 font-heading text-xl font-bold uppercase text-white/80"><Coffee className="h-5 w-5" aria-hidden="true" /> {week.label}</p>
        <p className="mt-1 text-sm text-white/55">{weekHeading(week)} – in dieser Woche wird nicht gespielt.</p>
      </div>
    );
  }
  return (
    <div className="tls-league-weekpanel" data-kind={week.kind} data-testid={`league-weekpanel-${week.week}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-heading text-2xl font-black uppercase leading-none">{week.label}</h3>
        <p className="text-xs text-white/55 tabular-nums">{weekHeading(week)}{progressLine(week) ? ` · ${progressLine(week)}` : ""}</p>
      </div>
      <PlannedModes order={order} week={week} />
      {week.matches.length ? (
        <StaggerIn as="ul" key={week.week} className="tls-league-week__list">
          {week.matches.map((match) => <MatchRow key={match.id} match={match} logos={logos} />)}
        </StaggerIn>
      ) : <p className="mt-4 text-sm text-white/55">Reservewoche – hier landen verschobene Spiele.</p>}
    </div>
  );
}

/**
 * Spieltage einer Staffel (Unterseite): Leiste aller Wochen, darunter die gewählte. `week`/`onWeek`: die gewählte Woche (in der
 * Adresse als `?woche=`); ohne Wahl die laufende.
 */
export function StaffelPlan({ leagueSlug, seasonSlug, staffel, order, week: chosen, onWeek }) {
  const { data, error } = useStaffel(leagueSlug, seasonSlug, staffel.tournament_id);
  const weeks = useMemo(() => data?.weeks || [], [data]);
  const logos = useMemo(() => logoMap(data?.teams), [data]);
  const fallback = openWeek(weeks, data?.current);
  const selected = weeks.find((row) => row.week === chosen) || weeks.find((row) => row.week === fallback) || null;
  const strip = useRef(null);
  useEffect(() => {
    const node = strip.current?.querySelector('[aria-current="true"]');
    if (node && typeof node.scrollIntoView === "function") node.scrollIntoView({ block: "nearest", inline: "center" });
  }, [selected?.week]);

  if (error && !data) {
    return <p className="text-sm text-white/55" role="status">Die Staffel konnte gerade nicht geladen werden.</p>;
  }
  if (!data) {
    return <div className="tls-league-skeleton" aria-busy="true" aria-label="Lade Spieltage" />;
  }
  if (!weeks.length) {
    return <p className="tls-league-weekpanel text-sm text-white/60" data-testid={`league-plan-empty-${staffel.staffel}`}>Der Spielplan steht, sobald die Staffel startet.</p>;
  }
  const index = weeks.indexOf(selected);
  const step = (by) => {
    const next = weeks[index + by];
    if (next) onWeek(next.week);
  };
  return (
    <div className="tls-league-plan" data-testid={`league-plan-${staffel.staffel}`}>
      <ol ref={strip} className="tls-league-strip tls-swipe" aria-label="Spielwochen">
        {weeks.map((row) => {
          const current = row.week === selected?.week;
          const label = row.kind === "pause" ? row.label : weekShort(row);
          return (
            <li key={row.week} data-testid={`league-week-${row.week}`}>
              <button type="button" className="tls-league-strip__week" data-state={weekState(row)} aria-current={current ? "true" : undefined}
                title={`${label} · ${weekDays(row)}`} onClick={() => onWeek(row.week)}>
                <span className="tls-league-strip__label">{label}</span>
                <span className="tls-league-strip__days">{weekDays(row)}</span>
                <span className="tls-league-strip__dot" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      {selected ? <WeekPanel week={selected} logos={logos} order={order} /> : null}
      <div className="mt-3 flex items-center justify-between gap-3">
        <button type="button" className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center gap-1 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider"
          onClick={() => step(-1)} disabled={index <= 0} data-testid="league-week-prev">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" /> Woche davor
        </button>
        <button type="button" className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center gap-1 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider"
          onClick={() => step(1)} disabled={index >= weeks.length - 1} data-testid="league-week-next">
          Woche danach <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
