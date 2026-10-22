import { Link } from "react-router-dom";
import { referenceHref } from "@/lib/seasonClose";
import { formatLabel, pickShowcase, podiumItems, startersOf, yearOf } from "@/lib/referencesOverview";
import { bestPlacement, displayTitle, entriesOf, gameTitle } from "@/components/tls/references/referenceParts";
import { Mark, PlaceRing, SectionHead, TrophyMark, medalTone } from "@/components/tls/references/overviewParts";
import { CountUp } from "@/components/tls/motion/CountUp";
import { StaggerIn } from "@/components/tls/motion/StaggerIn";

// Vitrine (#1878): der größte Erfolg als Hauptkarte - Oberkante und Pokal in seiner Medaillenfarbe, Titel, Spiel, Art,
// Saison, Kennzahlen und wer für uns am Start war -, daneben die übrigen Podestplätze als ruhige Kacheln, die neuesten
// zuerst. Welche Teilnahme die Hauptkarte bekommt, stellt die Verwaltung ein (Vorgabe: höchster Platz in der höchsten
// Stufe, bei Gleichstand der neueste - lib/referencesOverview.js). Gold, Silber und Bronze nur als Ring und Schrift.
// Karten aus einer Saison führen zur Saison-Seite (#1750).

function seasonOf(item, link) {
  const season = link?.season?.season || item.season || "";
  if (!season) return yearOf(item);
  return /^\d{4}$/.test(season) ? `Saison ${season}` : season;
}

export function Showcase({ items, showcase, linked, index = 3 }) {
  const podium = podiumItems(items);
  if (!podium.length) return null;
  const main = pickShowcase(podium, showcase, linked);
  const rest = podium.filter((item) => item !== main);
  const hint = `${podium.length} ${podium.length === 1 ? "Podestplatz" : "Podestplätze"}${rest.length > 1 ? " · neueste zuerst" : ""}`;
  return (
    <section id="vitrine" aria-labelledby="references-trophies-title" className="tls-ref-anchor tls-ref-rise max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-[88px]" style={{ "--tls-ref-i": index }} data-testid="references-trophies">
      <SectionHead id="references-trophies-title" eyebrow="Vitrine" tone="honor" title="Unsere Podestplätze" hint={hint} />
      <div className="flex flex-wrap gap-3.5 md:gap-5 items-start">
        <MainCard item={main} link={linked?.get(main.id)} pinned={showcase?.mode === "pinned" && showcase.reference_id === main.id} />
        {rest.length > 0 && (
          // Die Kacheln steigen beim ersten Sichtbarwerden gestaffelt auf (#1969).
          <StaggerIn className="flex-[2_1_560px] min-w-0 grid grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(min(100%,200px),1fr))] gap-2.5 md:gap-3 content-start">
            {rest.map((item) => <TrophyTile key={item.id} item={item} link={linked?.get(item.id)} />)}
          </StaggerIn>
        )}
      </div>
    </section>
  );
}

function MainCard({ item, link, pinned }) {
  const placement = bestPlacement(item);
  const tone = medalTone(placement);
  const starters = startersOf(item);
  const entries = entriesOf(item);
  const field = entries.map((entry) => entry.team_count || entry.participant_count).find(Boolean);
  const teams = entries.some((entry) => entry.team_count);
  const figures = [
    { value: `${placement}.`, label: "Platz", tone: tone.text },
    field ? { value: field, label: teams ? "Teams" : "im Feld" } : null,
    starters.length ? { value: starters.length, label: "für uns am Start" } : null,
  ].filter(Boolean);
  const marks = [gameTitle(item), formatLabel(item, link), seasonOf(item, link)].filter(Boolean);
  const to = referenceHref(item, link);
  const season = to !== `/references/${item.id}`;
  return (
    <Link
      to={to}
      data-testid="references-showcase"
      data-reference-id={item.id}
      data-medal={tone.key}
      className={`tls-ref-lift flex-[1_1_420px] min-w-0 flex flex-col gap-3.5 md:gap-5 p-5 md:p-7 bg-surface-1 border border-t-[3px] rounded-[10px] text-white no-underline ${placement === 1 ? "border-honor/35 border-t-honor" : placement === 2 ? "border-silver/35 border-t-silver" : "border-bronze/35 border-t-bronze"}`}
    >
      <div className="flex justify-between items-start gap-3 md:gap-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className={`text-[11px] md:text-xs font-bold uppercase tracking-[0.2em] md:tracking-[0.22em] ${tone.text}`}>{placement}. Platz{entries[0]?.placement_label ? ` · ${entries[0].placement_label}` : ""}</div>
          <div className="text-sm text-zinc-400">{pinned ? "Ausgewählt vom Verein" : "Größter Erfolg bisher"}</div>
        </div>
        <TrophyMark className={`shrink-0 w-14 h-14 md:w-[84px] md:h-[84px] ${tone.text}`} label={`Pokal, ${tone.label}`} />
      </div>
      <div className="font-heading font-extrabold uppercase leading-[1.05] text-2xl md:text-[clamp(26px,2.8vw,36px)] break-words [overflow-wrap:anywhere] [text-wrap:balance]" data-testid="references-showcase-title">{displayTitle(item)}</div>
      <div className="md:hidden text-sm text-zinc-400 break-words">{marks.join(" · ")}</div>
      <div className="hidden md:flex flex-wrap gap-2">{marks.map((mark, position) => <Mark key={`${position}-${mark}`}>{mark}</Mark>)}</div>
      <div className={`hidden md:grid gap-3 py-4 border-y border-white/[0.08] ${figures.length === 3 ? "grid-cols-3" : figures.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {figures.map((figure) => (
          <div key={figure.label} className="min-w-0">
            <div className={`font-display font-bold text-[32px] leading-none tabular-nums ${figure.tone || "text-white"}`}><CountUp value={figure.value} /></div>
            <div className="text-[13px] text-zinc-400">{figure.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap justify-between items-center gap-2.5 pt-3 md:pt-0 border-t border-white/[0.08] md:border-t-0 text-sm">
        {starters.length > 0 && (
          <span className="text-zinc-400 min-w-0 break-words [overflow-wrap:anywhere]" data-testid="references-showcase-starters">
            <span className="hidden md:inline">Für uns am Start: </span><span className="text-white font-semibold">{starters.join(", ")}</span>
          </span>
        )}
        <span className="text-brand font-bold">{season ? "Zur Saison →" : "Zur Referenz →"}</span>
      </div>
    </Link>
  );
}

function TrophyTile({ item, link }) {
  const placement = bestPlacement(item);
  const tone = medalTone(placement);
  return (
    <Link to={referenceHref(item, link)} data-testid={`reference-trophy-${item.id}`} data-medal={tone.key} className="tls-ref-lift min-w-0 flex flex-col gap-2 md:gap-2.5 p-3.5 md:p-4 bg-surface-1 border border-white/[0.08] rounded-[10px] text-white no-underline">
      <div className="flex items-center gap-2.5">
        <PlaceRing placement={placement} size="sm" />
        <span className={`hidden md:inline text-xs font-bold uppercase tracking-[0.14em] ${tone.text}`}>{placement}. Platz</span>
      </div>
      <div className="font-bold text-[15px] md:text-base leading-tight break-words [overflow-wrap:anywhere]">{displayTitle(item)}</div>
      <div className="text-xs md:text-[13px] text-zinc-400 break-words">{[gameTitle(item), yearOf(item)].filter(Boolean).join(" · ")}</div>
    </Link>
  );
}
