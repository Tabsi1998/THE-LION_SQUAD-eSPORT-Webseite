// Gesamtwertung über Seasons (F.5, #2215, docs/LIGA.md „F.5“) unter /liga/<liga>/<season>/gesamtwertung: der Zeitraum dieser Season,
// je Liga N eine eigene Wertung mit Co-Teams und Spielern. Punkte je Season als Spalten (am Handy zum Aufklappen), Streichergebnisse
// durchgestrichen, Staffelsiege mit Krone, Aufsteiger in der Wertung leuchten einmal auf. Gerechnet wird auf dem Server nach der
// Sichtbarkeit der Person - Gäste sehen den öffentlichen Stand.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUp, ChevronDown, Crown, Download, Lock, Trophy } from "lucide-react";
import { API, api } from "@/lib/api";
import { CountUp, StaggerIn } from "@/components/tls/motion";
import { SeasonShell } from "@/components/tls/league/public/SeasonShell";
import { StaffelRewards } from "@/components/tls/rewards/StaffelRewards";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { cellText, pointsWord, rulesLine, seasonColumns, stateLine, tiebreakLine } from "@/lib/leagueOverall";
import { viennaDate } from "@/lib/vienna";
import "@/components/tls/league/public/overall.css";

const LONG_DAY = { day: "2-digit", month: "2-digit", year: "numeric" };

function Cell({ cell }) {
  if (!cell.played) return <span aria-hidden="true">–</span>;
  return (
    <>
      {cell.champion ? <Crown className="tls-overall-cell__crown" aria-hidden="true" /> : null}
      {cell.exit ? "ausg." : cell.points}
    </>
  );
}

function Row({ row, index, columns, kind, leader, testId }) {
  const [open, setOpen] = useState(false);
  const detailId = `${testId}-detail-${index}`;
  const name = kind === "teams" && row.team_id
    ? <Link to={`/teams/${row.team_id}`}>{row.name}</Link>
    : kind === "players" && row.username ? <Link to={`/u/${row.username}`}>{row.name}</Link> : row.name;
  return (
    <Fragment>
      <tr className="tls-overall-row" style={{ "--tls-stagger-i": index }} data-leader={leader ? "true" : undefined}
        data-climbed={row.climbed ? "true" : undefined} data-testid={`${testId}-row-${index}`}>
        <td className="tls-overall-rank w-12 pl-3 sm:pl-4">
          {row.place}.{row.tie ? <span className="sr-only"> (geteilt)</span> : null}
        </td>
        <td>
          <span className="flex min-w-0 items-center gap-2">
            {leader ? <Trophy className="h-4 w-4 shrink-0 text-[var(--tls-honor)]" aria-label="Führt die Gesamtwertung an" /> : null}
            <span className={`tls-overall-name ${row.private ? "italic text-white/60" : ""}`}>{name}</span>
            {row.climbed ? <ArrowUp className="tls-overall-up h-3.5 w-3.5 shrink-0" aria-label="In der Wertung nach vorn gekommen" /> : null}
          </span>
          {row.lead_decision ? (
            <span className="mt-0.5 block text-[11px] text-white/50">{row.lead_decision.method_label || "Entscheid"}: {row.lead_decision.reason}</span>
          ) : null}
        </td>
        {row.seasons.map((cell, at) => (
          <td key={cell.season_id} className="tls-overall-cell hidden sm:table-cell" data-counted={cell.played ? String(cell.counted) : undefined}
            data-played={cell.played ? undefined : "false"} title={cellText(cell, columns[at]?.name)}>
            <span className="sr-only">{cellText(cell, columns[at]?.name)}</span>
            <span aria-hidden="true"><Cell cell={cell} /></span>
          </td>
        ))}
        <td className="tls-overall-total pr-1 sm:pr-4">
          <CountUp value={row.total} delay={Math.min(index, 11) * 50} flash={false} />
        </td>
        <td className="w-12 pr-2 sm:hidden">
          <button type="button" className="tls-overall-more" aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((value) => !value)}
            aria-label={`Punkte je Season: ${row.name}`} data-testid={`${testId}-more-${index}`}>
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </td>
      </tr>
      {open ? (
        <tr className="tls-overall-detail sm:hidden" id={detailId}>
          <td />
          <td colSpan={3}>
            <dl>
              {row.seasons.map((cell, at) => (
                <Fragment key={cell.season_id}>
                  <dt>{columns[at]?.name}{cell.played && cell.place ? ` · Platz ${cell.place} von ${cell.of}` : ""}{cell.exit ? " · ausgeschieden" : ""}</dt>
                  <dd data-counted={cell.played ? String(cell.counted) : undefined}>{cell.played ? pointsWord(cell.points) : "–"}</dd>
                </Fragment>
              ))}
            </dl>
          </td>
        </tr>
      ) : null}
    </Fragment>
  );
}

