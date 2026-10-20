import { Link } from "react-router-dom";
import { seriesAddress } from "@/lib/referenceSeries";
import { KIND_LABELS, leaguePath } from "@/lib/referencesOverview";
import { SectionHead } from "@/components/tls/references/overviewParts";
import { SEASON_NOTE_TONES } from "@/lib/seriesTiers";

// Serien & Ligen (#1878): je Spur eine Karte mit ihrem Liga-Weg - jede sichtbare Saison mit Stufe, unserem Platz und dem
// Vermerk (Aufstieg, Abstieg, Meister, Klassenerhalt, läuft - zuerst das „Ergebnis der Saison“, #1898). Die laufende Saison ist hervorgehoben, die Karte führt zur Serienseite (laufende,
// sonst neueste Saison). Die Daten kommen gesammelt aus /api/reference-series/public/lineages, ohne Namen.

const NOTE_TONES = SEASON_NOTE_TONES;

export function SeriesPaths({ lineages, index = 4 }) {
  if (!lineages?.length) return null;
  return (
    <section id="serien" aria-labelledby="references-series-title" className="tls-ref-anchor tls-ref-rise max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-[88px]" style={{ "--tls-ref-i": index }} data-testid="references-series">
      <SectionHead id="references-series-title" eyebrow="Unser Weg" title="Serien & Ligen" hint="Jede Saison mit Platz, Auf- und Abstieg" />
      <div className="grid gap-3.5 md:gap-5 grid-cols-1 md:grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))]">
        {lineages.map((item) => <LineageCard key={item.lineage.slug} item={item} />)}
      </div>
    </section>
  );
}

function LineageCard({ item }) {
  const { lineage } = item;
  const path = leaguePath(item.seasons, lineage.tier_order);
  const kind = [KIND_LABELS[lineage.kind], lineage.organizer].filter(Boolean).join(" · ");
  const card = (
    <>
      <div className="flex flex-col gap-1 min-w-0">
        <div className="text-[11px] md:text-xs font-bold uppercase tracking-[0.14em] md:tracking-[0.16em] text-quiet break-words">{kind}</div>
        <div className="font-heading font-extrabold uppercase leading-[1.2] text-lg md:text-xl break-words [overflow-wrap:anywhere]" data-testid="references-lineage-title">{lineage.title}</div>
      </div>
      <ol className="list-none m-0 p-0 grid grid-cols-3 gap-2 md:gap-2.5" aria-label="Liga-Weg">
        {path.steps.map((step) => <Step key={step.season_slug || `${step.season}-${step.tier}`} step={step} kind={lineage.kind} />)}
      </ol>
      <div className="mt-auto flex flex-wrap justify-between items-center gap-2.5 text-sm">
        <span className="text-zinc-400">{path.summary}</span>
        {path.target && <span className="text-brand font-bold whitespace-nowrap">Zur Serie →</span>}
      </div>
    </>
  );
  const className = "tls-ref-lift min-w-0 flex flex-col gap-3.5 md:gap-[22px] p-[18px] md:p-[22px] bg-surface-1 border border-white/[0.08] rounded-[10px] text-white no-underline";
  if (!path.target) return <div className={className} data-testid={`references-lineage-${lineage.slug}`}>{card}</div>;
  return <Link to={seriesAddress(lineage, path.target)} className={className} data-testid={`references-lineage-${lineage.slug}`}>{card}</Link>;
}

function Step({ step, kind }) {
  const place = step.club?.rank;
  const placeTone = place === 1 ? "text-honor" : step.current ? "text-brand" : "text-white";
  return (
    <li
      data-testid="references-step"
      data-current={step.current ? "true" : undefined}
      data-note={step.note || undefined}
      aria-current={step.current ? "step" : undefined}
      className={`min-w-0 flex flex-col gap-1 md:gap-1.5 p-2.5 md:p-3 rounded-lg border ${step.current ? "bg-brand/[0.08] border-brand/45" : "bg-surface-2 border-white/[0.07]"}`}
    >
      <div className="text-[11px] md:text-xs text-zinc-400 break-words [overflow-wrap:anywhere]">{step.season}</div>
      <div className="font-bold text-[13px] md:text-sm text-white break-words [overflow-wrap:anywhere]">{step.tier || (kind === "team_league" ? "Liga" : "Gesamt")}</div>
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-baseline gap-1 md:gap-x-1.5">
        <span className={`font-display font-bold text-[22px] md:text-[26px] leading-none tabular-nums ${placeTone}`} title={step.club?.of ? `${place}. von ${step.club.of}` : undefined}>{place ? `${place}.` : "–"}</span>
        {step.note && <span className={`text-[10px] md:text-xs font-bold uppercase tracking-[0.06em] md:tracking-[0.08em] break-words [overflow-wrap:anywhere] ${NOTE_TONES[step.note] || "text-zinc-400"}`}>{step.note}</span>}
      </div>
    </li>
  );
}
