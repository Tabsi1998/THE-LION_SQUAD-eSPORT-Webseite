import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { numberItems } from "@/lib/clubNumbers";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { newsCategoryLabel } from "@/lib/newsCategories";
import { applyCspNonce } from "@/lib/csp";
import { boardContacts } from "@/lib/memberArea";
import { useCountUp } from "@/hooks/useCountUp";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { Reveal } from "@/components/tls/Reveal";
import { MascotBadge } from "@/components/tls/Logo";
import { LazyImg } from "@/components/tls/LazyImg";
import { SeasonPassWidget } from "@/components/tls/SeasonPassWidget";
import { SponsorTicker } from "@/components/tls/SponsorTicker";
import { LiveStreamSlider } from "@/components/tls/LiveStreamSlider";
import { TwitchClips } from "@/components/tls/TwitchClips";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useChangedKeys, useCountdown } from "@/hooks/useLiveChanges";
import { liveCountLine, nextCountdownTarget, timelineSignature } from "@/lib/liveChanges";
import { SkeletonCards, SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { ArrowRight, Flag, Trophy, Calendar, Newspaper, Pin, Radio, Timer, Users } from "lucide-react";

const HOME_DESCRIPTION = "THE LION SQUAD eSports ist ein Gaming und eSports Verein aus Tirol mit Community, Turnieren, Fast-Lap-Challenges, Events, Mitgliedschaft und Vereinsleben.";

// Startseite (#407, #425, #431): Community zuerst - der Verein lebt von Leuten, die mitspielen und
// sich einbringen; Mitglied wird man nicht per Klick. Der Hero hat keine Knöpfe, „Mitglied werden“
// steht leise darunter; Discord und LionsAPP stehen im Footer. Zahlen und Ansprechpartner kommen
// aus echten Daten (`club_numbers`, `/board`), nie aus Platzhaltern - die Ansprechpartner als
// eigener Abschnitt unter den News.
// Bewegung (#832): Abschnitte blenden ihre Inhalte beim Hereinscrollen und nach dem Laden weich ein
// (`Reveal`, nur Deckkraft - Rahmen bleiben stehen, Saison-Deko hängt an ihnen), Karten zeigen Tiefe
// über Schatten statt Verschieben, der Countdown tickt weich, das Licht hinter dem Löwen folgt dem
// Zeiger. Mit „Bewegung reduzieren“ steht alles still und ist sofort da.

export default function HomePage() {
  const [state, setState] = useState(null);
  const [board, setBoard] = useState([]);
  const [heroRef, glowRef] = useHeroGlow();
  useDocumentTitle("Startseite", HOME_DESCRIPTION);

  const load = useCallback(() => {
    api.get("/home/state").then(({ data }) => setState(data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    api.get("/board?active_only=true").then(({ data }) => setBoard(boardContacts(data, 4))).catch(() => setBoard([]));
  }, [load]);

  useApiInvalidation(load, ["home", "tournaments", "events", "news", "f1", "sponsors", "settings"]);
  useHomeStructuredData(state);
  // Ein Stand, eine Liste: sonst sähe der Änderungsvergleich in NextUp bei jedem Tick neue Objekte.
  const timeline = useMemo(() => (state ? buildHomeTimeline(state).slice(0, 5) : []), [state]);
  const primaryNews = state?.featured_news?.[0] || state?.news?.[0] || null;
  const newsItems = homeNews(state, primaryNews?.id).slice(0, 3);
  const isEmptyHome = state && !state.has_live && !timeline.length && !primaryNews && !newsItems.length;

  return (
    <PublicLayout>
      {/* Live Banner — only when something is actually live */}
      {state?.has_live && <LiveBanner state={state} />}

      {/* Hero */}
      <section ref={heroRef} className="relative overflow-hidden border-b border-white/10 bg-grid-dense">
        <div className="absolute inset-0 pointer-events-none">
          {/* Animierter Hintergrund statt externem Bild */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#29B6E8]/5 via-transparent to-[#9F7AEA]/5" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(41,182,232,0.12),transparent)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/40 via-[#0A0A0A]/70 to-[#0A0A0A]" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <div className="grid lg:grid-cols-12 gap-8 items-center min-w-0">
            <div className="lg:col-span-7 min-w-0 tls-hero-enter">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#29B6E8]/10 border border-[#29B6E8]/30 rounded-sm mb-6" data-testid="hero-tag">
                <span className="w-2 h-2 rounded-full bg-[#29B6E8] animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">THE LION SQUAD · eSPORTS</span>
              </div>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-7xl font-black uppercase tracking-tighter leading-[0.95] text-white">
                Ein Rudel.<br /><span className="tls-gradient-text">Eine Familie.</span>
              </h1>
              <p className="mt-6 text-base md:text-lg text-white/70 max-w-xl leading-relaxed" data-testid="hero-text">
                Gaming- und eSports-Verein aus Tirol. Bei uns geht es um Gemeinschaft: gemeinsam zocken, Turniere spielen, Events erleben — auf Discord und vor Ort. Wer mitspielt und sich einbringt, gehört dazu.
              </p>
              {/* Keine Knöpfe im Hero (#425) und keine Extrazeile mehr (#947): der Weg zum Mitglied steht an
                  einer Stelle - „Mitglied werden“ in der Kopfzeile; Mitglieder finden ihren Bereich im Benutzermenü. */}
            </div>
            <div className="lg:col-span-5 flex items-center justify-center min-w-0 tls-hero-enter tls-hero-enter-delay">
              <div className="relative" data-season-anchor="lion">
                <div ref={glowRef} aria-hidden="true" className="absolute -inset-20 pointer-events-none opacity-20 tls-hero-glow" data-testid="home-hero-glow" />
                <MascotBadge className="relative w-64 h-64 md:w-80 md:h-80 drop-shadow-[0_0_40px_rgba(41,182,232,0.3)]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <ClubNumbers numbers={state?.club_numbers} shown={state?.club_numbers_shown} />
      {/* Discord (#581): online und im Voice - nur Zahlen, nur bei eingeschaltetem Server-Widget. */}
      <LiveStreamSlider />
      <TwitchClips />
      <SponsorTicker placement="home" spotlight />

      {!state && (
        <section className="border-b border-white/10 bg-[#080808]/35">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12 space-y-8">
            <SkeletonDetailHeader label="Lade Startseite" />
            <SkeletonCards count={3} label="Lade Termine" />
          </div>
        </section>
      )}

      {state && (primaryNews || timeline.length > 0) && (
        <Reveal as="section" className="border-b border-white/10 bg-[#080808]/35" data-testid="home-current">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12 min-w-0">
            {primaryNews && <FeaturedNews news={primaryNews} />}
            <div className={`${primaryNews ? "mt-8 md:mt-10 border-t border-white/10 pt-8 md:pt-10" : ""}`}>
              <NextUp items={timeline} />
            </div>
          </div>
        </Reveal>
      )}

      {/* If nothing current is published, show a quiet fallback. */}
      {isEmptyHome && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="border border-dashed border-white/15 rounded-sm p-12 text-center">
            <Trophy className="w-10 h-10 mx-auto text-white/20 mb-4" />
            <h2 className="font-heading text-2xl font-black uppercase">Aktuell ruht das Rudel</h2>
            <p className="mt-3 text-white/60 max-w-xl mx-auto">Keine laufenden oder anstehenden Events. Folge uns auf Discord oder schau bei den News, um keine Ankündigung zu verpassen.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link to="/news" className="px-5 py-2.5 border border-[#29B6E8]/40 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm">News lesen</Link>
              <Link to="/membership/join" className="px-5 py-2.5 border border-[#FFD700]/40 text-[#FFD700] font-bold uppercase tracking-wider rounded-sm">Mitglied werden</Link>
            </div>
          </div>
        </section>
      )}

      {/* Jahreswertung widget */}
      <SeasonPassWidget />

      {newsItems.length > 0 && (
        <Reveal as="section" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16" data-testid="home-news">
          <SectionHeader icon={Newspaper} accent="#29B6E8" title="Aktuelle News" actionLabel="Alle News" actionTo="/news" />
          {/* Drei Spalten (#832): die große Karte links über zwei Zeilen, die kleinen rechts übereinander - ohne Lücke. */}
          <div className="grid lg:grid-cols-3 gap-5 mt-8" data-testid="home-news-grid">
            {newsItems.map((n, idx) => (
              <NewsCard key={n.id} news={n} featured={idx === 0} index={idx} count={newsItems.length} />
            ))}
          </div>
        </Reveal>
      )}

      {/* Ansprechpartner unter den News (#431), über die volle Breite - der App-Kasten daneben ist weg. */}
      {board.length > 0 && (
        <Reveal as="section" className="border-t border-white/10 bg-[#080808]/35">
          {/* Unten knapper (#832): die Fußzeile bringt ihren eigenen Abstand mit. */}
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 md:pt-16 pb-6 min-w-0">
            <BoardTeaser contacts={board} />
          </div>
        </Reveal>
      )}

    </PublicLayout>
  );
}

// Das Licht hinter dem Löwen folgt dem Zeiger ein wenig (#832) - nur mit Maus, nie mit „Bewegung reduzieren“.
// Bewegt wird nur das Licht; der Löwe bleibt, wo er ist, damit Saison-Hüte und -Ohren sitzen.
const GLOW_RANGE = { x: 28, y: 20 };

export function glowOffset(pointer, center, viewport, range = GLOW_RANGE) {
  const clamp = (value) => Math.max(-1, Math.min(1, value));
  const dx = clamp((pointer.x - center.x) / Math.max(1, viewport.width / 2));
  const dy = clamp((pointer.y - center.y) / Math.max(1, viewport.height / 2));
  return { x: Math.round(dx * range.x), y: Math.round(dy * range.y) };
}

function useHeroGlow() {
  const heroRef = useRef(null);
  const glowRef = useRef(null);
  useEffect(() => {
    const hero = heroRef.current;
    const glow = glowRef.current;
    if (!hero || !glow || typeof window.matchMedia !== "function") return undefined;
    let allowed = false;
    try {
      allowed = window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      allowed = false;
    }
    if (!allowed) return undefined;
    let frame = 0;
    let next = null;
    const apply = () => {
      frame = 0;
      if (!next) return;
      glow.style.setProperty("--tls-glow-x", `${next.x}px`);
      glow.style.setProperty("--tls-glow-y", `${next.y}px`);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    const move = (event) => {
      const box = (glow.parentElement || glow).getBoundingClientRect();
      next = glowOffset({ x: event.clientX, y: event.clientY }, { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        { width: window.innerWidth, height: window.innerHeight });
      schedule();
    };
    const leave = () => {
      next = { x: 0, y: 0 };
      schedule();
    };
    hero.addEventListener("pointermove", move);
    hero.addEventListener("pointerleave", leave);
    return () => {
      hero.removeEventListener("pointermove", move);
      hero.removeEventListener("pointerleave", leave);
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return [heroRef, glowRef];
}

function useHomeStructuredData(state) {
  useEffect(() => {
    const origin = window.location.origin;
    const nextItems = state ? buildHomeTimeline(state).slice(0, 6) : [];
    const newsItems = state ? (state.news || []).slice(0, 6) : [];
    const data = [
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "THE LION SQUAD eSports",
        url: origin,
        sameAs: [origin],
      },
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "THE LION SQUAD eSports",
        url: origin,
        potentialAction: {
          "@type": "SearchAction",
          target: `${origin}/news?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
    ];
    if (nextItems.length) {
      data.push({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Kommende Events und eSports-Inhalte",
        itemListElement: nextItems.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${origin}${item.url}`,
          name: item.label,
        })),
      });
    }
    if (newsItems.length) {
      data.push({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Aktuelle News",
        itemListElement: newsItems.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          url: `${origin}/news/${item.slug}`,
          name: item.title,
        })),
      });
    }
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.tlsHomeStructuredData = "true";
    script.textContent = JSON.stringify(data);
    applyCspNonce(script);
    document.head.appendChild(script);
    return () => script.remove();
  }, [state]);
}

