import { useCallback, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatNumber } from "@/lib/standingsTable";
import { motionAllowed } from "@/lib/motion";
import { nameOf } from "@/lib/referenceSeriesTable";
import {
  barShare, bonusLabel, clubDrivers, garageTeams, gapLabel, teamRuleLabel, teamTableRows,
} from "@/lib/racingLeague";
import { SeriesStandings } from "@/components/tls/series/SeriesStandings";
import { PROGRESS_WORDS, SeriesFinal, SeriesProgress, SeriesRules } from "@/components/tls/series/SeriesParts";
import {
  DriverCell, GuestBadge, RaceCell, RacingCalendar, RacingPoints, SeasonSwitcher,
} from "@/components/tls/series/RacingParts";
import { RacingDriverDetail, RacingGarageTeams } from "@/components/tls/series/RacingGarage";
import "./racingLeague.css";

// Seite einer Rennliga (#1746) unter /references/series/<spur>/<saison>: Umschalter der Saisons, Fortschritt in
// Rennen, Vereins-Garage mit Teamduell und Fahrer-Detail, Fahrerwertung als Rennraster (Podium, schnellste Runde,
// Ausfall, Abstand, Abweichung zum offiziellen Wert), Teamwertung mit Balken und der Rennkalender. Die Tabellen sind
// die der Turnierserie (SeriesStandings) mit eigenen Zellen. Das Detail eines Vereinsfahrers steht in der Adresse
// (?fahrer=…), damit es sich teilen lässt; Fremde bekommen keins.

const FAHRER = "fahrer";

function TeamCell({ row, index, rows, drivers, lead }) {
  const names = (row.drivers || []).map((key) => ({ key, row: rows.find((item) => item.key === key), guest: drivers[key]?.guest }));
  return (
    <span className="block min-w-0">
      <span className="flex items-center gap-2 min-w-0">
        <span className="font-semibold text-white leading-snug [overflow-wrap:anywhere]">{row.team}</span>
        {row.club_member && <span className="tls-standing-me">Verein</span>}
      </span>
      {names.length > 0 && (
        <span className="mt-0.5 block text-[12px] leading-snug text-white/50">
          {names.map((item, position) => (
            <span key={item.key}>
              {position > 0 && ", "}
              <span className={item.row?.club_member ? "text-white/80" : undefined}>{nameOf(item.row)}</span>
              {item.guest && <>{" "}<GuestBadge /></>}
            </span>
          ))}
        </span>
      )}
      <span className="tls-racing-bar" aria-hidden="true">
        <span style={{ "--share": barShare(row.points, lead), "--i": Math.min(index, 12) }} data-testid="racing-team-bar" />
      </span>
    </span>
  );
}

