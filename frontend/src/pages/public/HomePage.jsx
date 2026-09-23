import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { newsCategoryLabel } from "@/lib/newsCategories";
import { applyCspNonce } from "@/lib/csp";
import { getCachedBranding } from "@/lib/brandingEvents";
import { boardContacts } from "@/lib/memberArea";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { MascotBadge } from "@/components/tls/Logo";
import { LazyImg } from "@/components/tls/LazyImg";
import { SeasonPassWidget } from "@/components/tls/SeasonPassWidget";
import { SponsorTicker } from "@/components/tls/SponsorTicker";
import { LiveStreamSlider } from "@/components/tls/LiveStreamSlider";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useChangedKeys, useCountdown } from "@/hooks/useLiveChanges";
import { liveCountLine, nextCountdownTarget, timelineSignature } from "@/lib/liveChanges";
import { SkeletonCards, SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { ArrowRight, Flag, Trophy, Calendar, Newspaper, Pin, Radio, Timer, Users, MessageCircle, Smartphone } from "lucide-react";

const HOME_DESCRIPTION = "THE LION SQUAD eSports ist ein Gaming und eSports Verein aus Tirol mit Community, Turnieren, Fast-Lap-Challenges, Events, Mitgliedschaft und Vereinsleben.";

// Startseite (#407): Community zuerst - der Verein lebt von Leuten, die mitspielen und sich
// einbringen; Mitglied wird man nicht per Klick. Deshalb führt der Hero zur Community und zu den
// Turnieren, „Mitglied werden“ steht leise darunter. Zahlen und Ansprechpartner kommen aus echten
// Daten (`club_numbers`, `/board`), nie aus Platzhaltern.

export default function HomePage() {
  const [state, setState] = useState(null);
  const [board, setBoard] = useState([]);
  const { isClubMember } = useAuth() || {};
  const discordUrl = String(getCachedBranding()?.discord_invite_url || "").trim();
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
      <section className="relative overflow-hidden border-b border-white/10 bg-grid-dense">
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
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/community" data-testid="hero-cta-community" className="inline-flex items-center gap-2 px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] hover:shadow-[0_0_24px_rgba(41,182,232,0.6)] transition-all">
                  <Users className="w-4 h-4" /> Community <ArrowRight className="w-4 h-4" />
                </Link>
                <Link to="/tournaments" data-testid="hero-cta-tournaments" className="inline-flex items-center gap-2 px-6 py-3 border border-white/15 text-white/70 hover:text-white font-bold uppercase tracking-wider rounded-sm transition-all">
                  <Trophy className="w-4 h-4" /> Turniere
                </Link>
                {discordUrl && (
                  <a href={discordUrl} target="_blank" rel="noreferrer" data-testid="hero-cta-discord" className="inline-flex items-center gap-2 px-6 py-3 border border-[#5865F2]/50 text-[#8b95ff] hover:text-white font-bold uppercase tracking-wider rounded-sm transition-all">
                    <MessageCircle className="w-4 h-4" /> Discord
                  </a>
                )}
              </div>
              <p className="mt-5 text-sm text-white/45" data-testid="hero-join">
                {isClubMember ? (
                  <Link to="/members/area" className="text-[#FFD700] hover:underline">Zum Mitgliederbereich</Link>
                ) : (
                  <>Mitglied wird, wer sich einbringt — <Link to="/membership/join" className="text-[#FFD700] hover:underline">so läuft das bei uns</Link>.</>
                )}
              </p>
            </div>
            <div className="lg:col-span-5 flex items-center justify-center min-w-0 tls-hero-enter tls-hero-enter-delay">
              <div className="relative">
                <div className="absolute inset-0 bg-[#29B6E8] blur-[80px] opacity-20" />
                <MascotBadge className="relative w-64 h-64 md:w-80 md:h-80 drop-shadow-[0_0_40px_rgba(41,182,232,0.3)]" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <ClubNumbers numbers={state?.club_numbers} />
      <LiveStreamSlider />
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
        <section className="border-b border-white/10 bg-[#080808]/35">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12 min-w-0">
            {primaryNews && <FeaturedNews news={primaryNews} />}
            <div className={`${primaryNews ? "mt-8 md:mt-10 border-t border-white/10 pt-8 md:pt-10" : ""}`}>
              <NextUp items={timeline} />
            </div>
          </div>
        </section>
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

      {(board.length > 0) && (
        <section className="border-y border-white/10 bg-[#080808]/35">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12 grid lg:grid-cols-2 gap-8 min-w-0">
            <BoardTeaser contacts={board} />
            <AppStrip />
          </div>
        </section>
      )}
      {board.length === 0 && (
        <section className="border-y border-white/10 bg-[#080808]/35">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-12 min-w-0">
            <AppStrip />
          </div>
        </section>
      )}

      {newsItems.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <SectionHeader icon={Newspaper} accent="#29B6E8" title="Aktuelle News" actionLabel="Alle News" actionTo="/news" />
          <div className="grid lg:grid-cols-4 gap-5 mt-8">
            {newsItems.map((n, idx) => (
              <NewsCard key={n.id} news={n} featured={idx === 0} />
            ))}
          </div>
        </section>
      )}

    </PublicLayout>
  );
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

