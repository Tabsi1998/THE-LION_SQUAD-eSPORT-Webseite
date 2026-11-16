import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, Bell, CalendarDays, ChevronDown, ClipboardList, Gift, HandHelping, ListOrdered, MapPin, Search,
  ShieldCheck, Trophy, User, Users, X,
} from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  FRAGEN, HILFE_BESCHREIBUNG, faqBereich, faqBereichsliste, haeufigeFragen, hilfePfad, hilfeSchritte, sichtbareRollen, sucheFaq,
} from "@/hilfe";
import { ankerAus } from "@/hilfe/pfade";
import { useFaqZugang } from "@/hilfe/useFaqZugang";

// FAQ (#2448, Fabian 16.11.): oben die Suche über Fragen und Schritte (?q=), darunter „Häufige Fragen“ zum Aufklappen,
// dann die kompakte Liste aller Bereiche mit Rollen-Filter (?rolle=). Mitglieder- und Leitungs-Fragen kommen erst nach
// der Prüfung am Server dazu (useFaqZugang). Eine Frage hat den Anker #frage-<id>, ein Bereich #bereich-<id>.

const ICONS = {
  user: User, bell: Bell, badge: BadgeCheck, calendar: CalendarDays, trophy: Trophy, list: ListOrdered, users: Users,
  "map-pin": MapPin, gift: Gift, hand: HandHelping, clipboard: ClipboardList, shield: ShieldCheck,
};

function mehrzahl(anzahl, eins, viele) {
  return `${anzahl} ${anzahl === 1 ? eins : viele}`;
}

// Zu heißt zu - auch wenn ein später geladenes Stylesheet [hidden] überstimmt (#2448, Review F1).
function zuStil(offen) {
  return offen ? undefined : { display: "none" };
}

function toggleIn(set, id, auf) {
  const next = new Set(set);
  if (auf ?? !next.has(id)) next.add(id);
  else next.delete(id);
  return next;
}

