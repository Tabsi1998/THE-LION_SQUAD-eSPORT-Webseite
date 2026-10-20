import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { METALS } from "@/components/tls/TrophyShelf";
import { StandingsTable } from "@/components/tls/tournament/StandingsTable";
import { formatNumber } from "@/lib/standingsTable";
import { PUBLIC_STATE_LABELS, STATE_TONES, dayLabel, roundLabel, roundWhen } from "@/lib/referenceCalendar";
import { nameOf } from "@/lib/referenceSeriesTable";
import {
  OUTCOMES, mapShare, matchPointsLabel, matchdayProgress, pathRankLabel, rankTrend, tableRows, tableTiebreakLabel,
} from "@/lib/teamLeague";
import "./referenceSeries.css";
import "./teamLeague.css";

// Seite Team-Liga (#1747) auf der Serienseite: Spieltage mit dem nächsten Gegner, Tabelle (Rangliste der Turniere,
// Punkte und Vorrang aus den Regeln der Serie), Platzierungsverlauf, Spielplan mit Ergebnis und Maps aus eigener Sicht,
// Aufstellung (Einsätze je Spieler; Gäste getrennt, sie zählen nicht in die Vereinsstatistik) und der Liga-Weg über die
// Saisons der Spur. Alles kommt gespeichert vom Server. Fremde Namen stehen nur in Tabellen und nur als Text - nur
// Vereinsmitglieder verlinken auf ihr Profil. Farben wie überall: Sieg Cyan, Niederlage grau, Gold dem Podest.

const STAGGER_MAX = 12;
const PODIUM = { 1: METALS.gold, 2: METALS.silver, 3: METALS.bronze };

function stagger(index) {
  return { "--i": Math.min(index, STAGGER_MAX) };
}

function SectionTitle({ id, children }) {
  return <h2 id={id} className="font-heading text-2xl font-black uppercase">{children}</h2>;
}

/** Ein Feld je Spieltag (gespielt in Cyan), darunter der nächste Spieltag mit Gegner. */
function MatchdayProgress({ matchdays }) {
  const progress = matchdayProgress(matchdays);
  const next = progress.next;
  return (
    <section className="mt-8" aria-labelledby="team-league-progress" data-testid="team-league-progress">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 id="team-league-progress" className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/55">Spieltage</h2>
        <p className="text-sm text-white/80 tabular-nums">
          <span className="font-display text-xl font-bold text-white">{progress.played}</span>
          <span className="text-white/50"> von {progress.total} gespielt</span>
          {progress.cancelled > 0 && <span className="text-white/40"> · {progress.cancelled} abgesagt</span>}
        </p>
      </div>
      {matchdays.length > 0 && (
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {matchdays.map((day) => (
            <span key={day.round.id} className="tls-series-step" data-state={day.match ? "scored" : day.round.state} data-outcome={day.match?.outcome} title={`${roundLabel(day.round)} · ${roundWhen(day.round)}`} />
          ))}
        </div>
      )}
      {next && (
        <p className="mt-3 text-sm text-white/70" data-testid="team-league-next">
          <span className="text-white/45">Nächster Spieltag: </span>
          <span className="text-white font-semibold">{roundLabel(next)}</span>
          <span className="tabular-nums"> · {roundWhen(next)}</span>
          {next.opponent && <span> · gegen <span className="text-white">{next.opponent}</span></span>}
        </p>
      )}
    </section>
  );
}

