import { Link } from "react-router-dom";
import { Star, Timer } from "lucide-react";
import { METALS } from "@/components/tls/TrophyShelf";
import { Points } from "@/components/tls/series/SeriesStandings";
import { formatDiff, formatNumber } from "@/lib/standingsTable";
import { PUBLIC_STATE_LABELS, STATE_TONES, dayLabel, roundLabel, roundWhen } from "@/lib/referenceCalendar";
import { nameOf } from "@/lib/referenceSeriesTable";
import { raceCell, raceCellLabel, raceSummary } from "@/lib/racingLeague";
import { chipLabel, groupWeekends, roundKind } from "@/lib/raceWeekend";
import { VenueWithFlag } from "@/components/tls/CountryFlag";
import { SessionChips } from "@/components/tls/series/SessionChips";
import { NoScoreNote } from "@/components/tls/series/SeriesSpecialRules";
import "./racingLeague.css";

// Bausteine der Rennliga (#1746): Umschalter der Saisons, Zellen des Rennrasters, Namen (nur Vereinsfahrer öffnen ihr
// Detail, Fremde sind reiner Text), Abweichung zum offiziellen Wert und der Rennkalender mit Sieger und bestem
// Vereinsfahrer. Gerechnet wird nichts - alles kommt aus dem gespeicherten Stand.

function seasonName(season) {
  return [season.season, season.tier].filter(Boolean).join(" · ") || season.title || season.season_slug;
}

