import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { MascotBadge } from "@/components/tls/Logo";
import { SeasonPassWidget } from "@/components/tls/SeasonPassWidget";
import { SponsorTicker } from "@/components/tls/SponsorTicker";
import { LiveStreamSlider } from "@/components/tls/LiveStreamSlider";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { motion } from "framer-motion";
import { ArrowRight, Flag, Trophy, Calendar, Newspaper, Crown, Pin, Radio, Image as ImageIcon, Gamepad2 } from "lucide-react";

const HOME_DESCRIPTION = "THE LION SQUAD eSports: News, Events, Turniere, Fast-Lap-Challenges, Galerie und Vereinsinfos aus Tirol.";

export default function HomePage() {
  const [state, setState] = useState(null);
  useDocumentTitle("Startseite", HOME_DESCRIPTION);

  const load = useCallback(() => {
    api.get("/home/state").then(({ data }) => setState(data)).catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["home", "tournaments", "events", "news", "f1", "sponsors", "settings"]);
  useHomeStructuredData(state);
  const timeline = state ? buildHomeTimeline(state).slice(0, 5) : [];
  const primaryNews = state?.featured_news?.[0] || state?.news?.[0] || null;
  const newsItems = homeNews(state, primaryNews?.id).slice(0, 3);
  const isEmptyHome = state && !state.has_live && !timeline.length && !primaryNews && !newsItems.length;

  return (
    <PublicLayout>
      {/* Live Banner — only when something is actually live */}
      {state?.has_live && <LiveBanner state={state} />}

      {/* Phase E — Live Twitch Streams */}
      <LiveStreamSlider />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10 bg-grid-dense">
        <div className="absolute inset-0 pointer-events-none">
          <img
            src="https://images.pexels.com/photos/7915213/pexels-photo-7915213.jpeg"
            alt=""
            className="w-full h-full object-cover opacity-20"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/60 via-[#0A0A0A]/80 to-[#0A0A0A]" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-28">
          <div className="grid lg:grid-cols-12 gap-8 items-center min-w-0">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="lg:col-span-7 min-w-0">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#29B6E8]/10 border border-[#29B6E8]/30 rounded-sm mb-6" data-testid="hero-tag">
                <span className="w-2 h-2 rounded-full bg-[#29B6E8] animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">THE LION SQUAD · eSPORTS</span>
              </div>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-7xl font-black uppercase tracking-tighter leading-[0.95] text-white">
                Ein Rudel.<br /><span className="tls-gradient-text">Eine Familie.</span>
              </h1>
              <p className="mt-6 text-base md:text-lg text-white/70 max-w-xl leading-relaxed">
                Vereinsplattform, Turnierarena, Fast-Lap-Championship und Mitgliederportal — alles unter einem Dach. Bei uns geht es nicht nur ums Zocken, sondern um Gemeinschaft, Spaß und Zusammenhalt.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/about" data-testid="hero-cta-about" className="inline-flex items-center gap-2 px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] hover:shadow-[0_0_24px_rgba(41,182,232,0.6)] transition-all">
                  Über den Verein <ArrowRight className="w-4 h-4" />
                </Link>
                <Link to="/events" data-testid="hero-cta-events" className="inline-flex items-center gap-2 px-6 py-3 border border-[#9F7AEA]/50 text-[#C4A7FF] hover:bg-[#9F7AEA]/10 font-bold uppercase tracking-wider rounded-sm transition-all">
                  <Calendar className="w-4 h-4" /> Events
                </Link>
                <Link to="/tournaments" data-testid="hero-cta-tournaments" className="inline-flex items-center gap-2 px-6 py-3 border border-white/15 text-white/70 hover:text-white font-bold uppercase tracking-wider rounded-sm transition-all">
                  <Gamepad2 className="w-4 h-4" /> eSports
                </Link>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }} className="lg:col-span-5 flex items-center justify-center min-w-0">
              <div className="relative">
                <div className="absolute inset-0 bg-[#29B6E8] blur-[80px] opacity-20" />
                <MascotBadge className="relative w-64 h-64 md:w-80 md:h-80 drop-shadow-[0_0_40px_rgba(41,182,232,0.3)]" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {state && (primaryNews || timeline.length > 0) && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid lg:grid-cols-12 gap-5 min-w-0">
            {primaryNews && <FeaturedNews news={primaryNews} />}
            <NextUp items={timeline} wide={!primaryNews} />
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

      {/* Season Pass widget */}
      <SeasonPassWidget />

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

      <SponsorTicker />

      <HomeExplore />

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
    document.head.appendChild(script);
    return () => script.remove();
  }, [state]);
}