/** Platz des eigenen Teams nach jedem Spieltag, mit Pfeil gegenüber dem davor. */
function RankTrend({ history, rounds }) {
  const items = rankTrend(history);
  if (items.length < 2) return null;
  const codeOf = (id) => roundLabel((rounds || []).find((round) => round.id === id) || {});
  return (
    <div className="mt-4" data-testid="team-league-trend">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/45">Platzierungsverlauf</h3>
      <ol className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item, index) => {
          const label = `${codeOf(item.round_id)}: Platz ${item.rank} von ${item.teams}`;
          const Icon = item.direction === "up" ? ChevronUp : item.direction === "down" ? ChevronDown : null;
          return (
            <li key={item.round_id} className="tls-tl-trend" data-dir={item.direction || undefined} style={stagger(index)} title={label}>
              <span className="sr-only">{label}</span>
              <span className="text-white/45" aria-hidden="true">{codeOf(item.round_id)}</span>
              <span className="font-display font-bold text-white tabular-nums" aria-hidden="true">{item.rank}.</span>
              {Icon && <Icon className="h-3 w-3" strokeWidth={3} aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function LeagueTable({ league, rounds }) {
  const rows = tableRows(league.table);
  return (
    <section className="mt-10" aria-labelledby="team-league-table" data-testid="team-league-table">
      <SectionTitle id="team-league-table">Tabelle</SectionTitle>
      <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm" data-testid="team-league-rules">
        <div className="flex gap-3 min-w-0">
          <dt className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-[0.16em] text-white/45 pt-0.5">Punkte</dt>
          <dd className="text-white/80 min-w-0">{matchPointsLabel(league.rules)}</dd>
        </div>
        <div className="flex gap-3 min-w-0">
          <dt className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-[0.16em] text-white/45 pt-0.5">Gleichstand</dt>
          <dd className="text-white/80 min-w-0">{tableTiebreakLabel(league.rules)}</dd>
        </div>
      </dl>
      <div className="tls-tl-table mt-4" data-testid="team-league-table-wrap">
        {rows.length ? (
          <StandingsTable rows={rows} kind="team_league" label="Tabelle" mineLabel="Verein" />
        ) : (
          <p className="text-sm text-white/55">Die Tabelle steht hier nach dem ersten Spieltag.</p>
        )}
      </div>
      <RankTrend history={league.rank_history} rounds={rounds} />
    </section>
  );
}

function Score({ match }) {
  const outcome = OUTCOMES[match.outcome];
  const label = `${outcome.word} ${formatNumber(match.score_for)}:${formatNumber(match.score_against)}, ${formatNumber(match.points)} ${Number(match.points) === 1 ? "Punkt" : "Punkte"}`;
  return (
    <span className="tls-tl-score" data-outcome={match.outcome} role="img" aria-label={label} title={label}>
      <span className="tls-tl-score__badge" aria-hidden="true">{outcome.letter}</span>
      <span className="font-display text-xl font-bold tabular-nums" aria-hidden="true">{formatNumber(match.score_for)}:{formatNumber(match.score_against)}</span>
    </span>
  );
}

function Maps({ maps }) {
  if (!maps.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Maps" data-testid="team-league-maps">
      {maps.map((map, index) => (
        // Maps können gleich heißen (Rückspiel auf derselben Karte) - der Index gehört zum Schlüssel.
        <li key={`${map.name}-${index}`} className="tls-tl-map" data-outcome={map.outcome} style={{ "--share": mapShare(map) }}>
          <span className="text-white/60 truncate max-w-[9rem]">{map.name}</span>
          <span className="tabular-nums text-white/85">{formatNumber(map.score_for)}:{formatNumber(map.score_against)}</span>
          <span className="tls-tl-map__bar" aria-hidden="true"><span className="tls-tl-map__fill" /></span>
          <span className="sr-only">{OUTCOMES[map.outcome]?.word}</span>
        </li>
      ))}
    </ul>
  );
}

function Schedule({ matchdays }) {
  return (
    <section className="mt-12" aria-labelledby="team-league-schedule" data-testid="team-league-schedule">
      <SectionTitle id="team-league-schedule">Spielplan</SectionTitle>
      {matchdays.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Noch keine Spieltage.</p>
      ) : (
        <ol className="mt-4 divide-y divide-white/5 border-y border-white/10">
          {matchdays.map(({ round, match }, index) => {
            const opponent = match?.opponent || round.opponent;
            return (
              <li key={round.id} className="tls-series-row py-3 flex items-start gap-3" style={stagger(index)} data-testid="team-league-matchday" data-state={round.state} data-outcome={match?.outcome}>
                <span className="w-12 shrink-0 font-black tabular-nums text-white/80 pt-0.5">{roundLabel(round)}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm tabular-nums ${round.state === "cancelled" ? "text-white/45" : "text-white/70"}`}>{roundWhen(round)}</span>
                  {opponent && (
                    <span className="block text-[15px] text-white font-semibold">
                      <span className="text-white/45 font-normal">gegen </span>{opponent}
                      {match && <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-white/40">{match.home ? "Heim" : "Auswärts"}</span>}
                    </span>
                  )}
                  {round.original_club_day && <span className="block text-[11px] text-white/45">ursprünglich {dayLabel(round.original_club_day)}</span>}
                  {match && <Maps maps={match.maps} />}
                </span>
                {match ? <Score match={match} /> : (
                  <span className={`inline-flex items-center px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${STATE_TONES[round.state] || STATE_TONES.planned}`}>
                    {PUBLIC_STATE_LABELS[round.state] || round.state}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function PlayerName({ player }) {
  const name = nameOf(player);
  return (
    <span className="flex items-center gap-2 min-w-0">
      {player.club_member && player.profile_slug && !player.name_hidden ? (
        <Link to={`/members/${player.profile_slug}`} className="tls-standing-name text-white font-semibold hover:text-[#29B6E8] focus-visible:text-[#29B6E8]">{name}</Link>
      ) : (
        <span className={`tls-standing-name ${player.name_hidden ? "text-white/40 italic" : "text-white font-medium"}`}>{name}</span>
      )}
      {player.club_member && <span className="tls-standing-me">Verein</span>}
    </span>
  );
}

function LineupRows({ players, roundIds, offset }) {
  return players.map((player, index) => (
    <tr key={player.key} className="tls-series-row border-t border-white/5" style={stagger(offset + index)} data-testid="team-league-player" data-guest={player.guest ? "true" : undefined}>
      <th scope="row" className="text-left font-normal pl-3 sm:pl-4 pr-2 py-2.5">
        <PlayerName player={player} />
      </th>
      {roundIds.map((id) => (
        <td key={id} className="hidden sm:table-cell px-1.5 py-2.5 text-center">
          {player.round_ids.includes(id)
            ? <><Check className="inline h-3.5 w-3.5 text-[#29B6E8]" strokeWidth={3} aria-hidden="true" /><span className="sr-only">gespielt</span></>
            : <><span className="text-white/20" aria-hidden="true">–</span><span className="sr-only">nicht gespielt</span></>}
        </td>
      ))}
      <td className="px-2 py-2.5 text-right font-display text-base font-bold text-white">{player.appearances}</td>
      <td className="pr-3 sm:pr-4 pl-2 py-2.5 text-right text-white/60">{player.all_seasons ?? "–"}</td>
    </tr>
  ));
}

function Lineup({ lineup, rounds }) {
  const roundIds = lineup?.round_ids || [];
  const players = lineup?.players || [];
  const members = players.filter((player) => !player.guest);
  const guests = players.filter((player) => player.guest);
  const codeOf = (id) => roundLabel((rounds || []).find((round) => round.id === id) || {});
  const span = roundIds.length + 3;
  return (
    <section className="mt-12" aria-labelledby="team-league-lineup" data-testid="team-league-lineup">
      <SectionTitle id="team-league-lineup">Aufstellung</SectionTitle>
      <p className="mt-2 text-sm text-white/55">Wer an welchem Spieltag gespielt hat. Gäste zählen nicht in die Vereinsstatistik.</p>
      {players.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Noch keine Aufstellung eingetragen.</p>
      ) : (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        <div role="region" aria-label="Aufstellung" tabIndex={0} className="tls-standings mt-4 border border-white/10 rounded-md bg-[var(--tls-surface-1)] overflow-x-auto overscroll-x-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-white/50">
              <tr className="border-b border-white/10">
                <th scope="col" className="text-left pl-3 sm:pl-4 pr-2 py-2.5 font-semibold">Spieler</th>
                {roundIds.map((id) => <th key={id} scope="col" className="hidden sm:table-cell px-1.5 py-2.5 font-semibold text-center">{codeOf(id)}</th>)}
                <th scope="col" className="px-2 py-2.5 font-semibold text-right" title="Einsätze in dieser Saison">Einsätze</th>
                <th scope="col" className="pr-3 sm:pr-4 pl-2 py-2.5 font-semibold text-right" title="Einsätze über alle Saisons (nur Vereinsmitglieder)">Gesamt</th>
              </tr>
            </thead>
            <tbody>
              <LineupRows players={members} roundIds={roundIds} offset={0} />
            </tbody>
            {guests.length > 0 && (
              <tbody data-testid="team-league-guests">
                <tr className="border-t border-white/10">
                  <th scope="rowgroup" colSpan={span} className="text-left pl-3 sm:pl-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">Gäste</th>
                </tr>
                <LineupRows players={guests} roundIds={roundIds} offset={members.length} />
              </tbody>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

function LeaguePath({ path, lineageSlug }) {
  if (!path?.length) return null;
  return (
    <section className="mt-12" aria-labelledby="team-league-path" data-testid="team-league-path">
      <SectionTitle id="team-league-path">Liga-Weg</SectionTitle>
      <ol className="tls-tl-path mt-5">
        {path.map((season, index) => {
          const metal = PODIUM[season.rank];
          const title = [season.season, season.tier].filter(Boolean).join(" · ");
          const body = (
            <>
              <span className="block font-semibold text-white">{season.title || title}</span>
              <span className="block text-sm text-white/65 tabular-nums">
                <span className={metal ? metal.text : undefined}>{pathRankLabel(season)}</span>
                {season.points != null && <span> · {formatNumber(season.points)} Pkt</span>}
                {season.status === "active" && <span className="ml-2 text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">läuft</span>}
              </span>
            </>
          );
          return (
            <li key={season.season_slug} className="tls-tl-path__item" style={stagger(index)} data-current={season.current ? "true" : undefined} data-medal={metal ? season.rank : undefined} data-testid="team-league-season">
              <span className="tls-tl-path__dot" aria-hidden="true" />
              {season.current ? (
                <div className="tls-tl-path__card" aria-current="page">{body}</div>
              ) : (
                <Link to={`/references/series/${lineageSlug}/${season.season_slug}`} className="tls-tl-path__card tls-tl-path__card--link">{body}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Alles, was eine Team-Liga auf der Serienseite zeigt. `data`: die Antwort der Serienseite. */
export function TeamLeagueSections({ data }) {
  const league = data.team_league || {};
  const rounds = data.rounds || [];
  const matchdays = league.matchdays || [];
  return (
    <div data-testid="team-league">
      <MatchdayProgress matchdays={matchdays} />
      <LeagueTable league={league} rounds={rounds} />
      <Schedule matchdays={matchdays} />
      <Lineup lineup={league.lineup} rounds={rounds} />
      <LeaguePath path={league.path} lineageSlug={data.lineage?.slug} />
    </div>
  );
}