function StandingTable({ block, kind, columns, testId }) {
  const rows = kind === "teams" ? block.teams : block.players;
  const leaderPlace = rows.filter((row) => row.place === 1).length === 1 ? 1 : null;
  const label = `${kind === "teams" ? "Co-Teams" : "Spieler"} · ${block.label}`;
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
    <div role="region" aria-label={label} tabIndex={0} className="tls-swipe mt-4 rounded-md border border-white/10 bg-[var(--tls-surface-1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]">
      <table className="tls-overall-table" aria-label={label} data-testid={testId}>
        <thead>
          <tr>
            <th scope="col" className="pl-3 text-left sm:pl-4">#</th>
            <th scope="col" className="text-left">{kind === "teams" ? "Co-Team" : "Spieler"}</th>
            {columns.map((column) => <th key={column.id} scope="col" className="hidden text-right sm:table-cell">{column.name}</th>)}
            <th scope="col" className="pr-1 text-right sm:pr-4">Summe</th>
            <th scope="col" className="sm:hidden"><span className="sr-only">Details</span></th>
          </tr>
        </thead>
        <StaggerIn as="tbody" key={`${kind}-${block.level}`} className="tls-overall-body">
          {rows.map((row, index) => (
            <Row key={row.key || `privat-${index}`} row={row} index={index} columns={columns} kind={kind} testId={testId}
              leader={Boolean(leaderPlace) && row.place === 1 && block.closed} />
          ))}
        </StaggerIn>
      </table>
      {!rows.length ? <p className="px-4 py-8 text-center text-sm text-white/50">Noch niemand in der Wertung.</p> : null}
    </div>
  );
}