function FeaturedNews({ news }) {
  return (
    <Link to={`/news/${news.slug}`} data-testid={`home-featured-news-${news.slug}`} className="lg:col-span-8 group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#111] overflow-hidden grid md:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)] transition min-w-0">
      <div className="aspect-[16/10] md:aspect-auto bg-[#070707] overflow-hidden">
        {news.banner_url ? (
          <img src={resolveMediaUrl(news.banner_url)} alt="" className="w-full h-full object-cover object-center opacity-90 group-hover:scale-105 transition duration-500" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#29B6E8]/20 via-[#101010] to-black" />
        )}
      </div>
      <div className="p-5 md:p-6 flex flex-col justify-center min-w-0">
        <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
          <Newspaper className="w-3 h-3" /> Neueste News {news.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
        </div>
        <h2 className="mt-3 font-heading text-2xl md:text-3xl xl:text-4xl font-black uppercase leading-[1.03] group-hover:text-[#29B6E8] transition break-words line-clamp-6">{news.title}</h2>
        {news.excerpt && <p className="mt-3 text-white/65 line-clamp-3">{news.excerpt}</p>}
        <span className="mt-5 inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold text-white/55 group-hover:text-[#29B6E8]">
          Lesen <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </div>
    </Link>
  );
}

function NextUp({ items, wide = false }) {
  if (!items.length) return (
    <div className={`${wide ? "lg:col-span-12" : "lg:col-span-5"} border border-dashed border-white/15 rounded-sm p-6 text-white/45 min-w-0`}>
      <div className="text-[10px] uppercase tracking-widest font-bold text-white/40">Nächster Termin</div>
      <div className="mt-3 font-heading text-xl font-black uppercase">Aktuell nichts geplant</div>
      <p className="mt-2 text-sm">Sobald News, Events, Turniere oder Fast-Laps gepflegt werden, erscheint hier automatisch der nächste relevante Eintrag.</p>
    </div>
  );
  return (
    <div className={`${wide ? "lg:col-span-12" : "lg:col-span-4"} border border-white/10 rounded-sm bg-[#111] p-5 min-w-0`}>
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="text-[10px] uppercase tracking-widest font-bold text-[#FFD700]">Nächste Termine</div>
        <Link to="/events" className="shrink-0 text-[10px] uppercase tracking-widest font-bold text-white/40 hover:text-[#29B6E8]">Alle Events</Link>
      </div>
      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <Link key={`${item.kind}-${item.id}`} to={item.url} className="flex flex-col sm:flex-row sm:items-center gap-3 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm p-3 bg-black/20 transition min-w-0">
            <KindIcon kind={item.kind} />
            <div className="min-w-0 flex-1">
              <div className="font-heading font-bold leading-tight line-clamp-2">{item.label}</div>
              {item.start_date && <div className="text-xs text-white/45">{new Date(item.start_date).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</div>}
            </div>
            {(item.public_phase || item.status) && <PhaseBadge phase={item.public_phase} status={item.status} className="self-start sm:self-center sm:max-w-[48%]" />}
          </Link>
        ))}
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
          <img src={resolveMediaUrl(news.banner_url)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
        </div>
      ) : (
        <div className={`${featured ? "aspect-[16/8]" : "aspect-video"} bg-gradient-to-br from-[#29B6E8]/20 via-[#0A0A0A] to-[#0A0A0A]`} />
      )}
      <div className="p-4 flex-1">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
          {news.category}
          {news.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
        </div>
        <h3 className={`mt-2 font-heading font-black uppercase leading-tight break-words line-clamp-3 group-hover:text-[#29B6E8] transition ${featured ? "text-xl md:text-2xl" : ""}`}>{news.title}</h3>
        {(news.published_at || news.created_at) && <div className="mt-2 text-[11px] text-white/40">{new Date(news.published_at || news.created_at).toLocaleDateString("de-DE", { dateStyle: "medium" })}</div>}
        {news.excerpt && <p className="mt-2 text-xs text-white/60 line-clamp-3">{news.excerpt}</p>}
      </div>
    </Link>
  );
}

function HomeExplore() {
  const links = [
    { to: "/about", icon: Crown, label: "Verein", text: "Wer wir sind, wofür wir stehen und was THE LION SQUAD ausmacht.", accent: "#FFD700" },
    { to: "/galerie", icon: ImageIcon, label: "Galerie", text: "Fotos und Eindrücke von Events, LANs und Community-Abenden.", accent: "#29B6E8" },
    { to: "/sponsors", icon: Trophy, label: "Sponsoren", text: "Partner und Unterstützer, die unsere Events möglich machen.", accent: "#FFD700" },
    { to: "/contact", icon: ArrowRight, label: "Kontakt", text: "Anfragen, Kooperationen, Sponsoring und allgemeine Nachrichten.", accent: "#9F7AEA" },
  ];
  return (
    <section className="border-y border-white/10 bg-[#080808]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3">
          {links.map(({ to, icon: Icon, label, text, accent }) => (
            <Link key={to} to={to} className="group border border-white/10 hover:border-white/25 rounded-sm bg-[#111] p-5 transition min-h-40 flex flex-col">
              <Icon className="w-5 h-5" style={{ color: accent }} />
              <div className="mt-4 font-heading text-xl font-black uppercase group-hover:text-[#29B6E8] transition">{label}</div>
              <p className="mt-2 text-sm text-white/55 leading-relaxed">{text}</p>
              <span className="mt-auto pt-4 inline-flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-white/45 group-hover:text-[#29B6E8]">
                Öffnen <ArrowRight className="w-3 h-3" />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
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
