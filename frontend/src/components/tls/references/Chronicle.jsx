import { forwardRef, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { chronicleCount, filterChronicle, formatLabel, gameOptions, medalCounts, medalLine, startersOf, timelineGroups } from "@/lib/referencesOverview";
import { bestPlacement, displayTitle, formatDate, gameTitle, memberEntryOf, referenceInstant, shortTitle } from "@/components/tls/references/referenceParts";
import { Chevron, Mark, PlaceRing, SectionHead } from "@/components/tls/references/overviewParts";
import { viennaDate } from "@/lib/vienna";

// Chronik (#1878, ersetzt „Jahr für Jahr“): alle Teilnahmen als Liste je Jahr mit Medaillen-Zusammenfassung. Jede Zeile
// zeigt Platz-Ring, Titel (kurz wie im Mitgliederprofil, #1944) und Veranstalter, Spiel- und Format-Marke, unsere Starter (jeder Name nur einmal) und das
// Datum und führt zur Detailseite. Filter: Spiel-Chips und „Nur Podest“, dazu die Person aus dem Profil (#859); die
// Anzahl steht als „x von y Teilnahmen“. Am Handy werden die Zeilen kompakt, die Filter lassen sich wischen.

const chipBase = "shrink-0 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-full border text-sm font-semibold whitespace-nowrap transition-colors duration-fast";
const chipIdle = "border-white/[0.14] bg-transparent text-zinc-300 hover:border-white/40 hover:text-white";

export const Chronicle = forwardRef(function Chronicle({ items, linked, memberId = "", memberLabel = "", onClearMember, index = 5 }, ref) {
  const [game, setGame] = useState("all");
  const [podiumOnly, setPodiumOnly] = useState(false);
  const games = useMemo(() => gameOptions(items), [items]);
  const shown = filterChronicle(items, { game, podiumOnly, memberId });
  const groups = timelineGroups(shown);
  return (
    <section ref={ref} id="chronik" aria-labelledby="references-timeline-title" className="tls-ref-anchor tls-ref-rise max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-[88px]" style={{ "--tls-ref-i": index }} data-testid="references-timeline">
      <SectionHead id="references-timeline-title" eyebrow="Alle Teilnahmen" title="Chronik" hint={items.length ? <span data-testid="references-count">{chronicleCount(shown.length, items.length)}</span> : null} />
      {items.length > 0 && (
        <div className="tls-ref-scroll -mx-4 px-4 sm:mx-0 sm:px-0 flex sm:flex-wrap items-center gap-2 overflow-x-auto sm:overflow-visible pt-1 pb-4 md:pt-3 md:pb-[18px] border-b border-white/[0.08]" role="group" aria-label="Filter der Chronik" data-testid="references-filters">
          {memberId && (
            <button type="button" onClick={onClearMember} data-testid="references-member" className={`${chipBase} border-brand bg-brand/[0.14] text-white`} aria-label={`Filter „Nur ${memberLabel}“ entfernen`}>
              Nur {memberLabel} <span aria-hidden="true">×</span>
            </button>
          )}
          {games.length > 1 && (
            <>
              <button type="button" aria-pressed={game === "all"} onClick={() => setGame("all")} data-testid="references-game-all" className={`${chipBase} ${game === "all" ? "border-brand bg-brand/[0.14] text-white" : chipIdle}`}>Alle</button>
              {games.map((option) => (
                <button key={option.key} type="button" aria-pressed={game === option.key} onClick={() => setGame(option.key)} data-testid={`references-game-${option.key}`} className={`${chipBase} ${game === option.key ? "border-brand bg-brand/[0.14] text-white" : chipIdle}`}>
                  {option.title}
                </button>
              ))}
            </>
          )}
          <span className="hidden sm:block flex-1" aria-hidden="true" />
          <button type="button" aria-pressed={podiumOnly} onClick={() => setPodiumOnly((value) => !value)} data-testid="references-podium" className={`${chipBase} order-first sm:order-none ${podiumOnly ? "border-honor/60 bg-honor/[0.12] text-honor" : chipIdle}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M5 2h6v4a3 3 0 0 1-6 0z M8 9v3 M5.5 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Nur Podest
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="mt-8 border border-dashed border-white/15 rounded-[10px] p-10 md:p-12 text-center text-zinc-400">
          <div className="font-heading font-bold text-lg text-white">Referenzen werden bald ergänzt.</div>
          <div className="text-sm mt-2">Sobald externe Turniere gepflegt sind, erscheinen sie hier.</div>
        </div>
      ) : shown.length === 0 ? (
        <div className="py-10 md:py-12 text-center text-zinc-400" data-testid="references-empty-filter">Keine Teilnahmen für diese Auswahl.</div>
      ) : (
        groups.map((group) => <YearGroup key={group.key || "none"} group={group} linked={linked} memberId={memberId} />)
      )}
    </section>
  );
});

function YearGroup({ group, linked, memberId }) {
  const count = `${group.items.length} ${group.items.length === 1 ? "Teilnahme" : "Teilnahmen"}`;
  const medals = medalLine(medalCounts(group.items, memberId));
  return (
    <div className="pt-6 md:pt-9" data-testid={`references-timeline-${group.key || "none"}`}>
      <div className="flex items-baseline justify-between gap-2.5 md:gap-4 pb-2 md:pb-3 border-b border-white/10">
        <div className="flex items-baseline gap-3.5 min-w-0">
          <span className="font-display font-bold leading-none tabular-nums text-[34px] md:text-[44px] text-white">{group.label}</span>
          <span className="hidden md:inline text-sm text-quiet">{count}</span>
        </div>
        <span className="text-[13px] md:text-sm text-zinc-400 text-right" data-testid="references-year-medals">{medals || <span className="md:hidden">{count}</span>}</span>
      </div>
      <ul className="list-none m-0 p-0">
        {group.items.map((item) => <ChronicleRow key={item.id} item={item} link={linked?.get(item.id)} memberId={memberId} />)}
      </ul>
    </div>
  );
}

function ChronicleRow({ item, link, memberId }) {
  const own = memberId ? memberEntryOf(item, memberId) : null;
  const placement = memberId ? (Number(own?.placement) || null) : bestPlacement(item);
  const starters = startersOf(item, memberId).join(", ");
  const game = gameTitle(item);
  const format = formatLabel(item, link);
  const instant = referenceInstant(item);
  const shortDate = instant ? viennaDate(instant, { day: "2-digit", month: "2-digit" }) : "";
  // Kurzer Titel wie im Mitgliederprofil (#1944), der lange im Tooltip; steht der Veranstalter schon darin, nicht doppelt.
  const title = shortTitle(item, link);
  const full = displayTitle(item);
  const composed = title !== full;
  return (
    <li className="border-b border-white/[0.07]">
      <Link to={`/references/${item.id}`} data-testid={`reference-card-${item.id}`} className="tls-ref-row flex items-start sm:items-center sm:flex-wrap gap-3 sm:gap-x-5 sm:gap-y-2.5 py-3.5 sm:py-4 sm:px-2 text-white no-underline">
        <PlaceRing placement={placement} />
        <span className="flex-1 sm:flex-[1_1_280px] min-w-0 flex flex-col gap-1 sm:gap-0.5">
          <span className="font-bold text-base sm:text-[17px] leading-[1.3] break-words [overflow-wrap:anywhere]" title={composed ? full : undefined} data-testid="reference-row-title">{title}</span>
          {item.organizer && !composed && <span className="hidden sm:block text-sm text-zinc-400 break-words" data-testid="reference-row-organizer">{item.organizer}</span>}
          <span className="sm:hidden text-[13px] text-zinc-400 break-words">{[game, format, shortDate].filter(Boolean).join(" · ")}</span>
          {starters && <span className="sm:hidden text-[13px] text-zinc-300 break-words [overflow-wrap:anywhere]" data-testid="reference-row-starters-phone">{starters}</span>}
        </span>
        <span className="hidden sm:flex sm:flex-[1_1_220px] min-w-0 flex-wrap gap-1.5">
          <Mark>{game}</Mark>
          <Mark>{format}</Mark>
        </span>
        <span className="hidden sm:block sm:flex-[1_1_180px] min-w-0 text-sm text-zinc-300 break-words [overflow-wrap:anywhere]" data-testid="reference-row-starters">{starters}</span>
        <span className="hidden sm:block sm:flex-[0_0_110px] text-sm text-quiet tabular-nums">{formatDate(item.start_date) || formatDate(item.end_date)}</span>
        <Chevron className="mt-[11px] sm:mt-0" />
      </Link>
    </li>
  );
}
