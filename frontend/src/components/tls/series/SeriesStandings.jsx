import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatNumber, rankMove } from "@/lib/standingsTable";
import { roundLabel } from "@/lib/referenceCalendar";
import { CountryFlag } from "@/components/tls/CountryFlag";
import {
  cutlineAfter, mobileRows, nameOf, resultIn, resultLabel, roundColumns, tiebreakHint, visibleRows,
} from "@/lib/referenceSeriesTable";
import "./referenceSeries.css";

// Gesamtwertung einer Turnierserie (#1745). Baut auf der Rangliste der Turniere auf (lib/standingsTable: Bewegung und
// Zahlen, Klassen tls-standings / tls-standing-*): Ergebnis je Runde, gestrichene Ergebnisse durchgestrichen und blass,
// Linie „Finalgrenze“, Filter „Nur Vereinsspieler“. Am Handy Karten (Top 10 und Vereinsspieler, alles aufklappbar)
// statt der breiten Tabelle. Fremde Namen sind reiner Text, nur Vereinsmitglieder verlinken auf ihr Profil.
// Die Rennliga (#1746) nutzt dieselbe Tabelle für Fahrer- und Teamwertung: Name, Ergebniszelle und Punkte lassen sich
// über `render…` ersetzen, eine Spalte (etwa „Abstand“) kommt über `extraColumn` dazu.

function places(by) {
  return `${by} ${by === 1 ? "Platz" : "Plätze"}`;
}

function Move({ row }) {
  const move = rankMove(row);
  if (!move || move.direction === "same") return null;
  const up = move.direction === "up";
  const Icon = up ? ChevronUp : ChevronDown;
  const label = `${places(move.by)} ${up ? "hinauf" : "hinunter"} seit der Runde davor`;
  return (
    <span className="tls-standing-move" data-dir={move.direction} role="img" aria-label={label} title={label} data-testid="series-move">
      <Icon className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
      <span aria-hidden="true">{move.by}</span>
    </span>
  );
}

function Name({ row }) {
  const name = nameOf(row);
  return (
    <span className="flex items-center gap-2 min-w-0">
      {row.club_member && row.profile_slug ? (
        <Link to={`/members/${row.profile_slug}`} className="tls-standing-name text-white font-semibold hover:text-[#29B6E8] focus-visible:text-[#29B6E8]">{name}</Link>
      ) : (
        <span className={`tls-standing-name ${row.name_hidden ? "text-white/40 italic" : "text-white font-medium"}`}>{name}</span>
      )}
      {row.club_member && <span className="tls-standing-me">Verein</span>}
    </span>
  );
}

export function Points({ row }) {
  const hint = tiebreakHint(row.tiebreak);
  return (
    <span title={hint || undefined} className={hint ? "underline decoration-dotted decoration-white/30 underline-offset-4" : undefined}>
      {formatNumber(row.points)}
      {hint && <span className="sr-only"> ({hint})</span>}
    </span>
  );
}

function ResultValue({ result, name }) {
  if (!result) return <span className="text-white/20" aria-label={`${name}: nicht dabei`}>–</span>;
  return (
    <span className={result.dropped ? "tls-series-dropped" : undefined} title={resultLabel(result, name)} data-dropped={result.dropped ? "true" : undefined}>
      <span aria-hidden="true">{formatNumber(result.points)}</span>
      <span className="sr-only">{resultLabel(result, name)}</span>
    </span>
  );
}

function Cutline({ topN, span }) {
  return (
    <tr className="tls-series-cutline" data-testid="series-cutline">
      <td colSpan={span}><span className="tls-series-cutline__label">Finalgrenze · Top {topN}</span></td>
    </tr>
  );
}

const DEFAULT_VIEW = {
  renderName: (row) => <Name row={row} />,
  renderResult: (result, name) => <ResultValue result={result} name={name} />,
  renderPoints: (row) => <Points row={row} />,
  extraColumn: null,
};

