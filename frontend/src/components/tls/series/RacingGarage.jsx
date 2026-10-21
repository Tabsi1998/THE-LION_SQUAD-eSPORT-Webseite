import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { METALS } from "@/components/tls/TrophyShelf";
import { formatNumber } from "@/lib/standingsTable";
import { roundLabel } from "@/lib/referenceCalendar";
import { barShare, driverSeason, gainedWords, garageName, raceCellLabel } from "@/lib/racingLeague";
import { averageGrid, averageGridLabel, hasSessions, poleCount, sessionAbbr, sessionLabel } from "@/lib/raceWeekend";
import { ChevronDown, ChevronUp } from "lucide-react";
import { GuestBadge } from "@/components/tls/series/RacingParts";
import { AdjustmentList } from "@/components/tls/series/SeriesSpecialRules";
import { teamSinceLabel } from "@/lib/seriesSpecialRules";
import { CountryFlag } from "@/components/tls/CountryFlag";
import { countryName } from "@/lib/countryFlags";
import "./racingLeague.css";

// Vereins-Garage der Rennliga (#1746): je Vereinsteam die Fahrer und das Teamduell, darunter das Detail eines
// Vereinsfahrers (Punkte je Rennen, Siege, Podien, schnellste Runden, Ausfälle). Detail und Namen nur für öffentliche
// Vereinsfahrer (`publicKeys` vom Server); Gäste und fremde Teamkollegen heißen hier „Gastfahrer“ - Garage und Duell
// sind keine Tabelle, fremde Namen stehen nur dort. Marke „Gast“, Platz und Punkte bleiben.

function count(value, one, many) {
  return `${value} ${value === 1 ? one : many}`;
}

