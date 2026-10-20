import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Radio } from "lucide-react";
import { api } from "@/lib/api";
import { seriesAddress } from "@/lib/referenceSeries";
import { dayNoon, viennaDate } from "@/lib/vienna";
import { GameMark, SectionTitle } from "@/components/tls/references/referenceParts";

// „Heute im Einsatz“ und „Läuft gerade“ (#1748): laufende Serien-Saisons mit Fortschritt, nächstem Termin und dem
// aktuellen Platz des Vereins. Die Daten kommen aus einem eigenen schlanken Endpunkt (nur sichtbare, aktive Saisons,
// keine fremden Namen). Ist nichts laufend (oder der Abruf scheitert), erscheint der Bereich gar nicht - die Seite
// sieht dann aus wie bisher.

const KIND_LABELS = { series: "Turnierserie", racing: "Rennliga", team_league: "Team-Liga" };

export function nextLabel(next) {
  if (!next) return "";
  const clock = next.time ? `${next.time} Uhr` : "";
  if (next.state === "today") return ["Heute", clock].filter(Boolean).join(", ");
  const day = next.club_day ? viennaDate(dayNoon(next.club_day), { weekday: "short", day: "2-digit", month: "2-digit" }) : "";
  return [day, clock].filter(Boolean).join(", ");
}

export function seasonLabel(item) {
  const { series } = item;
  return [series?.title, series?.season, series?.tier].filter(Boolean).join(" · ");
}

export function RunningSeries() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get("/reference-series/public/running").then(({ data }) => {
      const list = Array.isArray(data?.items) ? data.items.filter((item) => item?.lineage && item?.series) : [];
      if (alive) setItems(list);
    }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  if (!items.length) return null;
  const today = items.filter((item) => item.today);
  const rest = items.filter((item) => !item.today);
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 space-y-10" data-testid="references-running">
      {today.length > 0 && (
        <div data-testid="references-today">
          <SectionTitle icon={Radio} accent="rgb(var(--tls-honor-rgb))" eyebrow="Heute im Einsatz" title="Wir treten heute an" />
          <RunningGrid items={today} />
        </div>
      )}
      {rest.length > 0 && (
        <div data-testid="references-running-list">
          <SectionTitle icon={CalendarDays} accent="#29B6E8" eyebrow="Läuft gerade" title="Laufende Saisons" />
          <RunningGrid items={rest} />
        </div>
      )}
    </section>
  );
}

function RunningGrid({ items }) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item, index) => <RunningCard key={`${item.lineage.slug}/${item.series.season_slug}`} item={item} index={index} />)}
    </div>
  );
}

function RunningCard({ item, index }) {
  const { lineage, series, progress, next, club } = item;
  const total = progress?.total || 0;
  const scored = Math.min(progress?.scored || 0, total);
  const percent = total ? Math.round((scored / total) * 100) : 0;
  const detail = seasonLabel(item);
  return (
    <Link
      to={seriesAddress(lineage, series)}
      data-testid={`running-card-${lineage.slug}-${series.season_slug}`}
      data-today={item.today ? "true" : undefined}
      style={{ "--tls-run-i": Math.min(index, 8) }}
      className={`tls-run-card block min-w-0 border rounded-sm p-4 bg-[#111] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#29B6E8] ${item.today ? "border-honor/50" : "border-white/10"}`}
    >
      <div className="flex items-start gap-3">
        <GameMark game={item.game} code className="w-10 h-10 border border-white/10" codeClass="text-xs" iconClass="w-5 h-5" padded />
        <div className="min-w-0 flex-1">
          <div className="font-heading font-black uppercase leading-tight break-words" data-testid="running-title">{lineage.title}</div>
          <div className="mt-1 text-[10px] uppercase tracking-widest font-bold text-white/45 break-words">
            {[KIND_LABELS[lineage.kind], detail].filter(Boolean).join(" · ")}
          </div>
        </div>
        {item.today && (
          <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-sm bg-honor/15 text-honor text-[10px] uppercase tracking-widest font-bold" data-testid="running-today-badge">
            <span className="tls-run-pulse" aria-hidden="true" /> Heute
          </span>
        )}
      </div>

      {total > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-white/60" data-testid="running-progress-text">{scored} von {total} {total === 1 ? "Termin" : "Terminen"}</span>
            <span className="text-white/35 tabular-nums">{percent}%</span>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden" role="progressbar" aria-label="Fortschritt der Saison" aria-valuemin={0} aria-valuemax={total} aria-valuenow={scored}>
            <div className="tls-run-fill h-full rounded-full bg-[#29B6E8]" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-widest font-bold text-white/40">Nächster Termin</dt>
          <dd className="mt-0.5 text-white/85 break-words" data-testid="running-next">
            {next ? [nextLabel(next), next.code || next.title].filter(Boolean).join(" · ") : "Kein Termin offen"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[10px] uppercase tracking-widest font-bold text-white/40">Unser Platz</dt>
          <dd className="mt-0.5 text-white/85" data-testid="running-place">
            {club ? <><span className="font-heading font-black text-lg text-honor">{club.rank}.</span>{club.of ? <span className="text-white/45"> von {club.of}</span> : null}</> : <span className="text-white/45">Noch offen</span>}
          </dd>
        </div>
      </dl>
    </Link>
  );
}
