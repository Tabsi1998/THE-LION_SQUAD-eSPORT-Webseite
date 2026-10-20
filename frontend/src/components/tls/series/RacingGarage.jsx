import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { METALS } from "@/components/tls/TrophyShelf";
import { formatNumber } from "@/lib/standingsTable";
import { roundLabel } from "@/lib/referenceCalendar";
import { nameOf } from "@/lib/referenceSeriesTable";
import { barShare, driverSeason, raceCellLabel } from "@/lib/racingLeague";
import { GuestBadge } from "@/components/tls/series/RacingParts";
import "./racingLeague.css";

// Vereins-Garage der Rennliga (#1746): je Vereinsteam die Fahrer und das Teamduell, darunter das Detail eines
// Vereinsfahrers (Punkte je Rennen, Siege, Podien, schnellste Runden, Ausfälle). Nur Vereinsmitglieder bekommen ein
// Detail; Gäste und fremde Teamkollegen stehen als Text dabei.

function count(value, one, many) {
  return `${value} ${value === 1 ? one : many}`;
}

function DriverPick({ row, driver, selected, onSelect }) {
  const line = `P${row.rank} · ${formatNumber(row.points)} Pkt`;
  if (row.club_member && row.name && !row.name_hidden) {
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
        <span className={`leading-snug [overflow-wrap:anywhere] ${row.name_hidden ? "text-white/40 italic" : "text-white/80"}`}>{nameOf(row)}</span>
        {driver?.guest && <GuestBadge />}
      </span>
      <span className="text-[12px] tabular-nums text-white/45 whitespace-nowrap">{line}</span>
    </div>
  );
}

function Duel({ duel, rows }) {
  const byKey = (key) => rows.find((row) => row.key === key);
  const a = byKey(duel.a.key);
  const b = byKey(duel.b.key);
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
            <span className="min-w-0 text-sm leading-snug text-white [overflow-wrap:anywhere]">{nameOf(a)}</span>
            <span className="font-display text-2xl font-bold tabular-nums text-white">
              <span aria-hidden="true">
                <span className="text-[#29B6E8]">{duel.a.ahead}</span>
                <span className="text-white/35 px-1">:</span>
                <span>{duel.b.ahead}</span>
              </span>
              <span className="sr-only">{`${duel.a.ahead} zu ${duel.b.ahead}`}</span>
            </span>
            <span className="min-w-0 text-sm leading-snug text-white text-right [overflow-wrap:anywhere]">{nameOf(b)}</span>
          </div>
          <div className="tls-racing-duel mt-2" style={{ "--a": duel.a.ahead || 0.04, "--b": duel.b.ahead || 0.04 }} aria-hidden="true">
            <span />
            <span />
          </div>
          <p className="mt-1.5 flex justify-between text-[12px] tabular-nums text-white/50">
            <span>{formatNumber(duel.a.points)} Pkt fürs Team</span>
            <span>{formatNumber(duel.b.points)} Pkt</span>
          </p>
        </>
      )}
    </div>
  );
}

/** Ein Feld je Vereinsteam: Platz in der Teamwertung, Fahrer (Vereinsfahrer öffnen ihr Detail), Teamduell. */
export function RacingGarageTeams({ garage, rows, drivers, selectedKey, onSelect }) {
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
                  <DriverPick row={row} driver={drivers[row.key]} selected={row.key === selectedKey} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          )}
          {item.duel && <Duel duel={item.duel} rows={rows} />}
        </li>
      ))}
    </ul>
  );
}

function raceTitle(item) {
  const name = roundLabel(item.round);
  if (item.cell) return raceCellLabel(item.cell, name);
  if (item.round.state === "cancelled") return `${name}: abgesagt`;
  return `${name}: ${item.round.state === "scored" ? "nicht dabei" : "noch offen"}`;
}

/** Detail eines Vereinsfahrers: Platz, Punkte, Rennen, Siege, Podien, schnellste Runden, Ausfälle und je Rennen ein
 * Balken mit Platz. `flash` lässt den Rahmen nach einem Sprung aus der Tabelle einmal aufleuchten. */
export const RacingDriverDetail = forwardRef(function RacingDriverDetail({ row, driver, rounds, flash }, ref) {
  const season = driverSeason(row, rounds);
  const stats = [
    count(season.wins, "Sieg", "Siege"), count(season.podiums, "Podium", "Podien"),
    count(season.fastestLaps, "schnellste Runde", "schnellste Runden"), count(season.dnfs, "Ausfall", "Ausfälle"),
  ];
  if (season.poles) stats.push(count(season.poles, "Pole", "Poles"));
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
            {driver?.team && <p className="text-sm text-white/55">{driver.team}</p>}
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
      </div>
      {season.perRace.length > 0 && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
        <div role="region" aria-label="Punkte je Rennen" tabIndex={0} className="mt-4 -mx-1 px-1 pb-1 overflow-x-auto overscroll-x-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8] rounded">
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
                  <span className="tls-racing-race__code" aria-hidden="true">{roundLabel(item.round)}</span>
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
