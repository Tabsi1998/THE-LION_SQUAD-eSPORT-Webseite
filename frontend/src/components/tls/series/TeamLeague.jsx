import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { METALS } from "@/components/tls/TrophyShelf";
import { StandingsTable } from "@/components/tls/tournament/StandingsTable";
import { formatNumber } from "@/lib/standingsTable";
import { PUBLIC_STATE_LABELS, STATE_TONES, dayLabel, opponentText, roundLabel, roundWhen, sideLabel } from "@/lib/referenceCalendar";
import { nameOf } from "@/lib/referenceSeriesTable";
import {
  OUTCOMES, PICK_LABELS, appearanceText, banText, cellState, mapShare, matchPointsLabel, matchdayProgress,
  pathRankLabel, rankTrend, recordSummary, squadGroups, tableRows, tableTiebreakLabel,
} from "@/lib/teamLeague";
import { leaguePath } from "@/lib/referencesOverview";
import { SEASON_NOTE_TONES } from "@/lib/seriesTiers";
import "./referenceSeries.css";
import "./teamLeague.css";

// Seite Team-Liga (#1747) auf der Serienseite: Spieltage mit dem nächsten Gegner, Bilanz (#1931: S/U/N, Maps und
// Runden), Tabelle (Rangliste der Turniere, Punkte und Vorrang aus den Regeln der Serie), Platzierungsverlauf, die
// Spieltage als Karten (#1931: Gegner, Heim/Auswärts, Ergebnis in Sieg- bzw. Niederlagen-Farbe, Maps mit Wahl, Banns und
// die übrigen Spiele des Spieltags), Kader mit Einsätzen („2 von 5“, Ersatz je Spieltag; Gäste getrennt, sie zählen
// nicht in die Vereinsstatistik) und der Liga-Weg über die Saisons der Spur. Alles kommt gespeichert vom Server. Fremde
// Namen stehen nur in Tabellen und nur als Text - nur Vereinsmitglieder verlinken auf ihr Profil. Farben wie überall:
// Sieg Cyan, Niederlage grau, Gold dem Podest.

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
          {next.opponent && <span> · <span className="text-white">{opponentText(next)}</span></span>}
        </p>
      )}
    </section>
  );
}

