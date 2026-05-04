import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatMs } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentCard } from "@/components/tls/TournamentCard";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { MascotBadge } from "@/components/tls/Logo";
import { SeasonPassWidget } from "@/components/tls/SeasonPassWidget";
import { CurrentEventHero } from "@/components/tls/CurrentEventHero";
import { SponsorTicker } from "@/components/tls/SponsorTicker";
import { motion } from "framer-motion";
import { ArrowRight, Flag, Trophy, Zap, Users as UsersIcon } from "lucide-react";

export default function HomePage() {
  const [tournaments, setTournaments] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [events, setEvents] = useState([]);
  const [news, setNews] = useState([]);

  useEffect(() => {
    (async () => {
      const [t, c, e, n] = await Promise.allSettled([
        api.get("/tournaments?limit=6"),
        api.get("/f1/challenges?limit=3"),
        api.get("/events"),
        api.get("/news"),
      ]);
      if (t.status === "fulfilled") setTournaments(t.value.data);
      if (c.status === "fulfilled") setChallenges(c.value.data);
      if (e.status === "fulfilled") setEvents(e.value.data);
      if (n.status === "fulfilled") setNews(n.value.data);
    })();
  }, []);

  return (
    <PublicLayout>
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
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="lg:col-span-7"
            >
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#29B6E8]/10 border border-[#29B6E8]/30 rounded-sm mb-6" data-testid="hero-tag">
                <span className="w-2 h-2 rounded-full bg-[#29B6E8] animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">
                  Powered by The Lion Squad
                </span>
              </div>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-7xl font-black uppercase tracking-tighter leading-[0.95] text-white">
                Die Arena der<br />
                <span className="tls-gradient-text">Lions</span> ist offen.
              </h1>
              <p className="mt-6 text-base md:text-lg text-white/70 max-w-xl leading-relaxed">
                TLS ARENA vereint Turniere, Ligen, Live-Brackets und die legendäre Fast Lap Championship unter einem Dach — mit Lion-Squad-DNA.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to="/tournaments"
                  data-testid="hero-cta-tournaments"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] hover:shadow-[0_0_24px_rgba(41,182,232,0.6)] transition-all"
                >
                  Turniere entdecken <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  to="/f1"
                  data-testid="hero-cta-f1"
                  className="inline-flex items-center gap-2 px-6 py-3 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm hover:bg-[#29B6E8]/10 transition-all"
                >
                  F1 Leaderboards <Flag className="w-4 h-4" />
                </Link>
              </div>
              <div className="mt-10 flex items-center gap-6 text-white/60 text-sm">
                <Stat label="Games" value="6+" />
                <Stat label="Formate" value="10" />
                <Stat label="Live" value={<span className="text-[#FF3B30]">ON AIR</span>} />
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="lg:col-span-5 flex items-center justify-center"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-[#29B6E8] blur-[80px] opacity-20" />
                <MascotBadge className="relative w-64 h-64 md:w-80 md:h-80 drop-shadow-[0_0_40px_rgba(41,182,232,0.3)]" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Live + Tournaments */}
      <CurrentEventHero />

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <SectionHeader title="Aktuelle Turniere" subtitle="Anmeldung offen, Live und beendet" actionLabel="Alle Turniere" actionTo="/tournaments" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-10">
          {tournaments.slice(0, 6).map((t, i) => <TournamentCard key={t.id} tournament={t} index={i} />)}
          {tournaments.length === 0 && (
            <div className="col-span-full text-white/40 text-center py-20 font-display tracking-widest">KEINE TURNIERE VORHANDEN</div>
          )}
        </div>
      </section>

      {/* Season Pass */}
      <SeasonPassWidget />

      {/* Fast Lap */}
      <section className="relative overflow-hidden border-y border-white/10 bg-[#0A0A0A]">
        <div className="absolute inset-0 pointer-events-none">
          <img src="https://images.unsplash.com/photo-1771440571270-e27b63085a48" className="w-full h-full object-cover opacity-20" alt="" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0A0A0A] via-[#0A0A0A]/70 to-[#0A0A0A]/40" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <div className="grid lg:grid-cols-12 gap-10 items-start">
            <div className="lg:col-span-5">
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Fast Lap Challenge</span>
              <h2 className="mt-3 font-heading text-3xl md:text-5xl font-black uppercase leading-tight">Jede Millisekunde zählt.</h2>
              <p className="mt-4 text-white/70 text-base max-w-md">
                Rangliste in Echtzeit. Adminverwaltung der Zeiten. Championship über mehrere Strecken. Bildschirmmodus für TV und Beamer.
              </p>
              <Link to="/f1" data-testid="f1-section-cta" className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 border border-[#29B6E8] text-[#29B6E8] rounded-sm uppercase tracking-wider text-sm font-bold hover:bg-[#29B6E8]/10">
                Zur Rangliste <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
            <div className="lg:col-span-7 space-y-4">
              {challenges.map((c) => (
                <Link
                  key={c.id}
                  to={`/f1/${c.slug || c.id}`}
                  data-testid={`f1-home-${c.slug}`}
                  className="block group border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-5 bg-[#121212] hover:bg-[#18181B] transition-all"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <StatusBadge status={c.status} />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">{c.track_count} Strecken · {c.participant_count} Fahrer</span>
                      </div>
                      <h3 className="font-heading text-xl md:text-2xl font-bold group-hover:text-[#29B6E8] transition">{c.title}</h3>
                      <p className="mt-2 text-sm text-white/60 line-clamp-2">{c.description}</p>
                    </div>
                    <Flag className="w-8 h-8 text-[#29B6E8] shrink-0" />
                  </div>
                </Link>
              ))}
              {challenges.length === 0 && (
                <div className="text-white/40 text-sm">Keine aktiven Challenges.</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Events + News */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid lg:grid-cols-2 gap-10">
          <div>
            <SectionHeader title="Events" subtitle="Vor Ort & Online" actionLabel="Alle" actionTo="/events" />
            <div className="mt-6 space-y-4">
              {events.slice(0, 3).map((e) => (
                <Link
                  key={e.id}
                  to={`/events/${e.slug || e.id}`}
                  data-testid={`event-home-${e.slug}`}
                  className="group flex items-center gap-4 border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-4 bg-[#121212] transition"
                >
                  <div className="w-20 h-20 bg-[#0A0A0A] border border-white/10 rounded-sm overflow-hidden shrink-0">
                    {e.banner_url && <img src={e.banner_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1"><StatusBadge status={e.status || "upcoming"} /></div>
                    <h4 className="font-heading text-lg font-bold group-hover:text-[#29B6E8] transition">{e.name}</h4>
                    <p className="text-sm text-white/60 truncate">{e.location || "Online"}</p>
                  </div>
                </Link>
              ))}
              {events.length === 0 && <div className="text-white/40 text-sm">Keine Events geplant.</div>}
            </div>
          </div>
          <div>
            <SectionHeader title="News" subtitle="Ankündigungen & Updates" actionLabel={null} actionTo={null} />
            <div className="mt-6 space-y-4">
              {news.slice(0, 3).map((n) => (
                <div key={n.id} data-testid={`news-${n.slug}`} className="border border-white/10 rounded-sm p-4 bg-[#121212]">
                  <div className="text-[10px] uppercase tracking-widest text-[#29B6E8] font-bold">
                    {new Date(n.created_at).toLocaleDateString("de-DE")}
                  </div>
                  <h4 className="mt-1 font-heading text-lg font-bold">{n.title}</h4>
                  <p className="mt-1 text-sm text-white/70">{n.excerpt}</p>
                </div>
              ))}
              {news.length === 0 && <div className="text-white/40 text-sm">Keine News.</div>}
            </div>
          </div>
        </div>
      </section>

      {/* Sponsor Ticker */}
      <SponsorTicker />
    </PublicLayout>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="font-display text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-white/40">{label}</div>
    </div>
  );
}

function SectionHeader({ title, subtitle, actionLabel, actionTo }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{subtitle}</span>
        <h2 className="mt-2 font-heading text-3xl md:text-4xl font-black uppercase leading-tight">{title}</h2>
      </div>
      {actionLabel && actionTo && (
        <Link to={actionTo} data-testid={`section-action-${actionTo}`} className="text-sm font-bold uppercase tracking-wider text-[#29B6E8] hover:text-white inline-flex items-center gap-1.5">
          {actionLabel} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      )}
    </div>
  );
}