// Der Verein in Zahlen (#407): nur Zähler über null, sonst gar keine Leiste.
const NUMBER_LABELS = [["members", "Mitglieder"], ["tournaments", "Turniere"], ["events", "Events"], ["awards", "Auszeichnungen"]];

function ClubNumbers({ numbers }) {
  const items = NUMBER_LABELS.map(([key, label]) => [key, label, Number(numbers?.[key] || 0)]).filter(([, , value]) => value > 0);
  if (!items.length) return null;
  return (
    <section className="border-b border-white/10 bg-[#080808]/35" data-testid="home-numbers">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {items.map(([key, label, value]) => (
          <div key={key} className="tls-hero-enter" data-testid={`home-number-${key}`}>
            <div className="font-heading text-3xl md:text-4xl font-black text-white tabular-nums">{value.toLocaleString("de-AT")}</div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/45">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Ansprechpartner (#407): die freigegebenen Namen aus dem Vorstand - dieselbe Auswahl wie im
// Mitgliederbereich; ohne besetzte Posten bleibt der Block weg.
function BoardTeaser({ contacts }) {
  return (
    <div className="min-w-0" data-testid="home-board">
      <SectionHeader icon={Users} accent="#FFD700" title="Ansprechpartner" actionLabel="Ganzer Vorstand" actionTo="/board" />
      <div className="mt-6 grid sm:grid-cols-2 gap-3">
        {contacts.map((contact) => (
          <Link key={contact.id} to={contact.profileUrl || "/board"} data-testid={`home-board-${contact.id}`} className="flex items-center gap-3 border border-white/10 hover:border-[#FFD700]/50 rounded-sm bg-[#111] px-3 py-2 transition min-w-0">
            {contact.avatar ? (
              <LazyImg src={contact.avatar} alt="" className="w-10 h-10 rounded-sm object-cover shrink-0" />
            ) : (
              <span className="w-10 h-10 rounded-sm bg-[#FFD700]/15 text-[#FFD700] font-heading font-black inline-flex items-center justify-center shrink-0">{(contact.name || "?").slice(0, 1).toUpperCase()}</span>
            )}
            <span className="min-w-0">
              <span className="block text-[10px] uppercase tracking-widest font-bold text-[#FFD700] truncate">{contact.title}</span>
              <span className="block text-sm font-bold truncate">{contact.name}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// LionsAPP (#407): ehrlich - bis zur Veröffentlichung im Play Store gibt es keinen Knopf.
function AppStrip() {
  return (
    <div className="border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm p-5 md:p-6 min-w-0" data-testid="home-app-strip">
      <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]"><Smartphone className="w-3.5 h-3.5" /> LionsAPP fürs Handy</div>
      <h2 className="mt-2 font-heading text-2xl font-black uppercase">Der Verein in der Hosentasche</h2>
      <p className="mt-2 text-sm text-white/65 max-w-xl">Termine mit Kalender, Turniere mit Anmeldung, Chat mit dem Team, Mitgliedskarte mit QR — und Push, wenn es losgeht. Bald im Play Store; den Testzugang bekommen Mitglieder vom Vorstand.</p>
    </div>
  );
}

function FeaturedNews({ news }) {
  return (
    <Link to={`/news/${news.slug}`} data-testid={`home-featured-news-${news.slug}`} className="group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#111] overflow-hidden grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)] transition min-w-0">
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
          Lesen <ArrowRight className="w-3.5 h-3.5" />
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
    <div className="border border-white/10 rounded-sm bg-[#111] p-5 min-w-0">
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
          <span className="font-heading text-xl md:text-2xl font-black uppercase text-white tabular-nums">{countdown}</span>
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
              className={`flex flex-col sm:flex-row sm:items-center gap-3 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm p-3 bg-black/20 transition min-w-0 ${isChanged ? "tls-changed" : ""}`}
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
              <div className="w-full sm:w-auto sm:min-w-[12rem] flex flex-col gap-2 sm:items-start">
                {item.start_date && <div className="text-xs text-white/45">{new Date(item.start_date).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>}
                {(item.public_phase || item.status) && <PhaseBadge phase={item.public_phase} status={item.status} className="self-start max-w-full" />}
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

function NewsCard({ news, featured = false }) {
  return (
    <Link
      to={`/news/${news.slug}`}
      data-testid={`home-news-${news.slug}`}
      className={`group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] overflow-hidden transition flex flex-col ${featured ? "lg:col-span-2 lg:row-span-2" : ""}`}
    >
      {news.banner_url ? (
        <div className={`${featured ? "aspect-[16/8]" : "aspect-video"} bg-[#0A0A0A] overflow-hidden`}>
          <LazyImg src={news.banner_url} alt="" sizes="(min-width: 1024px) 25vw, (min-width: 768px) 50vw, 100vw" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
        </div>
      ) : (
        <div className={`${featured ? "aspect-[16/8]" : "aspect-video"} bg-gradient-to-br from-[#29B6E8]/20 via-[#0A0A0A] to-[#0A0A0A]`} />
      )}
      <div className="p-4 flex-1">
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
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div className="text-[11px] uppercase tracking-[0.3em] font-bold flex items-center gap-2" style={{ color: accent }}>
          <Icon className="w-3.5 h-3.5" /> {title}
        </div>
      </div>
      {actionTo && (
        <Link to={actionTo} className="inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-white/60 hover:text-[#29B6E8] transition">
          {actionLabel} <ArrowRight className="w-3 h-3" />
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
