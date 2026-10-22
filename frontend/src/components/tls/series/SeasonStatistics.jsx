import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { SkeletonLines } from "@/components/tls/Skeleton";
import { CountUp } from "@/components/tls/motion/CountUp";
import { StaggerIn } from "@/components/tls/motion/StaggerIn";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { nameOf } from "@/lib/referenceSeriesTable";
import { METRICS, leaders, metricText, rankBy } from "@/lib/seasonStatistics";
import "./roundResults.css";

// Reiter „Statistik“ der Serienseite einer Rennliga (#1950): je Fahrer bzw. Team Siege, Podien, Poles, schnellste
// Runden, Fahrer des Tages, Ausfälle, Ø Start, Ø Ziel und gutgemachte Plätze. Oben je Kennzahl die Spitze („Meiste
// Poles“), darunter die ganze Tabelle, sortiert nach der gewählten Kennzahl. Nur Kennzahlen, die vorkommen; Vereinsfahrer
// und eigene Teams hervorgehoben. Fremde Namen stehen wie in jeder Tabelle der Serienseite nur als Text.

function Who({ row }) {
  if (row.team && row.key === row.team) return <span className="font-semibold text-white">{row.team}</span>;
  if (row.club_member && row.profile_slug && !row.name_hidden) {
    return <Link to={`/members/${row.profile_slug}`} className="font-semibold text-white hover:text-[#29B6E8]">{nameOf(row)}</Link>;
  }
  return <span className={row.name_hidden ? "text-white/45 italic" : "text-white font-medium"}>{nameOf(row)}</span>;
}

function mine(row) {
  return Boolean(row.club_member || row.own);
}

export function SeasonStatistics({ lineageSlug, seasonSlug }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [scope, setScope] = useState("drivers");
  const [metric, setMetric] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/reference-series/public/${encodeURIComponent(lineageSlug)}/${encodeURIComponent(seasonSlug)}/statistics`);
      setData(body);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [lineageSlug, seasonSlug]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  const rows = useMemo(() => data?.[scope] || [], [data, scope]);
  const metrics = useMemo(() => data?.metrics?.[scope] || [], [data, scope]);
  const active = metrics.includes(metric) ? metric : metrics[0] || null;
  const ranked = useMemo(() => (active ? rankBy(rows, active) : rows.map((row) => ({ row, rank: null }))), [rows, active]);
  const hasTeams = (data?.teams || []).length > 0;

  if (failed && !data) return <p className="mt-6 text-sm text-white/55" data-testid="season-stats-error">Die Statistik lässt sich gerade nicht laden.</p>;
  if (!data) return <div className="mt-6"><SkeletonLines lines={5} /></div>;
  if (!rows.length || !metrics.length) {
    return <p className="mt-6 text-sm text-white/55" data-testid="season-stats-empty">Noch keine Ergebnisse – die Statistik erscheint nach der ersten gewerteten Runde.</p>;
  }
  const label = scope === "teams" ? "Team" : "Fahrer";
  return (
    <section className="tls-round mt-6" aria-labelledby="season-stats-title" data-testid="season-stats">
      {/* Der Reiter heißt schon „Statistik“ - die Überschrift ist nur für Screenreader da. */}
      <h2 id="season-stats-title" className="sr-only">Statistik der Saison</h2>
      <div className="flex flex-wrap items-center gap-3">
        {hasTeams && (
          <div className="flex gap-2" role="group" aria-label="Statistik für" data-testid="season-stats-scope">
            {[["drivers", "Fahrer"], ["teams", "Teams"]].map(([key, text]) => (
              <button key={key} type="button" className="tls-season-tab" aria-pressed={scope === key} onClick={() => setScope(key)} data-testid={`season-stats-${key}`}>{text}</button>
            ))}
          </div>
        )}
      </div>

      {/* Rangliste je Kennzahl: die Spitze, ein Tipp auf eine Karte sortiert die Tabelle danach. */}
      {/* Die Karten steigen gestaffelt auf, die Spitzenwerte zählen hoch (#1969). */}
      <StaggerIn as="ul" className="tls-round-facts tls-swipe mt-5" aria-label="Rangliste je Kennzahl" data-testid="season-stats-leaders">
        {metrics.map((key) => (
          <li key={key} className="tls-round-fact tls-stats-leader" data-active={key === active ? "true" : undefined}>
            <button type="button" className="tls-stats-leader__pick" aria-pressed={key === active} onClick={() => setMetric(key)} data-testid={`season-stats-metric-${key}`}>
              <span className="tls-round-fact__label text-[#29B6E8]">{METRICS[key].title}</span>
            </button>
            <ol className="mt-1 space-y-0.5">
              {leaders(rows, key).map(({ row, rank }) => (
                <li key={row.key} className="flex items-baseline gap-2 text-[13px] min-w-0" data-mine={mine(row) ? "true" : undefined}>
                  <span className="w-4 shrink-0 text-white/45 tabular-nums">{rank}</span>
                  <span className={`min-w-0 flex-1 truncate ${mine(row) ? "text-[#29B6E8] font-semibold" : "text-white/85"}`}>{row.team && row.key === row.team ? row.team : nameOf(row)}</span>
                  <CountUp className="shrink-0 font-bold" value={metricText(row, key)} />
                </li>
              ))}
            </ol>
          </li>
        ))}
      </StaggerIn>

      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- eine scrollbare Fläche muss per Tastatur erreichbar sein (axe: scrollable-region-focusable) */}
      <div className="tls-round-table tls-swipe mt-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]" role="region" aria-label={`Statistik je ${label}`} tabIndex={0} data-testid="season-stats-table">
        <table className="text-sm min-w-[640px]">
          <thead>
            <tr>
              <th scope="col" className="w-12">#</th>
              <th scope="col" className="tls-stats-sticky">{label}</th>
              {metrics.map((key) => (
                <th key={key} scope="col" data-align="right" aria-sort={key === active ? (METRICS[key].order === "low" ? "ascending" : "descending") : undefined}>
                  <button type="button" className="tls-stats-sort" aria-pressed={key === active} title={`Sortieren: ${METRICS[key].title}`} onClick={() => setMetric(key)} data-testid={`season-stats-sort-${key}`}>
                    {METRICS[key].column}
                    {METRICS[key].hint && <span className="sr-only"> ({METRICS[key].hint})</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ row, rank }) => (
              <tr key={row.key} className="tls-round-row" data-own={mine(row) ? "true" : undefined} data-testid="season-stats-row">
                <td className="text-white/55 tabular-nums">{rank ?? ""}</td>
                <th scope="row" className="tls-stats-sticky text-left font-normal">
                  <span className="flex items-center gap-2 min-w-0">
                    <Who row={row} />
                    {mine(row) && <span className="tls-standing-me">Verein</span>}
                  </span>
                </th>
                {metrics.map((key) => (
                  <td key={key} className={`text-right tabular-nums ${key === active ? "font-bold text-white" : "text-white/70"}`}>{metricText(row, key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