function Level({ block, data, leagueSlug, seasonSlug }) {
  const [kind, setKind] = useState("teams");
  const columns = seasonColumns(data.seasons, block.season_ids);
  const leader = block.teams.filter((row) => row.place === 1);
  const testId = `overall-${block.level}`;
  const rewardData = useMemo(() => ({
    staffel: { rewards: block.rewards?.length ? { granted: block.rewards_granted ?? block.closed, items: block.rewards } : null },
    standings: block.teams.map((row) => ({ registration_id: row.key, display_name: row.name, rank: row.place, points: row.total })),
    teams: [],
  }), [block]);
  return (
    <section className="mt-8" aria-labelledby={`${testId}-head`} data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
        <div className="min-w-0">
          <h2 id={`${testId}-head`} className="font-heading text-2xl font-black uppercase [overflow-wrap:anywhere] hyphens-auto md:text-3xl">{block.label}</h2>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-white/60" data-testid={`${testId}-state`}>
            {block.closed ? <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
            {stateLine(block, (value) => viennaDate(value, LONG_DAY))}
          </p>
        </div>
        <div className="tls-overall-tabs" role="group" aria-label="Wertung">
          {[["teams", "Co-Teams"], ["players", "Spieler"]].map(([key, text]) => (
            <button key={key} type="button" className="tls-overall-tab" aria-pressed={kind === key} onClick={() => setKind(key)} data-testid={`${testId}-${key}`}>
              {text}
            </button>
          ))}
        </div>
      </div>
      {block.closed && leader.length === 1 ? (
        <p className="tls-league-champion mt-4" data-testid={`${testId}-winner`}>
          <Crown className="h-4 w-4 shrink-0" aria-hidden="true" /> Gesamtsieger <span className="min-w-0 text-white [overflow-wrap:anywhere] hyphens-auto">{leader[0].name}</span>
        </p>
      ) : null}
      <StandingTable block={block} kind={kind} columns={columns} testId={`${testId}-${kind}-table`} />
      <ul className="tls-overall-legend mt-2" aria-label="Zeichen der Tabelle">
        <li className="inline-flex items-center gap-1"><Crown className="h-3 w-3 text-[var(--tls-honor)]" aria-hidden="true" /> Staffelsieg (mit Zusatzpunkten)</li>
        <li><span className="text-white/40 line-through">3</span> Streichergebnis</li>
        <li>– nicht dabei · ausg. ausgeschieden (0 Punkte)</li>
        {kind === "players" ? <li>Spieler bekommen die Punkte ihres Co-Teams, wenn sie mindestens ein Spiel gespielt haben.</li> : null}
      </ul>
      <p className="mt-2 text-[11px] text-white/55" data-testid={`${testId}-rules`}>{rulesLine(block.settings || data.settings)} {tiebreakLine(block.settings || data.settings)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href={`${API}/leagues/${leagueSlug}/${seasonSlug}/overall.pdf?level=${block.level}`} target="_blank" rel="noopener noreferrer"
          className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider"
          data-testid={`${testId}-pdf`}>
          <Download className="h-4 w-4" aria-hidden="true" /> PDF
        </a>
      </div>
      <div className="mt-6">
        <StaffelRewards data={rewardData} staffel={{ staffel: `gesamt-${block.level}` }} />
      </div>
    </section>
  );
}

function Overall({ data }) {
  const leagueSlug = data.league.slug;
  const seasonSlug = data.season.slug;
  const [view, setView] = useState(null);
  const [failed, setFailed] = useState(false);
  const [level, setLevel] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/leagues/${leagueSlug}/${seasonSlug}/overall`);
      setView(body);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [leagueSlug, seasonSlug]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["leagues"]);
  if (failed && !view) {
    return <p className="mt-10 text-sm text-white/60" role="status" data-testid="overall-missing">Für diese Season gibt es keine Gesamtwertung.</p>;
  }
  if (!view) return <div className="tls-league-skeleton mt-10" aria-busy="true" aria-label="Lade Gesamtwertung" />;
  const levels = view.levels || [];
  const active = levels.find((row) => row.level === level) || levels[0];
  return (
    <div className="mt-8" data-testid="overall">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-white/70">
          <span className="font-bold uppercase tracking-wider text-white">{view.period.name}</span>
          {" · "}{view.seasons.map((row) => row.name).join(", ") || "noch keine Season"}
        </p>
      </div>
      {levels.length > 1 ? (
        <div className="tls-overall-tabs mt-4" role="group" aria-label="Liga N">
          {levels.map((row) => (
            <button key={row.level} type="button" className="tls-overall-tab" aria-pressed={row.level === active.level}
              onClick={() => setLevel(row.level)} data-testid={`overall-level-${row.level}`}>
              {row.label}
            </button>
          ))}
        </div>
      ) : null}
      {active ? <Level key={active.level} block={active} data={view} leagueSlug={leagueSlug} seasonSlug={seasonSlug} />
        : <p className="mt-8 text-sm text-white/60" data-testid="overall-empty">Noch keine abgeschlossene Season – die Gesamtwertung beginnt mit dem ersten Endstand.</p>}
    </div>
  );
}

export default function LeagueSeasonOverallPage() {
  return <SeasonShell section="gesamtwertung">{(data) => <Overall data={data} />}</SeasonShell>;
}