/** Bilanz je eigenem Team (#1931): Siege, Unentschieden, Niederlagen mit Anteil-Balken, Maps und Runden. */
function Record({ record }) {
  const items = (record || []).map(recordSummary);
  if (!items.length) return null;
  const many = items.length > 1;
  return (
    <section className="mt-8" aria-labelledby="team-league-record" data-testid="team-league-record">
      <h2 id="team-league-record" className="text-[11px] font-bold uppercase tracking-[0.3em] text-white/55">Bilanz</h2>
      <div className="mt-3 grid gap-3">
        {items.map((item) => (
          <dl key={item.team || "team"} className="tls-tl-record" data-testid="team-league-record-team">
            {many && <div className="tls-tl-record__team">{item.team}</div>}
            <div className="tls-tl-record__cell">
              <dt><span aria-hidden="true">S · U · N</span><span className="sr-only">Siege, Unentschieden, Niederlagen</span></dt>
              <dd className="tls-tl-record__wdl font-display">
                <span data-outcome="win">{item.won}</span><span aria-hidden="true">–</span>
                <span data-outcome="draw">{item.drawn}</span><span aria-hidden="true">–</span>
                <span data-outcome="loss">{item.lost}</span>
              </dd>
              <div className="tls-tl-record__bar" aria-hidden="true">
                {item.played > 0 && ["won", "drawn", "lost"].map((key) => (
                  <span key={key} data-part={key} style={{ flexGrow: item[key] }} />
                ))}
              </div>
            </div>
            <div className="tls-tl-record__cell">
              <dt>Maps</dt>
              <dd><span className="tls-tl-record__value font-display">{item.maps}</span> <span className="tls-tl-record__diff">{item.mapsDiff}</span></dd>
            </div>
            <div className="tls-tl-record__cell">
              <dt>Runden</dt>
              {item.rounds ? (
                <dd>
                  <span className="tls-tl-record__value font-display">{item.rounds}</span> <span className="tls-tl-record__diff">{item.roundsDiff}</span>
                  {item.roundsPartial && <span className="block text-[11px] text-white/45">nur Spiele mit Maps</span>}
                </dd>
              ) : <dd className="text-sm text-white/45">ohne Maps</dd>}
            </div>
          </dl>
        ))}
      </div>
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

// Maps einer Karte: Name, wer sie gewählt hat (#1931), Stand aus eigener Sicht und der kleine Balken.
function Maps({ maps }) {
  if (!maps.length) return null;
  return (
    <ul className="tls-tl-maps" aria-label="Maps" data-testid="team-league-maps">
      {maps.map((map, index) => (
        // Maps können gleich heißen (Rückspiel auf derselben Karte) - der Index gehört zum Schlüssel.
        <li key={`${map.name}-${index}`} className="tls-tl-map" data-outcome={map.outcome} style={{ "--share": mapShare(map) }}>
          <span className="tls-tl-map__name">{map.name}</span>
          {map.picked && <span className="tls-tl-map__pick" data-picked={map.picked} data-testid="team-league-map-pick">{PICK_LABELS[map.picked]}</span>}
          <span className="tabular-nums text-white/85">{formatNumber(map.score_for)}:{formatNumber(map.score_against)}</span>
          <span className="tls-tl-map__bar" aria-hidden="true"><span className="tls-tl-map__fill" /></span>
          <span className="sr-only">{OUTCOMES[map.outcome]?.word}</span>
        </li>
      ))}
    </ul>
  );
}

// Die übrigen Spiele des Spieltags (#1931) - zugeklappt, nur Teams und Ergebnis.
function OtherMatches({ others }) {
  if (!others?.length) return null;
  return (
    <details className="tls-tl-others" data-testid="team-league-others">
      <summary>Weitere Spiele ({others.length})</summary>
      <ul>
        {others.map((item, index) => (
          <li key={`${item.home}-${item.away}-${index}`}>
            <span className="tls-tl-others__team">{item.home}</span>
            <span className="tabular-nums text-white/85">{formatNumber(item.home_score)}:{formatNumber(item.away_score)}</span>
            <span className="tls-tl-others__team tls-tl-others__team--away">{item.away}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Tag und Uhrzeit des eigenen Spiels (#1931), sonst die des Termins (bei einem Zeitraum beide Tage). */
function matchWhen(round, match) {
  if (match?.club_day) return roundWhen({ club_day: match.club_day, time: match.time });
  if (match?.time && round.club_day && !round.club_day_end) return roundWhen({ ...round, time: match.time });
  if (match?.time && round.club_day_end) return `${roundWhen(round)} · ${match.time}`;
  return roundWhen(round);
}

// Ein eigenes Spiel in der Karte: Gegner mit Heim/Auswärts, Maps mit Wahl und Banns. Spielen mehrere eigene Teams am
// selben Spieltag, steht jedes Spiel als eigener Block mit Team und Ergebnis (Prüfung #1931).
function OwnMatch({ round, match, showTeam, withScore }) {
  const opponent = match?.opponent || round.opponent;
  const side = match ? (match.home ? "Heim" : "Auswärts") : sideLabel(round);
  return (
    <div className="tls-tl-card__match" data-testid="team-league-own-match" data-outcome={match?.outcome}>
      <div className="flex items-start justify-between gap-3">
        {opponent ? (
          <p className="mt-2 text-[17px] leading-snug text-white font-semibold break-words [overflow-wrap:anywhere]">
            {showTeam && match?.team && <span className="text-[#29B6E8]" data-testid="team-league-own-team">{match.team} </span>}
            <span className="text-white/45 font-normal">gegen </span>{opponent}
            {side && <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-widest text-white/45">{side}</span>}
          </p>
        ) : <p className="mt-2 text-sm text-white/45">Gegner offen</p>}
        {withScore && match && <span className="mt-2"><Score match={match} /></span>}
      </div>
      {match && <Maps maps={match.maps} />}
      {match?.bans?.length > 0 && <p className="mt-2 text-xs text-white/50" data-testid="team-league-bans"><span className="text-white/35">Bann: </span>{banText(match.bans)}</p>}
    </div>
  );
}

// Ein Spieltag als Karte (#1931). `showTeam`: mehrere eigene Teams in der Saison (#1926) - dann steht vor dem Gegner,
// welches eigene Team gespielt hat; spielen mehrere am selben Spieltag, stehen alle ihre Spiele in der Karte.
function MatchdayCard({ day, index, showTeam }) {
  const { round, match, others } = day;
  const matches = day.matches?.length ? day.matches : match ? [match] : [];
  const single = matches.length <= 1;
  return (
    <li className="tls-tl-card tls-series-row" style={stagger(index)} data-testid="team-league-matchday" data-state={round.state}
      data-outcome={single ? match?.outcome : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-black tabular-nums text-white/85 mr-2">{roundLabel(round)}</span>
          <span className={`text-sm tabular-nums ${round.state === "cancelled" ? "text-white/45" : "text-white/65"}`}>{matchWhen(round, single ? match : null)}</span>
          {round.original_club_day && <span className="block text-[11px] text-white/45">ursprünglich {dayLabel(round.original_club_day)}</span>}
        </div>
        {single && match ? <Score match={match} /> : null}
        {!matches.length && (
          <span className={`inline-flex items-center px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${STATE_TONES[round.state] || STATE_TONES.planned}`}>
            {PUBLIC_STATE_LABELS[round.state] || round.state}
          </span>
        )}
      </div>
      {matches.length ? matches.map((item, position) => (
        <OwnMatch key={`${item.team || "team"}-${position}`} round={round} match={item} showTeam={showTeam} withScore={!single} />
      )) : <OwnMatch round={round} match={null} showTeam={showTeam} withScore={false} />}
      <OtherMatches others={others} />
    </li>
  );
}

function Schedule({ matchdays, showTeam = false }) {
  return (
    <section className="mt-12" aria-labelledby="team-league-schedule" data-testid="team-league-schedule">
      <SectionTitle id="team-league-schedule">Spielplan</SectionTitle>
      {matchdays.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Noch keine Spieltage.</p>
      ) : (
        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
          {matchdays.map((day, index) => <MatchdayCard key={day.round.id} day={day} index={index} showTeam={showTeam} />)}
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

function RoundCell({ state }) {
  if (state === "played") return <><Check className="inline h-3.5 w-3.5 text-[#29B6E8]" strokeWidth={3} aria-hidden="true" /><span className="sr-only">gespielt</span></>;
  if (state === "bench") return <><span className="tls-tl-bench" aria-hidden="true">E</span><span className="sr-only">Ersatz</span></>;
  return <><span className="text-white/20" aria-hidden="true">–</span><span className="sr-only">nicht dabei</span></>;
}

function LineupRows({ players, roundIds, offset }) {
  return players.map((player, index) => (
    <tr key={player.key} className="tls-series-row border-t border-white/5" style={stagger(offset + index)} data-testid="team-league-player" data-guest={player.guest ? "true" : undefined}>
      <th scope="row" className="text-left font-normal pl-3 sm:pl-4 pr-2 py-2.5">
        <PlayerName player={player} />
      </th>
      {roundIds.map((id) => (
        <td key={id} className="hidden sm:table-cell px-1.5 py-2.5 text-center"><RoundCell state={cellState(player, id)} /></td>
      ))}
      <td className="px-2 py-2.5 text-right whitespace-nowrap" data-testid="team-league-appearances">
        <span className="font-display text-base font-bold text-white">{player.appearances}</span>
        {Number(player.of) > 0 && <span className="text-white/50"> von {player.of}</span>}
        <span className="sr-only">{` Einsätze (${appearanceText(player)})`}</span>
      </td>
      <td className="pr-3 sm:pr-4 pl-2 py-2.5 text-right text-white/60">{player.all_seasons ?? "–"}</td>
    </tr>
  ));
}

// Kader mit Einsätzen (#1931): der ganze Kader, auch wer noch nicht gespielt hat; je Spieltag gespielt (Haken) oder
// Ersatz („E“), dazu „2 von 5“. Mehrere eigene Teams stehen je Team, Gäste getrennt.
function Lineup({ lineup, rounds, ownTeams }) {
  const roundIds = lineup?.round_ids || [];
  const players = lineup?.players || [];
  const groups = squadGroups(lineup, ownTeams);
  const codeOf = (id) => roundLabel((rounds || []).find((round) => round.id === id) || {});
  const span = roundIds.length + 3;
  let offset = 0;
  return (
    <section className="mt-12" aria-labelledby="team-league-lineup" data-testid="team-league-lineup">
      <SectionTitle id="team-league-lineup">Kader</SectionTitle>
      <p className="mt-2 text-sm text-white/55">Wer an welchem Spieltag gespielt hat, „E“ heißt Ersatz. Gäste zählen nicht in die Vereinsstatistik.</p>
      {players.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Noch kein Kader und keine Aufstellung eingetragen.</p>
      ) : (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        <div role="region" aria-label="Kader" tabIndex={0} className="tls-standings mt-4 border border-white/10 rounded-md bg-[var(--tls-surface-1)] overflow-x-auto overscroll-x-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-[11px] uppercase tracking-[0.12em] text-white/50">
              <tr className="border-b border-white/10">
                <th scope="col" className="text-left pl-3 sm:pl-4 pr-2 py-2.5 font-semibold">Spieler</th>
                {roundIds.map((id) => <th key={id} scope="col" className="hidden sm:table-cell px-1.5 py-2.5 font-semibold text-center">{codeOf(id)}</th>)}
                <th scope="col" className="px-2 py-2.5 font-semibold text-right" title="Einsätze von den Spielen des Teams mit Aufstellung">Einsätze</th>
                <th scope="col" className="pr-3 sm:pr-4 pl-2 py-2.5 font-semibold text-right" title="Einsätze über alle Saisons (nur Vereinsmitglieder)">Gesamt</th>
              </tr>
            </thead>
            {groups.map((group) => {
              const start = offset;
              offset += group.players.length;
              return (
                <tbody key={group.key} data-testid={group.key === "guests" ? "team-league-guests" : "team-league-squad"}>
                  {group.label && (
                    <tr className="border-t border-white/10">
                      <th scope="rowgroup" colSpan={span} className="text-left pl-3 sm:pl-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">{group.label}</th>
                    </tr>
                  )}
                  <LineupRows players={group.players} roundIds={roundIds} offset={start} />
                </tbody>
              );
            })}
          </table>
        </div>
      )}
    </section>
  );
}

// Vermerk je Saison wie auf der Übersicht (#1898): zuerst das „Ergebnis der Saison“, sonst aus den Stufen abgeleitet;
// „läuft“ steht hier schon als eigenes Zeichen.
function LeaguePath({ path, lineageSlug, tierOrder }) {
  if (!path?.length) return null;
  const notes = leaguePath(path, tierOrder).steps.map((step) => (step.note === "läuft" ? "" : step.note));
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
                {notes[index] && <span className={`ml-2 text-[10px] font-bold uppercase tracking-widest ${SEASON_NOTE_TONES[notes[index]] || "text-zinc-400"}`} data-testid="team-league-season-note">{notes[index]}</span>}
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
      <Record record={league.record} />
      <LeagueTable league={league} rounds={rounds} />
      <Schedule matchdays={matchdays} showTeam={(league.own_teams || []).length > 1} />
      <Lineup lineup={league.lineup} rounds={rounds} ownTeams={league.own_teams || []} />
      <LeaguePath path={league.path} lineageSlug={data.lineage?.slug} tierOrder={data.lineage?.tier_order} />
    </div>
  );
}