/** Eine Frage zum Aufklappen (Disclosure): Knopf mit aria-expanded, darunter die kurze Antwort samt Link. */
function FrageEintrag({ frage, offen, onToggle, anker = true, bereich = "", ebene = 3 }) {
  const Kopf = ebene === 4 ? "h4" : "h3";
  const suffix = anker ? "" : "-bereich";
  const panelId = `faq-antwort-${frage.id}${suffix}`;
  return (
    <li id={anker ? `frage-${frage.id}` : undefined} className="scroll-mt-24 border-b border-white/10 last:border-b-0" data-testid={`faq-frage-${frage.id}${suffix}`}>
      <Kopf className="m-0">
        <button type="button" aria-expanded={offen} aria-controls={panelId} onClick={onToggle} data-testid={`faq-frage-knopf-${frage.id}${suffix}`}
          className="group flex w-full min-h-[52px] items-center justify-between gap-3 py-3 text-left text-base font-semibold text-white hover:text-[#29B6E8] focus-visible:text-[#29B6E8]">
          <span className="min-w-0 [overflow-wrap:anywhere]">{frage.frage}</span>
          <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 text-white/45 transition-transform duration-200 motion-reduce:transition-none group-hover:text-[#29B6E8] ${offen ? "rotate-180" : ""}`} />
        </button>
      </Kopf>
      <div id={panelId} hidden={!offen} style={zuStil(offen)} className="tls-reveal pb-4 pr-8" data-testid={panelId}>
        <p className="text-base leading-relaxed text-white/80">{frage.antwort}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-4">
          {frage.link ? (
            <Link to={frage.link.to} className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-[#29B6E8] hover:underline">
              {frage.link.label} <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
          {bereich ? <span className="text-xs uppercase tracking-widest text-white/40">{bereich}</span> : null}
        </div>
      </div>
    </li>
  );
}

function Treffer({ treffer }) {
  const bereich = faqBereich(treffer.bereich)?.titel;
  const art = treffer.art === "frage" ? "Frage" : `Schritt ${treffer.reihe} · ${treffer.thema.titel}`;
  return (
    <li>
      <Link to={treffer.to} data-testid={`faq-treffer-${treffer.art}-${treffer.id}`}
        className="-mx-2 flex min-h-[56px] items-start gap-3 rounded-sm px-2 py-3 hover:bg-white/[0.03]">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {bereich ? (
              <span className="rounded-sm border border-[#29B6E8]/30 bg-[#29B6E8]/[0.08] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]" data-testid="faq-treffer-bereich">{bereich}</span>
            ) : null}
            <span className="text-[11px] uppercase tracking-widest text-white/45">{art}</span>
          </span>
          <span className="mt-1 block font-semibold text-white [overflow-wrap:anywhere]">{treffer.titel}</span>
          <span className="block text-sm text-white/55 line-clamp-2">{treffer.text}</span>
        </span>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
      </Link>
    </li>
  );
}

function BereichZeile({ bereich, inhalt, offen, onToggle, offeneFragen, onFrage }) {
  const Icon = ICONS[bereich.icon] || ListOrdered;
  const panelId = `faq-bereich-inhalt-${bereich.id}`;
  const kopf = (
    <>
      <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm ${inhalt.leer ? "bg-white/[0.04] text-white/35" : "bg-[#29B6E8]/10 text-[#29B6E8]"}`} aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block font-heading text-base font-bold uppercase leading-tight [overflow-wrap:break-word] sm:text-lg ${inhalt.leer ? "text-white/55" : "text-white"}`}>{bereich.titel}</span>
        <span className="block text-sm text-white/55">{bereich.kurz}</span>
      </span>
    </>
  );
  if (inhalt.leer) {
    return (
      <li id={`bereich-${bereich.id}`} className="scroll-mt-24" data-testid={`faq-bereich-${bereich.id}`} data-leer="true">
        <div className="flex min-h-[64px] items-center gap-3 px-3 py-3">
          {kopf}
          <span className="shrink-0 rounded-sm border border-white/15 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white/45" data-testid={`faq-bereich-bald-${bereich.id}`}>Kommt bald</span>
        </div>
      </li>
    );
  }
  const zaehler = [
    inhalt.anleitungen.length ? mehrzahl(inhalt.anleitungen.length, "Anleitung", "Anleitungen") : "",
    inhalt.fragen.length ? mehrzahl(inhalt.fragen.length, "Frage", "Fragen") : "",
  ].filter(Boolean).join(" · ");
  return (
    <li id={`bereich-${bereich.id}`} className="scroll-mt-24" data-testid={`faq-bereich-${bereich.id}`}>
      <h3 className="m-0">
        <button type="button" aria-expanded={offen} aria-controls={panelId} onClick={onToggle} data-testid={`faq-bereich-knopf-${bereich.id}`}
          className="group flex w-full min-h-[64px] items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.03]">
          {kopf}
          <span className="hidden shrink-0 text-xs text-white/45 sm:block">{zaehler}</span>
          <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 text-white/45 transition-transform duration-200 motion-reduce:transition-none group-hover:text-[#29B6E8] ${offen ? "rotate-180" : ""}`} />
        </button>
      </h3>
      <div id={panelId} hidden={!offen} style={zuStil(offen)} className="tls-reveal px-3 pb-4 sm:pl-16" data-testid={`faq-bereich-inhalt-${bereich.id}`}>
        <p className="text-xs text-white/45 sm:hidden">{zaehler}</p>
        {inhalt.anleitungen.length ? (
          <ul className="mt-2 space-y-1">
            {inhalt.anleitungen.map(({ thema, abschnitt }) => {
              const schritte = abschnitt ? abschnitt.schritte.length : hilfeSchritte(thema).length;
              const to = abschnitt ? `${hilfePfad(thema.slug)}#${abschnitt.id}` : hilfePfad(thema.slug);
              return (
                <li key={`${thema.slug}-${abschnitt?.id || ""}`}>
                  <Link to={to} data-testid={`faq-anleitung-${bereich.id}-${thema.slug}${abschnitt ? `-${abschnitt.id}` : ""}`}
                    className="flex min-h-[48px] items-center gap-3 rounded-sm border border-white/10 bg-[#0F0F10] px-3 py-2 hover:border-[#29B6E8]/50">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">Anleitung · {thema.zielgruppe}</span>
                      <span className="block font-semibold text-white [overflow-wrap:anywhere]">{abschnitt ? `${thema.titel}: ${abschnitt.titel}` : thema.titel}</span>
                    </span>
                    <span className="shrink-0 text-xs text-white/50">{mehrzahl(schritte, "Schritt", "Schritte")}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#29B6E8]" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        {inhalt.fragen.length ? (
          <ul className="mt-2">
            {inhalt.fragen.map((frage) => (
              <FrageEintrag key={frage.id} frage={frage} ebene={4} anker={!frage.haeufig} offen={offeneFragen.has(frage.id)} onToggle={() => onFrage(frage.id)} />
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export default function FaqPage() {
  const [params, setParams] = useSearchParams();
  const { hash, key: besuch } = useLocation();
  const zugang = useFaqZugang();
  const query = params.get("q") || "";
  const rollen = sichtbareRollen(zugang.darf);
  const rolleParam = params.get("rolle") || "";
  const rolle = rollen.some((row) => row.id === rolleParam) ? rolleParam : "";
  const fragen = useMemo(() => [...FRAGEN, ...zugang.fragen.filter((frage) => !FRAGEN.some((row) => row.id === frage.id))], [zugang.fragen]);
  const results = useMemo(() => sucheFaq(query, { fragen, darf: zugang.darf }), [query, fragen, zugang.darf]);
  const haeufig = useMemo(() => haeufigeFragen({ fragen, darf: zugang.darf }), [fragen, zugang.darf]);
  const bereiche = useMemo(() => faqBereichsliste({ fragen, rolle, darf: zugang.darf }), [fragen, rolle, zugang.darf]);
  const [offeneFragen, setOffeneFragen] = useState(() => new Set());
  const [offeneBereiche, setOffeneBereiche] = useState(() => new Set());
  const [ziel, setZiel] = useState("");
  useDocumentTitle("FAQ", HILFE_BESCHREIBUNG);

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const searching = query.trim().length > 1;

  // Ein Link auf eine Frage (#frage-<id>) oder einen Bereich (#bereich-<id>) klappt ihn auf und springt hin - einmal je
  // Aufruf der Adresse (location.key), nicht noch einmal nach der Antwort des Servers oder einer Invalidierung.
  // Geschützte Fragen stehen erst nach der Antwort da; bis dahin bleibt der Anker offen. Läuft eine Suche, sind die
  // Häufigen ausgeblendet - dann steht die Frage in ihrem Bereich.
  const erledigt = useRef("");
  useEffect(() => {
    const anker = ankerAus(hash);
    const schluessel = `${besuch}#${anker}`;
    if (!anker || erledigt.current === schluessel) return;
    if (anker.startsWith("frage-")) {
      const frage = fragen.find((row) => row.id === anker.slice(6));
      if (!frage) return;
      const imBereich = !frage.haeufig || searching;
      setOffeneFragen((set) => toggleIn(set, frage.id, true));
      if (imBereich) setOffeneBereiche((set) => toggleIn(set, frage.bereich, true));
      setZiel(imBereich ? `bereich-${frage.bereich}` : anker);
      erledigt.current = schluessel;
    } else if (anker.startsWith("bereich-")) {
      setOffeneBereiche((set) => toggleIn(set, anker.slice(8), true));
      setZiel(anker);
      erledigt.current = schluessel;
    }
  }, [hash, besuch, fragen, searching]);
  useEffect(() => {
    if (!ziel) return;
    const target = document.getElementById(ziel);
    if (target) {
      target.scrollIntoView({ block: "start" });
      setZiel("");
    }
  }, [ziel, bereiche]);

  return (
    <PublicLayout>
      <article className="mx-auto max-w-4xl px-4 py-10 sm:px-6 md:py-12 lg:px-8" data-testid="faq-page">
        <Breadcrumbs items={[{ label: "Start", to: "/" }, { label: "FAQ" }]} />
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">FAQ</p>
        <h1 className="mt-2 font-heading text-4xl font-black uppercase md:text-5xl">So geht&apos;s</h1>
        <p className="mt-3 max-w-2xl text-white/70">Kurze Antworten und Anleitungen mit Bildern. Jeder Schritt hat einen eigenen Link, den du weiterschicken kannst.</p>

        <div className="relative mt-8" role="search">
          <label htmlFor="faq-search" className="mb-2 block text-xs font-bold uppercase tracking-widest text-white/55">FAQ durchsuchen</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/45" aria-hidden="true" />
            <input id="faq-search" type="search" value={query} onChange={(event) => setParam("q", event.target.value)} data-testid="faq-search"
              placeholder="Frage oder Stichwort, z. B. Check-in"
              className="w-full min-h-[48px] rounded-sm border border-white/15 bg-[#0F0F10] pl-10 pr-12 text-base text-white placeholder:text-white/40 focus:border-[#29B6E8] focus:outline-none" />
            {query ? (
              <button type="button" onClick={() => setParam("q", "")} aria-label="Suche leeren" data-testid="faq-search-clear"
                className="absolute right-0.5 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center text-white/55 hover:text-white">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Vorgelesen wird nur die Zahl der Treffer - die Zeile steht immer da, damit die Ansage auch beim ersten Tippen kommt. */}
        <p className="sr-only" aria-live="polite" data-testid="faq-results-ansage">
          {searching ? (results.length ? mehrzahl(results.length, "Treffer", "Treffer") : "Nichts gefunden") : ""}
        </p>
        {searching ? (
          <section className="mt-6" data-testid="faq-results">
            <h2 className="text-xs font-bold uppercase tracking-widest text-white/50">
              {results.length ? mehrzahl(results.length, "Treffer", "Treffer") : "Nichts gefunden"}
            </h2>
            {results.length ? (
              <ul className="mt-3 divide-y divide-white/10 border-y border-white/10">
                {results.map((treffer) => <Treffer key={`${treffer.art}-${treffer.id}`} treffer={treffer} />)}
              </ul>
            ) : (
              <p className="mt-2 text-white/65" data-testid="faq-no-results">Probier ein anderes Wort oder schau unten in die Bereiche.</p>
            )}
          </section>
        ) : (
          <section className="mt-10" aria-labelledby="faq-haeufig-titel" data-testid="faq-haeufig">
            <h2 id="faq-haeufig-titel" className="font-heading text-2xl font-black uppercase text-white md:text-3xl">Häufige Fragen</h2>
            <ul className="mt-3 border-t border-white/10">
              {haeufig.map((frage) => (
                <FrageEintrag key={frage.id} frage={frage} offen={offeneFragen.has(frage.id)} bereich={faqBereich(frage.bereich)?.titel}
                  onToggle={() => setOffeneFragen((set) => toggleIn(set, frage.id))} />
              ))}
            </ul>
          </section>
        )}

        <section className="mt-12" aria-labelledby="faq-bereiche-titel" data-testid="faq-bereiche">
          <h2 id="faq-bereiche-titel" className="font-heading text-2xl font-black uppercase text-white md:text-3xl">Alle Bereiche</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Für wen?" data-testid="faq-rollen">
            <span className="mr-1 text-xs font-bold uppercase tracking-widest text-white/50" aria-hidden="true">Für</span>
            {[{ id: "", label: "Alle" }, ...rollen].map((row) => {
              const aktiv = rolle === row.id;
              return (
                <button key={row.id || "alle"} type="button" aria-pressed={aktiv} onClick={() => setParam("rolle", row.id)} data-testid={`faq-rolle-${row.id || "alle"}`}
                  className={`min-h-[44px] rounded-full border px-3 text-xs sm:px-4 font-bold uppercase tracking-wider transition-colors motion-reduce:transition-none ${
                    aktiv ? "border-[#29B6E8] bg-[#29B6E8] text-black" : "border-white/15 text-white/70 hover:border-white/35 hover:text-white"}`}>
                  {row.label}
                </button>
              );
            })}
          </div>
          <ul className="mt-4 divide-y divide-white/10 rounded-sm border border-white/10 bg-[#0B0B0C]" data-testid="faq-bereich-liste">
            {bereiche.map(({ bereich, inhalt }) => (
              <BereichZeile key={bereich.id} bereich={bereich} inhalt={inhalt} offen={offeneBereiche.has(bereich.id)}
                onToggle={() => setOffeneBereiche((set) => toggleIn(set, bereich.id))}
                offeneFragen={offeneFragen} onFrage={(id) => setOffeneFragen((set) => toggleIn(set, id))} />
            ))}
          </ul>
          {!bereiche.length ? <p className="mt-3 text-white/60" data-testid="faq-bereiche-leer">Für diese Auswahl gibt es noch nichts.</p> : null}
        </section>

        <p className="mt-10 text-sm text-white/55">
          Nicht gefunden, was du suchst? <Link to="/contact" className="text-[#29B6E8] underline underline-offset-2">Schreib uns</Link>.
        </p>
      </article>
    </PublicLayout>
  );
}
