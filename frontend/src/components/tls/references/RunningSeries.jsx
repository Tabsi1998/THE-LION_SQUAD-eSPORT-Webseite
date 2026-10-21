import { Link } from "react-router-dom";
import { seriesAddress } from "@/lib/referenceSeries";
import { KIND_LABELS, nextTitle, nextValue, placeTitle, progressText } from "@/lib/referencesOverview";
import { GameMark } from "@/components/tls/references/referenceParts";
import { SectionHead } from "@/components/tls/references/overviewParts";
import { CountryFlag } from "@/components/tls/CountryFlag";
import { SessionChips } from "@/components/tls/series/SessionChips";

// „Läuft gerade“ (#1748, neu gestaltet #1878): laufende Serien-Saisons mit Spur, Art, Saison/Stufe, Fortschritt in
// Segmenten, nächstem Termin und unserem Platz als große Zahl. Was heute ansteht, kommt zuerst (Server) und trägt den
// goldenen Chip „Heute“ mit dezentem Puls. Am Handy wischt man waagrecht von Karte zu Karte. Die Daten lädt die Seite
// (schlanker Endpunkt, nur sichtbare aktive Saisons, keine Namen); ohne laufende Saison erscheint der Bereich nicht.
// Rennwochenende (#1930): der nächste Termin nennt seinen Lauf, darunter die Lauf-Chips der Runde mit Uhrzeit.

// Bis zu so vielen Terminen zeigt der Balken Segmente, darüber einen durchgehenden Balken.
const MAX_SEGMENTS = 30;

export function seasonLabel(item) {
  const { series } = item;
  return [series?.title, series?.season, series?.tier].filter(Boolean).join(" · ");
}

export function RunningSeries({ items, index = 2 }) {
  if (!items?.length) return null;
  const today = items.some((item) => item.today);
  const count = `${items.length} ${items.length === 1 ? "laufende Saison" : "laufende Saisons"}`;
  return (
    <section id="einsatz" aria-labelledby="references-running-title" className="tls-ref-anchor tls-ref-rise max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 md:pt-[72px]" style={{ "--tls-ref-i": index }} data-testid="references-running">
      <SectionHead id="references-running-title" eyebrow="Gerade im Einsatz" tone={today ? "honor" : "brand"} pulse={today} title="Läuft gerade" hint={`${count} · Stand nach dem letzten gewerteten Termin`} />
      <div className="tls-ref-scroll tls-ref-snap -mx-4 px-4 pb-1 flex gap-3 overflow-x-auto sm:-mx-6 sm:px-6 md:mx-0 md:px-0 md:pb-0 md:overflow-visible md:grid md:gap-5 md:grid-cols-[repeat(auto-fit,minmax(min(100%,330px),1fr))]" data-testid="references-running-list">
        {items.map((item) => <RunningCard key={`${item.lineage.slug}/${item.series.season_slug}`} item={item} />)}
      </div>
      {items.length > 1 && <div className="md:hidden mt-2.5 text-[13px] text-quiet">Wischen für weitere Saisons →</div>}
    </section>
  );
}

