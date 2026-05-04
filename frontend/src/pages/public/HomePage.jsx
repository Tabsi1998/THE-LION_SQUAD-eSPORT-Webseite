import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentCard } from "@/components/tls/TournamentCard";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { MascotBadge } from "@/components/tls/Logo";
import { SeasonPassWidget } from "@/components/tls/SeasonPassWidget";
import { SponsorTicker } from "@/components/tls/SponsorTicker";
import { motion } from "framer-motion";
import { ArrowRight, Flag, Trophy, Calendar, Newspaper, Crown, Pin, Radio, Users as UsersIcon } from "lucide-react";

export default function HomePage() {
  const [state, setState] = useState(null);

  useEffect(() => {
    api.get("/home/state").then(({ data }) => setState(data)).catch(() => {});
  }, []);

  return (
    <PublicLayout>
      {/* Live Banner — only when something is actually live */}
      {state?.has_live && <LiveBanner state={state} />}

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
          <div className="grid lg:grid-cols-12 gap-8 items-center">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="lg:col-span-7">
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
                <Link to="/membership/join" data-testid="hero-cta-join" className="inline-flex items-center gap-2 px-6 py-3 border border-[#FFD700] text-[#FFD700] font-bold uppercase tracking-wider rounded-sm hover:bg-[#FFD700]/10 transition-all">
                  <Crown className="w-4 h-4" /> Mitglied werden
                </Link>
                <Link to="/tournaments" data-testid="hero-cta-tournaments" className="inline-flex items-center gap-2 px-6 py-3 border border-white/15 text-white/70 hover:text-white font-bold uppercase tracking-wider rounded-sm transition-all">
                  Turniere
                </Link>
              </div>
            </motion.div>
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2 }} className="lg:col-span-5 flex items-center justify-center">
              <div className="relative">
                <div className="absolute inset-0 bg-[#29B6E8] blur-[80px] opacity-20" />
                <MascotBadge className="relative w-64 h-64 md:w-80 md:h-80 drop-shadow-[0_0_40px_rgba(41,182,232,0.3)]" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* TODAY — only shown when something is happening today */}
      {state?.today && hasContent(state.today) && (
        <Section icon={Calendar} accent="#9F7AEA" title="Heute" subtitle="Was heute im Rudel los ist">
          <ItemGrid lists={state.today} variant="today" />
        </Section>
      )}

      {/* SOON */}
      {state?.soon && hasContent(state.soon) && (
        <Section icon={ArrowRight} accent="#29B6E8" title="In Kürze" subtitle="Anmeldung läuft oder bald öffnend">
          <ItemGrid lists={state.soon} variant="soon" />
        </Section>
      )}

      {/* If nothing live/today/soon: show CTA grid */}
      {state && !state.has_live && !hasContent(state.today || {}) && !hasContent(state.soon || {}) && (
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

      {/* News */}
      {state?.news?.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <SectionHeader icon={Newspaper} accent="#29B6E8" title="Aktuelle News" actionLabel="Alle News" actionTo="/news" />
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5 mt-8">
            {state.news.map((n) => (
              <Link key={n.id} to={`/news/${n.slug}`} data-testid={`home-news-${n.slug}`} className="group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] overflow-hidden transition flex flex-col">
                {n.banner_url ? (
                  <div className="aspect-video bg-[#0A0A0A] overflow-hidden"><img src={n.banner_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" /></div>
                ) : (
                  <div className="aspect-video bg-gradient-to-br from-[#29B6E8]/20 via-[#0A0A0A] to-[#0A0A0A]" />
                )}
                <div className="p-4 flex-1">
                  <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
                    {n.category}
                    {n.pinned && <Pin className="w-3 h-3 text-[#FFD700]" />}
                  </div>
                  <h3 className="mt-2 font-heading font-black uppercase line-clamp-2 group-hover:text-[#29B6E8] transition">{n.title}</h3>
                  {n.excerpt && <p className="mt-2 text-xs text-white/60 line-clamp-2">{n.excerpt}</p>}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <SponsorTicker />

      {/* Vereins-CTA */}
      <section className="border-t border-white/10 bg-gradient-to-b from-[#0F0F0F] to-black">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
          <Crown className="w-10 h-10 mx-auto text-[#FFD700] mb-4" />
          <h2 className="font-heading text-3xl md:text-5xl font-black uppercase">Du willst Teil des Rudels werden?</h2>
          <p className="mt-4 text-white/70 max-w-2xl mx-auto">
            Registriere dich, lerne uns kennen und bewirb dich auf eine offizielle Vereinsmitgliedschaft.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link to="/register" className="px-7 py-3.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">Account erstellen</Link>
            <Link to="/membership/join" className="px-7 py-3.5 border-2 border-[#FFD700] text-[#FFD700] font-bold uppercase tracking-wider rounded-sm hover:bg-[#FFD700] hover:text-black transition">Mitglied werden</Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function LiveBanner({ state }) {
  const live = state.live;
  const all = [
    ...(live.tournaments || []).map((x) => ({ ...x, kind: "tournament", url: `/tournaments/${x.slug}` })),
    ...(live.challenges || []).map((x) => ({ ...x, kind: "fastlap", url: `/f1/${x.slug}` })),
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

function Section({ icon: Icon, accent, title, subtitle, children }) {
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.3em] font-bold flex items-center gap-2" style={{ color: accent }}>
            <Icon className="w-3.5 h-3.5" /> {title}
          </div>
          {subtitle && <h2 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">{subtitle}</h2>}
        </div>
      </div>
      {children}
    </section>
  );
}

function ItemGrid({ lists, variant }) {
  const all = [
    ...(lists.tournaments || []).map((x) => ({ ...x, kind: "tournament", url: `/tournaments/${x.slug}`, label: x.title })),
    ...(lists.events || []).map((x) => ({ ...x, kind: "event", url: `/events/${x.slug}`, label: x.name })),
    ...(lists.challenges || []).map((x) => ({ ...x, kind: "fastlap", url: `/f1/${x.slug}`, label: x.title })),
  ];
  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      {all.map((x) => (
        <Link key={`${x.kind}-${x.id}`} to={x.url} data-testid={`home-${variant}-${x.kind}-${x.slug}`} className="group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] p-5 transition flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <KindIcon kind={x.kind} />
            <StatusBadge status={x.status} />
            {x.has_live_stream && <Radio className="w-3 h-3 text-[#FF3B30] animate-pulse" />}
          </div>
          <div className="font-heading font-black text-lg group-hover:text-[#29B6E8] transition line-clamp-2">{x.label}</div>
          {x.start_date && (
            <div className="text-xs text-white/50 inline-flex items-center gap-1.5">
              <Calendar className="w-3 h-3" /> {new Date(x.start_date).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
            </div>
          )}
        </Link>
      ))}
    </div>
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

function hasContent(group) {
  if (!group) return false;
  return Object.values(group).some((arr) => Array.isArray(arr) && arr.length > 0);
}