function DesktopTable({ rows, columns, topN, cutAfter, label, view }) {
  const { extraColumn } = view;
  const span = columns.length + 3 + (extraColumn ? 1 : 0);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable)
    <div role="region" aria-label={label} tabIndex={0} className="tls-standings hidden md:block border border-white/10 rounded-md bg-[var(--tls-surface-1)] overflow-x-auto overscroll-x-contain focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]" data-testid="series-table">
      <table className="w-full text-sm tabular-nums">
        <thead className="text-[11px] uppercase tracking-[0.12em] text-white/50">
          <tr className="border-b border-white/10">
            <th scope="col" className="text-left pl-4 pr-1 py-2.5 w-16 font-semibold">#</th>
            <th scope="col" className="text-left px-2 py-2.5 font-semibold">Name</th>
            {columns.map((round, index) => (
              <th key={round.id} scope="col" title={round.state === "cancelled" ? "Abgesagt" : undefined} className={`px-2 py-2.5 text-right align-bottom font-semibold whitespace-nowrap ${round.state === "cancelled" ? "line-through text-white/25" : ""}`}>
                {/* Flagge des Rennens (#1925) über dem Kürzel - Spalten ohne Land bleiben auf derselben Grundlinie. */}
                {round.country_code ? (
                  <span className="inline-flex flex-col items-end gap-1" data-testid="series-round-flag">
                    <CountryFlag code={round.country_code} size="sm" />
                    {roundLabel({ ...round, position: round.position || index + 1 })}
                  </span>
                ) : roundLabel({ ...round, position: round.position || index + 1 })}
              </th>
            ))}
            <th scope="col" title={`Punkte der ${label}`} className={`text-right ${extraColumn ? "px-2" : "pr-4 pl-2"} py-2.5 font-semibold`}>Pkt</th>
            {extraColumn && <th scope="col" title={extraColumn.title} className="text-right pr-4 pl-2 py-2.5 font-semibold whitespace-nowrap">{extraColumn.header}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <Fragment key={row.key}>
              <tr className="tls-standing-row tls-series-row" style={{ "--i": Math.min(index, 12) }} data-testid="series-row" data-club={row.club_member ? "true" : undefined} data-mine={row.club_member ? "true" : undefined}>
                <td className="pl-4 pr-1 py-2.5 align-middle">
                  <span className="flex items-center gap-1.5">
                    <span className="font-display text-base font-bold text-white w-5 text-right">{row.rank}</span>
                    <Move row={row} />
                  </span>
                </td>
                <th scope="row" className="px-2 py-2.5 align-middle min-w-[10rem] text-left font-normal">{view.renderName(row, index)}</th>
                {columns.map((round, roundIndex) => (
                  <td key={round.id} className="px-2 py-2.5 text-right align-middle text-white/70">
                    {view.renderResult(resultIn(row, round.id), roundLabel({ ...round, position: round.position || roundIndex + 1 }), row)}
                  </td>
                ))}
                <td className={`${extraColumn ? "px-2" : "pr-4 pl-2"} py-2.5 text-right align-middle font-display text-base font-bold text-white`}>{view.renderPoints(row)}</td>
                {extraColumn && <td className="pr-4 pl-2 py-2.5 text-right align-middle tabular-nums text-white/60">{extraColumn.cell(row)}</td>}
              </tr>
              {cutAfter === row.key && <Cutline topN={topN} span={span} />}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobileCards({ rows, allCount, columns, topN, expanded, onExpand, view }) {
  const { extraColumn } = view;
  const shown = mobileRows(rows, { expanded });
  const cutAfter = cutlineAfter(shown, topN);
  return (
    <div className="md:hidden" data-testid="series-cards">
      <ol className="space-y-2">
        {shown.map((row, index) => (
          <Fragment key={row.key}>
            <li className="tls-standing-row tls-series-row border border-white/10 rounded-md bg-[var(--tls-surface-1)] px-3 py-2.5" style={{ "--i": Math.min(index, 12) }} data-testid="series-card" data-mine={row.club_member ? "true" : undefined}>
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 w-12 shrink-0">
                  <span className="font-display text-lg font-bold text-white tabular-nums">{row.rank}</span>
                  <Move row={row} />
                </span>
                <span className="min-w-0 flex-1">{view.renderName(row, index)}</span>
                <span className="flex flex-col items-end shrink-0">
                  <span className="font-display text-lg font-bold text-white tabular-nums">{view.renderPoints(row)}</span>
                  {extraColumn && <span className="text-[11px] tabular-nums text-white/50">{extraColumn.cell(row)}</span>}
                </span>
              </div>
              {columns.length > 0 && (
                <div className="mt-1.5 pl-[3.75rem] flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] tabular-nums text-white/60">
                  {columns.map((round, roundIndex) => {
                    const name = roundLabel({ ...round, position: round.position || roundIndex + 1 });
                    const result = resultIn(row, round.id);
                    if (!result) return null;
                    return (
                      <span key={round.id} className="whitespace-nowrap">
                        <span className="text-white/35" aria-hidden="true">{name} </span>
                        {view.renderResult(result, name, row)}
                      </span>
                    );
                  })}
                </div>
              )}
            </li>
            {cutAfter === row.key && (
              <li className="tls-series-cutline--card" data-testid="series-cutline" aria-label={`Finalgrenze, Top ${topN}`}>
                <span className="tls-series-cutline__label" aria-hidden="true">Finalgrenze · Top {topN}</span>
              </li>
            )}
          </Fragment>
        ))}
      </ol>
      {!expanded && shown.length < allCount && (
        <button type="button" onClick={onExpand} className="mt-3 w-full min-h-[44px] border border-white/15 rounded-md text-sm font-semibold text-white/80 hover:border-[#29B6E8]/60 hover:text-white" data-testid="series-expand">
          Ganze Tabelle zeigen ({allCount})
        </button>
      )}
    </div>
  );
}

/** `standings`: gespeicherter Stand vom Server; `rounds`: Kalender der Saison; `rules`: Regeln der Serie. `label` nennt
 * die Wertung, `filterLabel` den Filter (ohne: kein Filter); `renderName(row, index)`, `renderResult(result, name, row)`,
 * `renderPoints(row)` und `extraColumn` ({ header, title, cell(row) }) ersetzen die Teile der Zeile. */
export function SeriesStandings({
  standings, rounds, rules, label = "Gesamtwertung", filterLabel = "Nur Vereinsspieler",
  renderName, renderResult, renderPoints, extraColumn = null,
}) {
  const [clubOnly, setClubOnly] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const all = useMemo(() => standings?.rows || [], [standings]);
  const rows = visibleRows(all, { clubOnly });
  const columns = useMemo(() => roundColumns(rounds), [rounds]);
  const topN = rules?.final_top_n || null;
  const hasClub = Boolean(filterLabel) && all.some((row) => row.club_member);
  const view = {
    renderName: renderName || DEFAULT_VIEW.renderName,
    renderResult: renderResult || DEFAULT_VIEW.renderResult,
    renderPoints: renderPoints || DEFAULT_VIEW.renderPoints,
    extraColumn,
  };

  if (!all.length) return <p className="mt-3 text-sm text-white/55" data-testid="series-no-table">Noch keine Ergebnisse – die Tabelle erscheint nach der ersten gewerteten Runde.</p>;
  return (
    <div className="mt-4">
      {hasClub && (
        <div className="mb-3 flex justify-end">
          <button
            type="button"
            aria-pressed={clubOnly}
            onClick={() => setClubOnly((value) => !value)}
            className={`min-h-[36px] px-3 rounded-md border text-[12px] font-bold uppercase tracking-[0.12em] transition-colors ${clubOnly ? "border-[#29B6E8]/70 bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/15 text-white/65 hover:text-white hover:border-white/30"}`}
            data-testid="series-filter-club"
          >
            {filterLabel}
          </button>
        </div>
      )}
      <DesktopTable rows={rows} columns={columns} topN={topN} cutAfter={cutlineAfter(rows, topN)} label={label} view={view} />
      <MobileCards rows={rows} allCount={rows.length} columns={columns} topN={topN} expanded={expanded || clubOnly} onExpand={() => setExpanded(true)} view={view} />
    </div>
  );
}