function RunningCard({ item }) {
  const { lineage, series, progress, next, club } = item;
  const kind = lineage.kind;
  const total = progress?.total || 0;
  const scored = Math.min(progress?.scored || 0, total);
  return (
    <Link
      to={seriesAddress(lineage, series)}
      data-testid={`running-card-${lineage.slug}-${series.season_slug}`}
      data-today={item.today ? "true" : undefined}
      className={`tls-ref-lift shrink-0 w-[min(300px,calc(100vw-3rem))] md:w-auto min-w-0 flex flex-col gap-3.5 md:gap-[18px] p-[18px] md:p-[22px] bg-surface-1 border rounded-[10px] text-white no-underline ${item.today ? "border-honor/40" : "border-white/[0.08]"}`}
    >
      <div className="flex items-start gap-3 md:gap-3.5">
        <GameMark game={item.game || (lineage.game_name ? { name: lineage.game_name } : null)} code className="w-10 h-10 md:w-11 md:h-11 !rounded-lg !bg-surface-3 border border-white/10" codeClass="font-display text-[15px] md:text-base !text-brand" iconClass="w-5 h-5" padded />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="text-[11px] md:text-xs font-bold uppercase tracking-[0.14em] md:tracking-[0.16em] text-quiet">{KIND_LABELS[kind] || "Serie"}</div>
          <div className="font-semibold text-[15px] md:text-base text-zinc-200 break-words [overflow-wrap:anywhere]" data-testid="running-title">{lineage.title}</div>
        </div>
        {item.today && (
          <span className="shrink-0 inline-flex items-center gap-1.5 md:gap-[7px] px-2 md:px-2.5 py-1 rounded-full bg-honor/[0.12] border border-honor/45 text-honor text-[11px] md:text-xs font-bold uppercase tracking-[0.1em] md:tracking-[0.12em]" data-testid="running-today-badge">
            <span className="tls-run-pulse" aria-hidden="true" /> Heute
          </span>
        )}
      </div>
      <div className="font-heading font-extrabold uppercase leading-[1.15] text-[19px] md:text-[22px] break-words [overflow-wrap:anywhere]" data-testid="running-season">{seasonLabel(item)}</div>
      {total > 0 && (
        <div className="flex flex-col gap-1.5 md:gap-2">
          <Segments scored={scored} total={total} />
          <div className="text-[13px] md:text-sm text-zinc-400" data-testid="running-progress-text">{progressText(kind, scored, total)}</div>
        </div>
      )}
      <div className="mt-auto grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 md:gap-4 pt-3 md:pt-4 border-t border-white/[0.08]">
        <div className="min-w-0 flex flex-col gap-1">
          <div className="text-[11px] md:text-xs font-bold uppercase tracking-[0.14em] md:tracking-[0.16em] text-quiet">{nextTitle(kind, next)}</div>
          <div className="font-semibold text-sm md:text-base text-white break-words [overflow-wrap:anywhere]" data-testid="running-next">
            <CountryFlag code={next?.country_code} size="sm" className="mr-1.5" />
            {nextValue(next)}
          </div>
          {next?.sessions?.length > 1 && <SessionChips rounds={next.sessions.map((entry, position) => ({ ...entry, id: `${position}` }))} showTime className="mt-1.5" testId="running-sessions" />}
        </div>
        <div className="min-w-0 flex flex-col items-end gap-0.5 text-right" data-testid="running-place">
          <div className="text-[11px] md:text-xs font-bold uppercase tracking-[0.14em] md:tracking-[0.16em] text-quiet">{placeTitle(kind)}</div>
          {club ? (
            <div className="flex items-baseline gap-1.5">
              <span className="font-display font-bold leading-[0.9] tabular-nums text-[34px] md:text-[40px] text-brand">{club.rank}.</span>
              {club.of ? <span className="text-[13px] md:text-sm text-zinc-400">von {club.of}</span> : null}
            </div>
          ) : (
            <div className="text-sm text-zinc-400 pt-1">Noch offen</div>
          )}
        </div>
      </div>
    </Link>
  );
}

function Segments({ scored, total }) {
  const bar = { role: "progressbar", "aria-label": "Fortschritt der Saison", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": scored };
  if (total > MAX_SEGMENTS) {
    return (
      <div {...bar} className="h-1.5 rounded-sm bg-white/[0.12] overflow-hidden">
        <div className="tls-ref-fill h-full bg-brand" style={{ width: `${Math.round((scored / total) * 100)}%` }} />
      </div>
    );
  }
  return (
    <div {...bar} className="flex gap-[3px] md:gap-1">
      {Array.from({ length: total }, (_, index) => (
        <span key={index} className="flex-1 h-1.5 rounded-sm bg-white/[0.12] overflow-hidden">
          {index < scored && <span className="tls-ref-fill block h-full bg-brand" style={{ "--tls-ref-seg": index }} />}
        </span>
      ))}
    </div>
  );
}
