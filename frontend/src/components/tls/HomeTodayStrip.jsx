import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { CountryFlag } from "@/components/tls/CountryFlag";
import { todayFacts, todayItems } from "@/lib/homeToday";
import { seriesAddress } from "@/lib/referenceSeries";
import { GameMark } from "@/components/tls/references/referenceParts";
import { SessionChips } from "@/components/tls/series/SessionChips";

// „Heute im Einsatz“ (#1753): an Renn- und Spieltagen ein schmaler Streifen über dem Kopf der Startseite - je Saison
// mit heutigem Termin eine Karte (Serie, Saison, Runde, Uhrzeit, gemeldete Vereinsleute), die zur Serienseite mit der
// Tabelle führt. Gestaltet wie die Karten „Läuft gerade“ der Referenzen-Übersicht: goldener Chip „Heute“ mit dezentem
// Puls, Karten blenden gestaffelt ein. Mit „Bewegung reduzieren“ stehen Puls und Einblenden still (index.css,
// .tls-run-*). Steht heute nichts an oder scheitert der Abruf, gibt es den Streifen nicht - die Seite bleibt wie sie ist.
// Rennwochenende (#1930): statt „Rennen R3“ der heutige Lauf („R3 · Qualifying“), darunter die Lauf-Chips der Runde.

export function HomeTodayStrip() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get("/reference-series/public/running")
      .then(({ data }) => { if (alive) setItems(todayItems(data)); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  if (!items.length) return null;
  return (
    <section aria-labelledby="home-today-title" className="border-b border-white/10 bg-honor/[0.04]" data-testid="home-today">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-5 flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
        <h2 id="home-today-title" className="shrink-0 flex items-center gap-2.5 text-xs font-bold uppercase tracking-[0.16em] text-quiet">
          <span className="inline-flex items-center gap-[7px] px-2.5 py-1 rounded-full bg-honor/[0.12] border border-honor/45 text-honor tracking-[0.12em]">
            <span className="tls-run-pulse" aria-hidden="true" />
            Heute
          </span>
          {" "}
          <span>im Einsatz</span>
        </h2>
        <ul className="flex-1 min-w-0 grid gap-2 md:gap-3 md:grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))]">
          {items.map((item, index) => <TodayCard key={`${item.lineage.slug}/${item.series.season_slug}`} item={item} index={index} />)}
        </ul>
      </div>
    </section>
  );
}

function TodayCard({ item, index }) {
  const { lineage, series } = item;
  const season = [series.title, series.season, series.tier].filter(Boolean).join(" · ");
  const facts = todayFacts(item);
  const parts = [season, ...facts].filter(Boolean);
  // Die Runde ist die erste Angabe nach der Saison, wenn der nächste Termin ein Kürzel oder einen Titel hat.
  const roundAt = item.next?.code || item.next?.title ? parts.indexOf(facts[0]) : -1;
  return (
    <li className="min-w-0">
      <Link
        to={seriesAddress(lineage, series)}
        style={{ "--tls-run-i": Math.min(index, 8) }}
        className="tls-run-card flex min-h-11 items-center gap-3 p-3 md:p-3.5 bg-surface-1 border border-honor/40 rounded-[10px] text-white no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#29B6E8]"
        data-testid={`home-today-item-${lineage.slug}-${series.season_slug}`}
      >
        <GameMark game={item.game || (lineage.game_name ? { name: lineage.game_name } : null)} code className="w-10 h-10 !rounded-lg !bg-surface-3 border border-white/10" codeClass="font-display text-[15px] !text-brand" iconClass="w-5 h-5" padded />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] leading-snug text-zinc-200 break-words [overflow-wrap:anywhere]" data-testid="home-today-title">{lineage.title}</div>
          <div className="mt-0.5 text-[13px] text-zinc-400 break-words [overflow-wrap:anywhere]" data-testid="home-today-facts">
            {/* Flagge des heutigen Rennens (#1925) vor der Runde. */}
            {parts.map((part, position) => (
              <Fragment key={position}>
                {position > 0 && " · "}
                {position === roundAt && <CountryFlag code={item.next?.country_code} size="sm" className="mr-1" />}
                {part}
              </Fragment>
            ))}
          </div>
          {item.next?.sessions?.length > 1 && <SessionChips rounds={item.next.sessions.map((entry, position) => ({ ...entry, id: `${position}` }))} showTime className="mt-1.5" testId="home-today-sessions" />}
        </div>
        <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.14em] text-brand">
          <span className="hidden sm:inline">Tabelle</span>
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </span>
      </Link>
    </li>
  );
}