function DriverPick({ row, driver, selected, onSelect, publicKeys }) {
  const line = `P${row.rank} · ${formatNumber(row.points)} Pkt`;
  const label = garageName(row, publicKeys);
  if (label.named) {
    return (
      <button type="button" className="tls-racing-pick" aria-pressed={selected} onClick={() => onSelect(row.key)}>
        <span className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold text-white leading-snug [overflow-wrap:anywhere]">{row.name}</span>
          <span className="tls-standing-me">Verein</span>
        </span>
        <span className="text-[12px] tabular-nums text-white/55 whitespace-nowrap">{line}</span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3 min-h-[44px] px-3 py-1.5">
      <span className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="leading-snug text-white/70">{label.name}</span>
        {driver?.guest && <GuestBadge />}
      </span>
      <span className="text-[12px] tabular-nums text-white/45 whitespace-nowrap">{line}</span>
    </div>
  );
}

function Duel({ duel, rows, publicKeys }) {
  const nameOf = (key) => garageName(rows.find((row) => row.key === key), publicKeys);
  const a = nameOf(duel.a.key);
  const b = nameOf(duel.b.key);
  return (
    <div className="mt-3 border-t border-white/10 px-3 pt-3 pb-1" data-testid="racing-duel">
      <p className="flex items-baseline justify-between gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">
        <span>Teamduell</span>
        <span className="normal-case tracking-normal font-normal">{count(duel.races, "gemeinsames Rennen", "gemeinsame Rennen")}</span>
      </p>
      {duel.races === 0 ? (
        <p className="mt-2 text-sm text-white/55">Noch kein Rennen, in dem beide ins Ziel kamen.</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <span className={`min-w-0 text-sm leading-snug [overflow-wrap:anywhere] ${a.named ? "text-white" : "text-white/70"}`}>{a.name}</span>
            <span className="font-display text-2xl font-bold tabular-nums text-white">
              <span aria-hidden="true">
                <span className="text-[#29B6E8]">{duel.a.ahead}</span>
                <span className="text-white/35 px-1">:</span>
                <span>{duel.b.ahead}</span>
              </span>
              <span className="sr-only">{`${duel.a.ahead} zu ${duel.b.ahead}`}</span>
            </span>
            <span className={`min-w-0 text-sm leading-snug text-right [overflow-wrap:anywhere] ${b.named ? "text-white" : "text-white/70"}`}>{b.name}</span>
          </div>
          <div className="tls-racing-duel mt-2" style={{ "--a": duel.a.ahead || 0.04, "--b": duel.b.ahead || 0.04 }} aria-hidden="true">
            <span />
            <span />
          </div>
          {duel.a.points != null && (
            <p className="mt-1.5 flex justify-between text-[12px] tabular-nums text-white/50">
              <span>{formatNumber(duel.a.points)} Pkt fürs Team</span>
              <span data-testid="racing-duel-points-b">{formatNumber(duel.b.points)} Pkt</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Ein Feld je Vereinsteam: Platz in der Teamwertung, Fahrer (Vereinsfahrer öffnen ihr Detail), Teamduell. */
export function RacingGarageTeams({ garage, rows, drivers, selectedKey, onSelect, publicKeys }) {
  if (!garage.length) return null;
  return (
    <ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {garage.map((item) => (
        <li key={item.team} className="tls-racing-garage-team py-3" data-testid="racing-garage-team">
          <div className="flex items-baseline justify-between gap-3 px-3">
            <h3 className="font-heading text-lg font-black uppercase leading-tight min-w-0 break-words">{item.team}</h3>
            {item.standing && (
              <span className="shrink-0 text-[12px] font-bold tabular-nums text-white/60">{`P${item.standing.rank} · ${formatNumber(item.standing.points)} Pkt`}</span>
            )}
          </div>
          {item.drivers.length === 0 ? (
            <p className="mt-2 px-3 text-sm text-white/55">Noch kein Rennen gefahren.</p>
          ) : (
            <ul className="mt-2 space-y-0.5 px-0.5">
              {item.drivers.map((row) => (
                <li key={row.key}>
                  <DriverPick row={row} driver={drivers[row.key]} selected={row.key === selectedKey} onSelect={onSelect} publicKeys={publicKeys} />
                </li>
              ))}
            </ul>
          )}
          {item.duel && <Duel duel={item.duel} rows={rows} publicKeys={publicKeys} />}
        </li>
      ))}
    </ul>
  );
}

/** Plätze gutgemacht in einem Rennen: Pfeil und Zahl; ohne Startplatz (oder ohne Zielankunft) bleibt der Platz leer. */
function Gain({ gained, index }) {
  if (gained === null) return <span className="tls-racing-race__gain" aria-hidden="true" />;
  const dir = gained > 0 ? "up" : gained < 0 ? "down" : "same";
  const Icon = dir === "up" ? ChevronUp : dir === "down" ? ChevronDown : null;
  return (
    <span className="tls-racing-race__gain" data-dir={dir} style={{ "--i": index }} aria-hidden="true" data-testid="racing-driver-gain">
      {Icon && <Icon strokeWidth={3} />}
      {dir === "same" ? "±0" : Math.abs(gained)}
    </span>
  );
}

function raceTitle(item) {
  const country = countryName(item.round.country_code);
  const name = `${sessionLabel(item.round)}${country ? ` (${country})` : ""}`;
  if (item.cell) return raceCellLabel(item.cell, name);
  if (item.round.state === "cancelled") return `${name}: abgesagt`;
  return `${name}: ${item.round.state === "scored" ? "nicht dabei" : "noch offen"}`;
}

/** Detail eines Vereinsfahrers: Platz, Punkte, Rennen, Siege, Podien, schnellste Runden, Ausfälle und je Rennen ein
 * Balken mit Platz. `flash` lässt den Rahmen nach einem Sprung aus der Tabelle einmal aufleuchten. Runde mit Läufen
 * (#1930): Poles je Runde einmal (Pole am Rennen oder Platz 1 im Qualifying, `qualifying` vom Server), Ø Startplatz,
 * Quali-Duell gegen den Teamkollegen (`qualiDuel`: `{ name, a, b, sessions }`) und je Balken der Lauf (S, R …). */
export const RacingDriverDetail = forwardRef(function RacingDriverDetail({ row, driver, rounds, flash, qualifying, qualiDuel }, ref) {
  const season = driverSeason(row, rounds);
  const withFlags = season.perRace.some((item) => item.round.country_code);
  const withSessions = hasSessions(season.perRace.map((item) => item.round));
  const withGrid = season.gridRaces > 0;
  const poles = poleCount(row, rounds, qualifying);
  // Ø Start nur in Saisons mit Läufen (#1930) - eine bestehende Saison sieht aus wie bisher.
  const average = hasSessions(rounds) ? averageGridLabel(averageGrid(row?.results)) : "";
  const stats = [
    count(season.wins, "Sieg", "Siege"), count(season.podiums, "Podium", "Podien"),
    count(season.fastestLaps, "schnellste Runde", "schnellste Runden"), count(season.dnfs, "Ausfall", "Ausfälle"),
  ];
  if (poles) stats.push(count(poles, "Pole", "Poles"));
  if (season.driverOfTheDay) stats.push(`${season.driverOfTheDay}× Fahrer des Tages`);
  if (withGrid) stats.push(gainedWords(season.gained));
  if (average) stats.push(average);
  if (qualiDuel?.sessions) stats.push(`Quali-Duell ${qualiDuel.a}:${qualiDuel.b} gegen ${qualiDuel.name}`);
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="racing-driver-name"
      className="tls-racing-driver mt-4 p-4"
      data-flash={flash ? (flash % 2 ? "a" : "b") : undefined}
      data-testid="racing-driver"
    >
      <div key={row.key} className="tls-racing-driver__head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="racing-driver-name" className="font-heading text-2xl font-black uppercase leading-tight break-words">{row.name}</h3>
            {driver?.team && (
              <p className="text-sm text-white/55">
                {driver.team}
                {/* Teamwechsel (#1960): ab welchem Rennen der Fahrer im aktuellen Team ist. */}
                {teamSinceLabel(driver, rounds) && <span className="text-white/40" data-testid="racing-driver-team-since">{` · ${teamSinceLabel(driver, rounds)}`}</span>}
              </p>
            )}
          </div>
          {row.profile_slug && (
            <Link to={`/members/${row.profile_slug}`} className="tls-btn tls-btn--quiet inline-flex items-center min-h-[40px] px-3 rounded-md text-[12px] font-bold uppercase tracking-[0.12em]">
              Vereinsprofil
            </Link>
          )}
        </div>
        <p className="mt-3 text-sm text-white tabular-nums">
          {`P${row.rank} in der Fahrerwertung · ${formatNumber(row.points)} ${Number(row.points) === 1 ? "Punkt" : "Punkte"} · ${season.races} Rennen`}
        </p>
        <p className="mt-1 text-sm text-white/65 tabular-nums" data-testid="racing-driver-stats">{stats.join(" · ")}</p>
        {/* Anpassungen (#1960): öffentlich als „−5“ mit Grund - erklären die Abweichung zur Rennsumme. */}
        <AdjustmentList row={row} rounds={rounds} className="mt-2" />
      </div>
      {season.perRace.length > 0 && (
        // `relative`: die Texte für Screenreader (sr-only, absolut) bleiben in der Scroll-Fläche - sonst schieben sie bei vielen
        // Läufen (#1930) am Handy die ganze Seite seitlich hinaus.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        <div role="region" aria-label="Punkte je Rennen" tabIndex={0} className="relative mt-4 -mx-1 px-1 pb-1 overflow-x-auto overscroll-x-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8] rounded">
          <ol className="tls-racing-races">
            {season.perRace.map((item, index) => {
              const metal = item.cell?.medal ? METALS[item.cell.medal] : null;
              const title = raceTitle(item);
              return (
                <li
                  key={item.round.id}
                  className="tls-racing-race"
                  data-state={item.round.state}
                  data-medal={item.cell?.medal || undefined}
                  style={metal ? { "--tls-race-medal": metal.base } : undefined}
                  title={title}
                  data-testid="racing-driver-race"
                >
                  <span className="tls-racing-race__points" aria-hidden="true">{item.cell ? formatNumber(item.points) : ""}</span>
                  <span className="tls-racing-race__track" aria-hidden="true">
                    {item.cell && (
                      <span
                        className="tls-racing-race__bar"
                        style={{ "--share": barShare(item.points, season.maxPoints), "--i": index }}
                        data-testid="racing-driver-bar"
                      />
                    )}
                  </span>
                  <span className="tls-racing-race__place" aria-hidden="true">{item.cell ? item.cell.text : "–"}</span>
                  {/* Startplatz → Ziel (#1927): gutgemachte Plätze grün nach oben, verlorene nach unten. */}
                  {withGrid && <Gain gained={item.cell?.gained ?? null} index={index} />}
                  <span className="tls-racing-race__code" aria-hidden="true">{roundLabel(item.round)}</span>
                  {/* Lauf der Runde (#1930): S, R, HR … unter dem Kürzel - feste Höhe, damit die Reihe gerade bleibt. */}
                  {withSessions && <span className="tls-racing-race__session" aria-hidden="true">{item.round.session ? sessionAbbr(item.round) : ""}</span>}
                  {/* Flagge des Rennens (#1925) unter dem Kürzel - eine Leiste der Länder entlang der Saison. */}
                  {withFlags && (
                    <span className="tls-racing-race__flag" aria-hidden="true">
                      <CountryFlag code={item.round.country_code} size="xs" />
                    </span>
                  )}
                  <span className="sr-only">{title}</span>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
});
