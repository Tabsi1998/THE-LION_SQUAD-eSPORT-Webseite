import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Search, X } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { HILFE_BESCHREIBUNG, THEMEN, hilfePfad, hilfeSchritte, sucheHilfe } from "@/hilfe";

// Hilfe-Übersicht (#2295): öffentlich ohne Konto, Suche über alle Schritte, darunter die Themen. Die Anfrage steht als
// ?q= in der Adresse, damit sich auch eine Suche als Link verschicken lässt.

export default function HelpIndexPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const results = useMemo(() => sucheHilfe(query), [query]);
  useDocumentTitle("Hilfe", HILFE_BESCHREIBUNG);

  const setQuery = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set("q", value);
    else next.delete("q");
    setParams(next, { replace: true });
  };
  const searching = query.trim().length > 1;

  return (
    <PublicLayout>
      <article className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12" data-testid="help-index">
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "Hilfe" }]} />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Hilfe</p>
        <h1 className="font-heading text-4xl md:text-5xl font-black uppercase mt-2">So geht&apos;s</h1>
        <p className="mt-3 text-white/70 max-w-2xl">Kurze Anleitungen mit Bildern. Jeder Schritt hat einen eigenen Link, den du weiterschicken kannst.</p>

        <div className="relative mt-8" role="search">
          <label htmlFor="help-search" className="sr-only">Hilfe durchsuchen</label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/45" aria-hidden="true" />
          <input id="help-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} data-testid="help-search"
            placeholder="Suchen, z. B. Check-in"
            className="w-full min-h-[48px] rounded-sm border border-white/15 bg-[#0F0F10] pl-10 pr-11 text-base text-white placeholder:text-white/40 focus:border-[#29B6E8] focus:outline-none" />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Suche leeren" data-testid="help-search-clear"
              className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center text-white/55 hover:text-white">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {searching ? (
          <section className="mt-6" aria-live="polite" data-testid="help-results">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">
              {results.length ? `${results.length} Treffer` : "Nichts gefunden"}
            </h2>
            {results.length ? (
              <ul className="mt-3 divide-y divide-white/10 border-y border-white/10">
                {results.map(({ thema, schritt }) => (
                  <li key={`${thema.slug}-${schritt.id}`}>
                    <Link to={hilfePfad(thema.slug, schritt.id)} data-testid={`help-result-${thema.slug}-${schritt.id}`}
                      className="flex items-start gap-3 py-3 min-h-[56px] hover:bg-white/[0.03] -mx-2 px-2 rounded-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-white [overflow-wrap:anywhere]">{schritt.titel}</span>
                        <span className="block text-sm text-white/55">{thema.titel} · {schritt.text}</span>
                      </span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-white/65" data-testid="help-no-results">Probier ein anderes Wort oder wähl unten ein Thema.</p>
            )}
          </section>
        ) : null}

        <h2 className="mt-10 text-xs font-bold uppercase tracking-widest text-white/50">Themen</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="help-topics">
          {THEMEN.map((thema) => (
            <li key={thema.slug}>
              <Link to={hilfePfad(thema.slug)} data-testid={`help-topic-${thema.slug}`}
                className="group flex h-full flex-col rounded-sm border border-white/10 bg-[#0F0F10] p-4 transition hover:border-[#29B6E8]/50">
                <span className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">{thema.zielgruppe}</span>
                <span className="mt-1 font-heading text-xl font-bold uppercase text-white">{thema.titel}</span>
                <span className="mt-2 flex-1 text-sm text-white/70">{thema.kurz}</span>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#29B6E8]">
                  {hilfeSchritte(thema).length} Schritte <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-sm text-white/55">
          Nicht gefunden, was du suchst? <Link to="/contact" className="text-[#29B6E8] hover:underline">Schreib uns</Link>.
        </p>
      </article>
    </PublicLayout>
  );
}
