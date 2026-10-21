import { CountUp } from "@/components/tls/motion/CountUp";
import { formatCount } from "@/lib/countUp";
import { MedalMark, medalTone } from "@/components/tls/references/overviewParts";

// Kopf der Referenzen-Übersicht (#1878): Überschrift mit Einleitung und Sprungmarken, rechts die Ehrentafel - Siege,
// Zweite und Dritte als große Zahlen mit Medaillen-Ring, darunter Teilnahmen, Spiele, laufende Saisons, Aufstiege und
// „seit <Jahr>“. Am Handy steht die Tafel unter der Einleitung, die Sprungmarken lassen sich wischen.

const MEDALS = [[1, "gold", "Siege"], [2, "silver", "Zweite"], [3, "bronze", "Dritte"]];

export function HonorHeader({ stats, links }) {
  return (
    <section className="border-b border-white/[0.08] bg-grid-dense" data-testid="references-hero">
      <div className="tls-ref-hero max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-9 pb-7 md:pt-20 md:pb-16">
        <div className="tls-ref-hero__intro tls-ref-rise flex flex-col gap-4 md:gap-[22px] min-w-0" style={{ "--tls-ref-i": 0 }}>
          <div className="text-[11px] md:text-xs font-bold uppercase tracking-[0.28em] text-honor">Verein · Erfolgswand</div>
          <h1 className="m-0 font-heading font-extrabold uppercase leading-[0.95] tracking-[-0.01em] text-[38px] md:text-[clamp(44px,6vw,64px)] lg:text-[clamp(44px,5.2vw,76px)] break-words [text-wrap:balance]">Erfolge &amp; Referenzen</h1>
          <p className="m-0 max-w-[52ch] text-muted-text text-base md:text-lg">
            Wo THE LION SQUAD im Namen des Vereins angetreten ist – in Turnieren, Rennligen und Team-Ligen. Mit allem, was dabei herausgekommen ist.
          </p>
        </div>
        <HonorBoard stats={stats} />
        {links.length > 0 && (
          // Die Hülle steigt auf (tls-ref-rise), die Leiste darin wischt (tls-swipe) - zwei Animationen, zwei Elemente.
          <div className="tls-ref-hero__nav tls-ref-rise min-w-0" style={{ "--tls-ref-i": 1 }}>
            <nav aria-label="Auf dieser Seite" className="tls-ref-scroll flex gap-2 tls-swipe -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap sm:overflow-visible" data-testid="references-jump">
              {links.map((link) => (
                <a key={link.href} href={link.href} className="shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-full border border-white/[0.14] text-zinc-200 text-sm font-semibold no-underline hover:border-brand/60 hover:text-white transition-colors duration-fast">
                  {link.pulse && <span className="tls-run-pulse" aria-hidden="true" />}
                  {link.label}
                </a>
              ))}
            </nav>
          </div>
        )}
      </div>
    </section>
  );
}

function HonorBoard({ stats }) {
  const extras = [
    [stats.total, stats.total === 1 ? "Teilnahme" : "Teilnahmen", "references-stat-total", true],
    [stats.games, stats.games === 1 ? "Spiel" : "Spiele", "references-stat-games", true],
    [stats.running, stats.running === 1 ? "laufende Saison" : "laufende Saisons", "references-stat-running", stats.running > 0],
    [stats.promotions, stats.promotions === 1 ? "Aufstieg" : "Aufstiege", "references-stat-promotions", stats.promotions > 0],
  ].filter(([, , , show]) => show);
  return (
    <div className="tls-ref-hero__board tls-ref-rise min-w-0 bg-surface-1 border border-white/[0.09] rounded-[10px] px-1 pt-3.5 pb-3.5 md:px-6 md:pt-6 md:pb-5 flex flex-col gap-3 md:gap-[18px]" style={{ "--tls-ref-i": 1 }} data-testid="references-honor">
      <div className="hidden md:flex justify-between items-baseline gap-3">
        <div className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-400">Ehrentafel</div>
        {stats.since && <div className="text-[13px] text-quiet" data-testid="references-since">seit {stats.since}</div>}
      </div>
      <div className="grid grid-cols-3" data-testid="references-numbers">
        {MEDALS.map(([placement, key, label], index) => <MedalNumber key={key} placement={placement} value={stats[key]} label={label} first={index === 0} last={index === 2} testId={`references-stat-${key}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 md:gap-x-[22px] gap-y-1.5 px-3 md:px-0 pt-3 md:pt-3.5 border-t border-white/[0.08] text-sm text-zinc-400">
        {extras.map(([value, label, testId]) => (
          <span key={testId} data-testid={testId}><b className="font-display font-bold text-[17px] md:text-lg text-white tabular-nums"><CountUp value={value} format={formatCount} /></b> {label}</span>
        ))}
        {stats.since && <span className="md:hidden">seit {stats.since}</span>}
      </div>
    </div>
  );
}

function MedalNumber({ placement, value, label, first, last, testId }) {
  const tone = medalTone(placement);
  return (
    <div data-testid={testId} className={`flex flex-col items-center md:items-start gap-0.5 md:gap-1.5 min-w-0 ${first ? "md:pr-4" : last ? "md:pl-4 border-l border-white/[0.08]" : "md:px-4 border-l border-white/[0.08]"}`}>
      <MedalMark placement={placement} className="hidden md:block w-[34px] h-[34px]" />
      <div className={`font-display font-bold leading-[0.9] tabular-nums text-[44px] md:text-[64px] ${tone.text}`}><CountUp value={Number(value) || 0} /></div>
      <div className="text-[11px] md:text-xs font-bold uppercase tracking-[0.16em] md:tracking-[0.18em] text-zinc-300">{label}</div>
    </div>
  );
}