function TeamResult({ result, name, rows }) {
  if (!result) return <span className="text-white/20" title={`${name}: nicht dabei`}><span aria-hidden="true">–</span><span className="sr-only">{`${name}: nicht dabei`}</span></span>;
  const who = (result.drivers || []).map((key) => nameOf(rows.find((item) => item.key === key))).join(", ");
  const label = `${name}: ${formatNumber(result.points)} ${Number(result.points) === 1 ? "Punkt" : "Punkte"}${who ? ` (${who})` : ""}`;
  return (
    <span title={label}>
      <span aria-hidden="true" data-testid="racing-team-cell">{formatNumber(result.points)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function RacingLeague({ data }) {
  const racing = data.racing || {};
  const rounds = useMemo(() => data.rounds || [], [data.rounds]);
  const rows = useMemo(() => data.standings?.rows || [], [data.standings]);
  const drivers = useMemo(() => racing.drivers || {}, [racing.drivers]);
  const [params, setParams] = useSearchParams();
  const [flash, setFlash] = useState(0);
  const detailRef = useRef(null);

  const club = useMemo(() => clubDrivers(rows), [rows]);
  const teamRows = useMemo(() => teamTableRows(racing.teams?.rows, racing.club_teams), [racing.teams, racing.club_teams]);
  const garage = useMemo(() => garageTeams(racing.club_teams, rows, drivers, racing.teams?.rows), [racing.club_teams, rows, drivers, racing.teams]);
  const selected = club.find((row) => row.key === params.get(FAHRER)) || club[0] || null;
  const teamLead = Math.max(0, ...teamRows.map((row) => Number(row.points) || 0));
  const bonus = bonusLabel(data.rules);
  const teamRule = teamRuleLabel(racing.team_scoring);

  const select = useCallback((key, { jump = false } = {}) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(FAHRER, key);
      return next;
    }, { replace: true, preventScrollReset: true });
    const node = detailRef.current;
    if (!node) return;
    const behavior = motionAllowed() ? "smooth" : "auto";
    if (jump) {
      setFlash((value) => value + 1);
      node.scrollIntoView?.({ behavior, block: "start" });
      node.focus?.({ preventScroll: true });
    } else {
      node.scrollIntoView?.({ behavior, block: "nearest" });
    }
  }, [setParams]);
  const jumpTo = useCallback((key) => select(key, { jump: true }), [select]);

  return (
    <>
      <SeasonSwitcher seasons={racing.seasons} lineageSlug={data.lineage?.slug} />
      <SeriesProgress progress={data.progress} rounds={rounds} words={PROGRESS_WORDS.racing} />

      {selected && (
        <section className="mt-10" aria-labelledby="racing-garage-title" data-testid="racing-garage">
          <h2 id="racing-garage-title" className="font-heading text-2xl font-black uppercase">Vereins-Garage</h2>
          <RacingGarageTeams garage={garage} rows={rows} drivers={drivers} selectedKey={selected.key} onSelect={select} />
          <RacingDriverDetail ref={detailRef} row={selected} driver={drivers[selected.key]} rounds={rounds} flash={flash} />
        </section>
      )}

      <section className="mt-12" aria-labelledby="racing-drivers-title" data-testid="racing-drivers">
        <h2 id="racing-drivers-title" className="font-heading text-2xl font-black uppercase">Fahrerwertung</h2>
        <SeriesRules rules={data.rules} />
        {bonus && <p className="mt-2 text-sm text-white/70" data-testid="racing-bonus"><span className="text-white/45">Bonus </span>{bonus}</p>}
        <SeriesStandings
          standings={data.standings}
          rounds={rounds}
          rules={data.rules}
          label="Fahrerwertung"
          filterLabel="Nur Vereinsfahrer"
          renderName={(row) => <DriverCell row={row} driver={drivers[row.key]} onSelect={jumpTo} />}
          renderResult={(result, name) => <RaceCell result={result} name={name} />}
          renderPoints={(row) => <RacingPoints row={row} />}
          extraColumn={{ header: "Abstand", title: "Abstand zur Spitze in Punkten", cell: (row) => <span data-testid="racing-gap">{gapLabel(row, rows)}</span> }}
        />
      </section>

      {teamRows.length > 0 && (
        <section className="mt-12" aria-labelledby="racing-teams-title" data-testid="racing-teams">
          <h2 id="racing-teams-title" className="font-heading text-2xl font-black uppercase">Teamwertung</h2>
          {teamRule && <p className="mt-3 text-sm text-white/70" data-testid="racing-team-rule">{teamRule}</p>}
          <SeriesStandings
            standings={{ rows: teamRows }}
            rounds={rounds}
            rules={null}
            label="Teamwertung"
            filterLabel={null}
            renderName={(row, index) => <TeamCell row={row} index={index} rows={rows} drivers={drivers} lead={teamLead} />}
            renderResult={(result, name) => <TeamResult result={result} name={name} rows={rows} />}
            renderPoints={(row) => <RacingPoints row={row} />}
            extraColumn={{ header: "Abstand", title: "Abstand zur Spitze in Punkten", cell: (row) => <span data-testid="racing-gap">{gapLabel(row, teamRows)}</span> }}
          />
        </section>
      )}

      <SeriesFinal final={data.final} />
      <RacingCalendar rounds={rounds} rows={rows} onSelect={jumpTo} />
    </>
  );
}