// Der Verein in Zahlen (#407, #425): nur Zähler über null, sonst gar keine Leiste. „Turnier-
// teilnahmen“ sind die Referenzen; die Zahlen zählen hoch, sobald der Block sichtbar wird.

function ClubNumbers({ numbers, shown }) {
  // Die Zähler, die der Betreiber gewählt hat (#621) - Einzahl, wenn es genau eins ist.
  const items = numberItems(numbers, shown);
  if (!items.length) return null;
  return (
    <section className="border-b border-white/10 bg-[#080808]/35" data-testid="home-numbers">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map(({ key, label, value }) => <NumberTile key={key} id={key} label={label} value={value} />)}
      </div>
    </section>
  );
}

function NumberTile({ id, label, value }) {
  const [shown, ref] = useCountUp(value);
  return (
    <div ref={ref} className="tls-hero-enter" data-testid={`home-number-${id}`}>
      <div className="font-heading text-3xl md:text-4xl font-black text-white tabular-nums" aria-label={`${value.toLocaleString("de-AT")} ${label}`}>{shown.toLocaleString("de-AT")}</div>
      <div className="text-[10px] uppercase tracking-widest font-bold text-white/45">{label}</div>
    </div>
  );
}

// Ansprechpartner (#407, #431): die freigegebenen Namen aus dem Vorstand - dieselbe Auswahl wie im
// Mitgliederbereich; ohne besetzte Posten bleibt der Block weg. Größere Karten mit Bild, bis zu
// vier nebeneinander.
function BoardTeaser({ contacts }) {
  return (
    <div className="min-w-0" data-testid="home-board">
      <SectionHeader icon={Users} accent="#FFD700" title="Ansprechpartner" actionLabel="Ganzer Vorstand" actionTo="/board" />
      <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {contacts.map((contact, index) => (
          <Link key={contact.id} to={contact.profileUrl || "/board"} data-testid={`home-board-${contact.id}`} data-season-anchor="card" style={{ "--tls-i": index + 1 }}
            className="group tls-reveal-item flex items-center gap-4 border border-white/10 hover:border-[#FFD700]/50 focus-visible:border-[#FFD700]/50 hover:shadow-[0_18px_40px_-26px_rgba(255,215,0,0.55)] rounded-sm bg-[#111] p-4 transition duration-300 min-w-0">
            {contact.avatar ? (
              <span className="w-16 h-16 md:w-20 md:h-20 rounded-sm overflow-hidden shrink-0">
                <LazyImg src={contact.avatar} alt="" className="w-full h-full object-cover transition duration-500 group-hover:scale-105" />
              </span>
            ) : (
              <span className="w-16 h-16 md:w-20 md:h-20 rounded-sm bg-[#FFD700]/15 text-[#FFD700] font-heading font-black text-2xl inline-flex items-center justify-center shrink-0">{(contact.name || "?").slice(0, 1).toUpperCase()}</span>
            )}
            <span className="min-w-0">
              <span className="block text-[11px] uppercase tracking-widest font-bold text-[#FFD700] truncate">{contact.title}</span>
              <span className="block font-heading text-lg md:text-xl font-black uppercase leading-tight break-words group-hover:text-[#FFD700] transition">{contact.name}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function FeaturedNews({ news }) {
  return (
    <Link to={`/news/${news.slug}`} data-testid={`home-featured-news-${news.slug}`} data-season-anchor="card"
      className="group tls-reveal-item border border-white/10 hover:border-[#29B6E8]/50 focus-visible:border-[#29B6E8]/50 hover:shadow-[0_22px_48px_-28px_rgba(41,182,232,0.6)] rounded-sm bg-[#111] overflow-hidden grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)] transition duration-300 min-w-0">
      <div className="aspect-[16/9] lg:aspect-auto bg-[#070707] overflow-hidden">
        {news.banner_url ? (
          <LazyImg src={news.banner_url} alt="" sizes="(min-width: 1024px) 45vw, 100vw" className="w-full h-full object-cover object-center opacity-90 group-hover:scale-105 transition duration-500" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#29B6E8]/20 via-[#101010] to-black" />
        )}
      </div>
      <div className="p-5 md:p-7 lg:p-8 flex flex-col justify-center min-w-0">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
          <Newspaper className="w-3 h-3" /> Neueste News {news.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
        </div>
        <h2 className="mt-3 max-w-2xl font-heading text-2xl md:text-3xl xl:text-[2.2rem] font-black uppercase leading-[1.03] group-hover:text-[#29B6E8] transition break-words line-clamp-4">{news.title}</h2>
        {news.excerpt && <p className="mt-4 max-w-2xl text-white/65 text-sm md:text-base leading-relaxed line-clamp-3">{news.excerpt}</p>}
        <span className="mt-5 inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-white/55 group-hover:text-[#29B6E8]">
          Lesen <ArrowRight className="w-3.5 h-3.5 transition-transform duration-300 group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  );
}

// Countdown zum nächsten Termin und Live-Zahlen je Karte (#224). Kommt über den Strom eine
// Änderung für eine Karte, leuchtet sie kurz und trägt ein paar Sekunden „Neu“ - beim ersten
// Laden nicht. Mit „Bewegung reduzieren“ bleibt das Leuchten aus, das Kennzeichen nicht.
function NextUp({ items }) {
  const changed = useChangedKeys(items, timelineKey, timelineSignature);
  const target = nextCountdownTarget(items);
  const countdown = useCountdown(target?.targetMs || null);
  if (!items.length) return (
    <div className="border border-dashed border-white/15 rounded-sm p-6 text-white/45 min-w-0">
      <div className="text-[10px] uppercase tracking-widest font-bold text-white/40">Nächster Termin</div>
      <div className="mt-3 font-heading text-xl font-black uppercase">Aktuell nichts geplant</div>
      <p className="mt-2 text-sm">Sobald News, Events, Turniere oder Fast-Laps gepflegt werden, erscheint hier automatisch der nächste relevante Eintrag.</p>
    </div>
  );
  return (
    <div className="tls-reveal-item border border-white/10 rounded-sm bg-[#111] p-5 min-w-0" style={{ "--tls-i": 1 }} data-testid="home-next-up">
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="text-[10px] uppercase tracking-widest font-bold text-[#FFD700]">Nächste Termine</div>
        <div className="shrink-0 flex items-center gap-3">
          <Link to="/calendar" data-testid="home-calendar-link" className="text-[10px] uppercase tracking-widest font-bold text-white/40 hover:text-[#29B6E8]">Kalender</Link>
          <Link to="/events" className="text-[10px] uppercase tracking-widest font-bold text-white/40 hover:text-[#29B6E8]">Alle Events</Link>
        </div>
      </div>
      {target && countdown && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0" data-testid="home-countdown">
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-white/40"><Timer className="w-3 h-3" /> {target.item.label}</span>
          <span key={countdown} className="tls-tick font-heading text-xl md:text-2xl font-black uppercase text-white tabular-nums" data-testid="home-countdown-value">{countdown}</span>
        </div>
      )}
      <div className="mt-4 space-y-3">
        {items.map((item) => {
          const key = timelineKey(item);
          const isChanged = changed.has(key);
          const counts = liveCountLine(item);
          return (
            <Link
              key={key}
              to={item.url}
              data-testid={`home-next-${item.kind}-${item.slug || item.id}`}
              data-changed={isChanged ? "true" : undefined}
              className={`flex flex-col sm:flex-row sm:items-center gap-3 border border-white/10 hover:border-[#29B6E8]/50 hover:bg-white/[0.03] focus-visible:border-[#29B6E8]/50 rounded-sm p-3 bg-black/20 transition duration-300 min-w-0 ${isChanged ? "tls-changed" : ""}`}
            >
              <div className="flex items-center gap-3 min-w-0 w-full">
                <KindIcon kind={item.kind} />
                <div className="min-w-0 flex-1">
                  <div className="font-heading font-bold leading-tight line-clamp-2 flex items-center gap-2 flex-wrap">
                    <span>{item.label}</span>
                    {isChanged && <span className="tls-new-chip" data-testid="home-next-new">Neu</span>}
                  </div>
                  {counts && <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-white/55 tabular-nums" data-testid="home-live-counts"><Users className="w-3 h-3" /> {counts}</div>}
                </div>
              </div>
              {/* Einzeilig (#832): die Plakette brach in der schmalen Spalte um - jetzt so breit wie nötig. */}
              <div className="w-full sm:w-auto sm:shrink-0 sm:min-w-[12rem] flex flex-col gap-2 sm:items-start">
                {item.start_date && <div className="text-xs text-white/45">{new Date(item.start_date).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>}
                {(item.public_phase || item.status) && <PhaseBadge phase={item.public_phase} status={item.status} className="self-start max-w-full sm:whitespace-nowrap" />}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function LiveBanner({ state }) {
  const live = state.live;
  const all = [
    ...(live.tournaments || []).map((x) => ({ ...x, kind: "tournament", url: `/tournaments/${x.slug}` })),
    ...(live.challenges || []).map((x) => ({ ...x, kind: "fastlap", url: `/fastlap/${x.slug}` })),
    ...(live.events || []).map((x) => ({ ...x, kind: "event", url: `/events/${x.slug}` })),
  ];
  if (!all.length) return null;
  return (
    <div className="relative bg-gradient-to-r from-[#FF3B30] via-[#FF3B30]/80 to-[#FF3B30] border-b border-[#FF3B30]/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-white">
          <Radio className="w-4 h-4 animate-pulse" />
          <span className="font-display tracking-widest font-bold text-sm">LIVE JETZT</span>
        </div>
        <div className="flex-1 flex items-center gap-3 flex-wrap">
          {all.slice(0, 3).map((x) => (
            <Link key={x.id} to={x.url} data-testid={`live-banner-${x.kind}-${x.slug}`} className="inline-flex items-center gap-2 px-3 py-1.5 bg-black/30 hover:bg-black/50 text-white border border-white/20 rounded-sm transition text-sm">
              <span className="font-bold">{x.title || x.name}</span>
              {x.kind === "fastlap" && <Flag className="w-3 h-3" />}
              {x.kind === "tournament" && <Trophy className="w-3 h-3" />}
              {x.kind === "event" && <Calendar className="w-3 h-3" />}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// Wie die Karte im Raster steht (#832): eine allein über die ganze Breite, zwei nebeneinander (2:1),
// drei mit der großen links über zwei Zeilen - die große Karte füllt dann die Höhe, ihr Bild wächst mit.
export function newsCardSpan(featured, count) {
  if (!featured) return "";
  if (count >= 3) return "lg:col-span-2 lg:row-span-2";
  return count === 2 ? "lg:col-span-2" : "lg:col-span-3";
}

function NewsCard({ news, featured = false, index = 0, count = 1 }) {
  const tall = featured && count >= 3;
  const media = tall ? "aspect-[16/8] lg:aspect-auto lg:flex-1 lg:min-h-[16rem]" : featured ? "aspect-[16/8]" : "aspect-video";
  return (
    <Link
      to={`/news/${news.slug}`}
      data-testid={`home-news-${news.slug}`}
      data-season-anchor="card"
      style={{ "--tls-i": index + 1 }}
      className={`group tls-reveal-item border border-white/10 hover:border-[#29B6E8]/50 focus-visible:border-[#29B6E8]/50 hover:shadow-[0_18px_40px_-24px_rgba(41,182,232,0.55)] rounded-sm bg-[#121212] overflow-hidden transition duration-300 flex flex-col ${newsCardSpan(featured, count)}`}
    >
      {news.banner_url ? (
        <div className={`${media} relative bg-[#0A0A0A] overflow-hidden`} data-testid={tall ? "home-news-tall-media" : undefined}>
          {/* Hohe Karte (Desktop): das ganze Banner, kein Logo abgeschnitten - die freie Fläche füllt dasselbe Bild, unscharf und gedämpft. */}
          {tall && (
            <LazyImg src={news.banner_url} alt="" aria-hidden="true" sizes="(min-width: 1024px) 66vw, 100vw"
              className="hidden lg:block absolute inset-0 w-full h-full object-cover scale-110 blur-2xl opacity-40" />
          )}
          <LazyImg src={news.banner_url} alt="" sizes={featured ? "(min-width: 1024px) 66vw, 100vw" : "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"}
            className={`relative w-full h-full ${tall ? "object-cover lg:object-contain" : "object-cover"} group-hover:scale-105 transition duration-500`} />
        </div>
      ) : (
        <div className={`${media} bg-gradient-to-br from-[#29B6E8]/20 via-[#0A0A0A] to-[#0A0A0A]`} />
      )}
      <div className={`p-4 ${tall ? "" : "flex-1"}`}>
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
          {newsCategoryLabel(news.category)}
          {news.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
        </div>
        <h3 className={`mt-2 font-heading font-black uppercase leading-tight break-words line-clamp-3 group-hover:text-[#29B6E8] transition ${featured ? "text-xl md:text-2xl" : ""}`}>{news.title}</h3>
        {(news.published_at || news.created_at) && <div className="mt-2 text-[11px] text-white/40">{new Date(news.published_at || news.created_at).toLocaleDateString("de-DE", { dateStyle: "medium" })}</div>}
        {news.excerpt && <p className="mt-2 text-xs text-white/60 line-clamp-3">{news.excerpt}</p>}
      </div>
    </Link>
  );
}

function timelineKey(item) {
  return `${item.kind}-${item.id || item.slug}`;
}

function KindIcon({ kind }) {
  if (kind === "tournament") return <Trophy className="w-3.5 h-3.5 text-[#FFD700]" />;
  if (kind === "fastlap") return <Flag className="w-3.5 h-3.5 text-[#29B6E8]" />;
  return <Calendar className="w-3.5 h-3.5 text-[#9F7AEA]" />;
}

function SectionHeader({ icon: Icon, accent, title, actionLabel, actionTo }) {
  return (
    <div className="tls-reveal-text flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div className="text-[11px] uppercase tracking-[0.3em] font-bold flex items-center gap-2" style={{ color: accent }}>
          <Icon className="w-3.5 h-3.5" /> {title}
        </div>
      </div>
      {actionTo && (
        <Link to={actionTo} className="group/more inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-white/60 hover:text-[#29B6E8] transition">
          {actionLabel} <ArrowRight className="w-3 h-3 transition-transform duration-300 group-hover/more:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

function normalizeTimelineItem(item, kind, source, sourcePriority) {
  const slug = item.slug || item.id;
  const label = kind === "event" ? item.name : item.title;
  const url = kind === "event" ? `/events/${slug}` : kind === "tournament" ? `/tournaments/${slug}` : `/fastlap/${slug}`;
  return { ...item, kind, source, sourcePriority, url, label };
}

function buildHomeTimeline(state) {
  if (!state) return [];
  const groups = [
    ["live", state.live || {}, 0],
    ["today", state.today || {}, 1],
    ["soon", state.soon || {}, 2],
    ["upcoming", state.upcoming || {}, 3],
  ];
  const byKey = new Map();
  for (const [source, group, sourcePriority] of groups) {
    const rows = [
      ...(group.events || []).map((x) => normalizeTimelineItem(x, "event", source, sourcePriority)),
      ...(group.tournaments || []).map((x) => normalizeTimelineItem(x, "tournament", source, sourcePriority)),
      ...(group.challenges || []).map((x) => normalizeTimelineItem(x, "fastlap", source, sourcePriority)),
    ];
    for (const item of rows) {
      const key = `${item.kind}-${item.id || item.slug}`;
      const existing = byKey.get(key);
      if (!existing || item.sourcePriority < existing.sourcePriority) {
        byKey.set(key, item);
      }
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const liveRankA = a.public_phase?.state === "live" ? 0 : 1;
    const liveRankB = b.public_phase?.state === "live" ? 0 : 1;
    if (liveRankA !== liveRankB) return liveRankA - liveRankB;
    const da = a.start_date ? new Date(a.start_date).getTime() : Number.MAX_SAFE_INTEGER;
    const db = b.start_date ? new Date(b.start_date).getTime() : Number.MAX_SAFE_INTEGER;
    if (da !== db) return da - db;
    return a.sourcePriority - b.sourcePriority;
  });
}

function homeNews(state, excludeId) {
  if (!state?.news?.length) return [];
  const featuredId = excludeId || state.featured_news?.[0]?.id;
  return state.news.filter((n) => n.id !== featuredId).slice(0, 8);
}