/** Umschalter zwischen den Saisons und Ligen derselben Spur (F1 aktuell, F2, Vorsaison) - erst ab zwei Saisons. */
export function SeasonSwitcher({ seasons, lineageSlug }) {
  if (!Array.isArray(seasons) || seasons.length < 2) return null;
  return (
    <nav aria-label="Saisons und Ligen" className="tls-season-tabs mt-6 -mx-4 px-4 sm:mx-0 sm:px-0 overflow-x-auto" data-testid="racing-seasons">
      <ul className="flex gap-2 w-max py-1">
        {seasons.map((season) => (
          <li key={season.season_slug}>
            <Link
              to={`/references/series/${lineageSlug}/${season.season_slug}`}
              aria-current={season.current ? "page" : undefined}
              className="tls-season-tab"
            >
              {seasonName(season)}
              {season.status === "active" && <span className="tls-season-tab__live">läuft</span>}
              {season.status === "cancelled" && <span className="text-[10px] uppercase tracking-[0.12em] text-white/45">abgebrochen</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Name eines Fahrers: ein öffentlicher Vereinsfahrer (`canOpen`, vom Server) öffnet sein Detail, alle anderen sind
 * reiner Text. */
export function DriverName({ row, onSelect, canOpen = false, className = "" }) {
  const name = nameOf(row);
  if (canOpen && row.club_member && !row.name_hidden && row.name && onSelect) {
    return <button type="button" onClick={() => onSelect(row.key)} className={`tls-racing-name ${className}`}>{name}</button>;
  }
  return <span className={`tls-standing-name ${row.name_hidden ? "text-white/40 italic" : "text-white font-medium"} ${className}`}>{name}</span>;
}

export function GuestBadge() {
  return <span className="tls-racing-guest">Gast</span>;
}

/** Name in der Fahrerwertung: Name, „Verein“ oder „Gast“, darunter das aktuelle Team. */
export function DriverCell({ row, driver, onSelect, canOpen = false }) {
  return (
    <span className="block min-w-0">
      <span className="flex items-center gap-2 min-w-0">
        <DriverName row={row} onSelect={onSelect} canOpen={canOpen} />
        {row.club_member && <span className="tls-standing-me">Verein</span>}
        {driver?.guest && <GuestBadge />}
      </span>
      {driver?.team && <span className="mt-0.5 block text-[12px] leading-tight text-white/45 [overflow-wrap:anywhere]">{driver.team}</span>}
    </span>
  );
}

/** Zelle im Rennraster: Platz im Ring (Podium in den Farben der Pokale), DNF/DNS/DSQ, schnellste Runde als Stoppuhr. */
export function RaceCell({ result, name }) {
  const cell = raceCell(result);
  const label = raceCellLabel(cell, name);
  if (!cell) return <span className="text-white/20" title={label}><span aria-hidden="true">–</span><span className="sr-only">{label}</span></span>;
  const metal = cell.medal ? METALS[cell.medal] : null;
  return (
    <>
      <span
        className="tls-race-cell"
        data-testid="race-cell"
        data-medal={cell.medal || undefined}
        data-status={cell.status}
        data-dropped={cell.dropped ? "true" : undefined}
        style={metal ? { "--tls-race-medal": metal.base } : undefined}
        title={label}
        aria-hidden="true"
      >
        {cell.text}
        {cell.fastest && <Timer className="tls-race-fastest" strokeWidth={2.5} data-testid="race-fastest" />}
        {/* Fahrer des Tages (#1927): kleiner goldener Stern unten rechts - gegenüber der Stoppuhr oben. */}
        {cell.dotd && <Star className="tls-race-dotd" strokeWidth={2.5} fill="currentColor" data-testid="race-dotd" />}
      </span>
      <span className="sr-only">{label}</span>
    </>
  );
}

/** Weicht der offizielle Wert von der eigenen Summe ab (meist Strafen), steht die Abweichung klein daneben. */
export function Deviation({ row }) {
  const deviation = Number(row?.deviation);
  if (row?.deviation == null || !Number.isFinite(deviation) || deviation === 0) return null;
  const label = `Laut Veranstalter ${formatNumber(row.official_points)} Punkte, eigene Summe ${formatNumber(row.computed_points)} – Abweichung ${formatDiff(deviation)} (etwa Strafen)`;
  return (
    <span className="tls-racing-deviation" title={label} data-testid="racing-deviation">
      <span aria-hidden="true">{formatDiff(deviation)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Punkte einer Zeile mit Vorrang-Hinweis und Abweichung. */
export function RacingPoints({ row }) {
  return (
    <span className="inline-flex items-baseline justify-end">
      <Points row={row} />
      <Deviation row={row} />
    </span>
  );
}

function WhoLine({ label, tone, row, cell, onSelect, testId, showClub = false }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 text-sm" data-testid={testId}>
      <span className={`shrink-0 sm:w-[10rem] text-[10px] font-bold uppercase tracking-[0.14em] ${tone}`}>{label}</span>
      {" "}
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
        <DriverName row={row} onSelect={onSelect} canOpen />
        {cell && <span className="text-white/50 tabular-nums whitespace-nowrap">{` · ${cell.place ? `P${cell.place}` : cell.text}`}</span>}
        {showClub && row.club_member && <span className="tls-standing-me">Verein</span>}
      </span>
    </p>
  );
}

/** Sieger und bester Vereinsfahrer eines gewerteten Laufs; `session` hängt bei mehreren Läufen den Lauf an („Sieg ·
 * Sprint“). Ein Qualifying zählt nicht und hat hier keine Zeile. */
function RoundSummary({ round, rows, publicKeys, onSelect, session = "" }) {
  if (round.state !== "scored" || round.counts === false || roundKind(round) === "qualifying") return null;
  const summary = raceSummary(rows, round.id, publicKeys);
  const best = summary?.bestClub && summary.bestClub.row !== summary.winner ? summary.bestClub : null;
  if (!summary?.winner && !best) return null;
  const suffix = session ? ` · ${session}` : "";
  return (
    <>
      {summary.winner && <WhoLine label={`Sieg${suffix}`} tone="text-[var(--tls-honor)]" row={summary.winner} onSelect={onSelect} testId="racing-round-winner" showClub />}
      {best && <WhoLine label={`Bester Vereinsfahrer${suffix}`} tone="text-[#29B6E8]" row={best.row} cell={best.cell} onSelect={onSelect} testId="racing-round-club" />}
    </>
  );
}

function StateBadge({ state }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 border rounded-sm text-[10px] font-bold uppercase tracking-widest whitespace-nowrap ${STATE_TONES[state] || STATE_TONES.planned}`}>
      {PUBLIC_STATE_LABELS[state] || state}
    </span>
  );
}

/** Rennkalender: je Runde eine Zeile - Kürzel, Tag, Ort mit Flagge und, bei einer Runde mit Läufen (#1930), die
 * Lauf-Chips „Quali · Sprint · Rennen“ mit Uhrzeit und Status. Bei gewerteten Rennen der Sieger (nur ein öffentlicher
 * Vereinsfahrer - ein fremder Name steht nur in der Tabelle), sonst der beste öffentliche Vereinsfahrer mit Platz.
 * `hrefFor(lauf)` macht die Chips zu Links (Ergebnis je Lauf, #1950), `roundHref(lauf)` Kürzel, Tag und Ort zum Link auf
 * die Ergebnisseite der Runde. */
export function RacingCalendar({ rounds, rows, onSelect, publicKeys, hrefFor, roundHref }) {
  const weekends = groupWeekends(rounds);
  return (
    <section className="mt-12" aria-labelledby="racing-calendar-title" data-testid="racing-calendar">
      <h2 id="racing-calendar-title" className="font-heading text-2xl font-black uppercase">Rennkalender</h2>
      {rounds.length === 0 ? (
        <p className="mt-3 text-sm text-white/55">Noch keine Termine.</p>
      ) : (
        <ol className="mt-4 divide-y divide-white/5 border-y border-white/10">
          {weekends.map((weekend) => {
            const round = weekend.lead;
            const races = weekend.rounds.filter((item) => item.counts !== false && roundKind(item) !== "qualifying");
            const scoredCount = races.filter((item) => item.state === "scored").length;
            const original = weekend.rounds.find((item) => item.original_club_day)?.original_club_day;
            const href = roundHref?.(round);
            const head = (
              <>
                <span className={`w-12 shrink-0 font-black tabular-nums ${weekend.kind === "final" ? "text-[var(--tls-honor)]" : "text-white/80"}`}>{roundLabel(round)}</span>
                <div className="min-w-0 flex-1">
                  <span className={`block text-sm tabular-nums ${weekend.state === "cancelled" ? "text-white/45" : "text-white"}`}>{weekend.multi ? roundWhen({ ...round, time: null }) : roundWhen(round)}</span>
                  {(weekend.title || weekend.venue || weekend.country_code) && (
                    <span className="block text-sm text-white/60" data-testid="racing-round-venue"><VenueWithFlag round={weekend} /></span>
                  )}
                  {original && <span className="block text-[11px] text-white/45">ursprünglich {dayLabel(original)}</span>}
                  {/* Termin ohne Wertung mit Grund (#1960) - je Lauf, der einen hat. */}
                  {weekend.rounds.map((item) => <NoScoreNote key={item.id} round={item} label={weekend.multi ? chipLabel(item) : ""} />)}
                </div>
              </>
            );
            return (
              <li key={weekend.key} className="py-3 flex flex-wrap items-start gap-x-3" data-testid="racing-round" data-state={weekend.state} data-sessions={weekend.multi ? weekend.rounds.length : undefined}>
                {href ? (
                  <Link to={href} className="tls-racing-round-link flex flex-1 min-w-0 items-start gap-3" title="Ergebnis der Runde" data-testid="racing-round-link">{head}</Link>
                ) : head}
                <StateBadge state={weekend.state} />
                {/* Chips und Sieger in voller Breite unter Tag und Ort - am Handy passen so zwei Chips in eine Zeile. */}
                {(weekend.multi || scoredCount > 0) && (
                  <div className="basis-full min-w-0 pl-[3.75rem]">
                    {weekend.multi && <SessionChips rounds={weekend.rounds} showTime hrefFor={hrefFor} className="mt-2" />}
                    {scoredCount > 0 && (
                      <div className="mt-2 space-y-1">
                        {weekend.rounds.map((item) => (
                          <RoundSummary key={item.id} round={item} rows={rows} publicKeys={publicKeys} onSelect={onSelect} session={races.length > 1 ? chipLabel(item) : ""} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
