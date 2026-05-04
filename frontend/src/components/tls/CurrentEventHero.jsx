import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { motion } from "framer-motion";
import { Calendar, Users, MapPin, ArrowRight, Flame, Flag, Trophy } from "lucide-react";
import { StatusBadge } from "./StatusBadge";

/**
 * CurrentEventHero — Prominent hero card on home.
 * Shows the most relevant upcoming/live event (tournament or F1 challenge).
 * Priority: live > registration_open > upcoming (sorted by start_date/created_at).
 */
export function CurrentEventHero() {
  const [data, setData] = useState({ tournaments: [], challenges: [], loading: true });

  useEffect(() => {
    (async () => {
      try {
        const [t, c] = await Promise.all([
          api.get("/tournaments"),
          api.get("/f1/challenges"),
        ]);
        setData({ tournaments: t.data, challenges: c.data, loading: false });
      } catch {
        setData({ tournaments: [], challenges: [], loading: false });
      }
    })();
  }, []);

  if (data.loading) return null;

  const featured = pickFeatured(data.tournaments, data.challenges);
  if (!featured) return null;

  const { kind, item } = featured;
  const href = kind === "f1" ? `/f1/${item.slug || item.id}` : `/tournaments/${item.slug || item.id}`;
  const maxP = item.max_participants || 0;
  const curP = item.participant_count || 0;
  const spotsLeft = maxP && curP < maxP ? maxP - curP : null;
  const startDate = item.start_date ? new Date(item.start_date) : null;

  return (
    <section className="relative overflow-hidden border-b border-white/10" data-testid="current-event-hero">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -left-20 w-[600px] h-[600px] rounded-full bg-[#29B6E8] blur-[160px] opacity-15" />
        <div className="absolute -bottom-40 -right-20 w-[600px] h-[600px] rounded-full bg-[#FF3B30] blur-[160px] opacity-10" />
      </div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="grid lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#FF3B30]/10 border border-[#FF3B30]/40 rounded-sm mb-4">
              <Flame className="w-3.5 h-3.5 text-[#FF3B30]" />
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#FF3B30]">
                {item.status === "live" ? "Läuft gerade" : item.status === "registration_open" ? "Anmeldung offen" : item.status === "check_in" ? "Check-in läuft" : "Bald startend"}
              </span>
            </div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] inline-flex items-center gap-2">
              {kind === "f1" ? <><Flag className="w-3 h-3" /> F1 Fast Lap Challenge</> : <><Trophy className="w-3 h-3" /> Featured Tournament</>}
            </span>
            <h2 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase leading-[0.95] tracking-tight">
              {item.title}
            </h2>
            {item.description && (
              <p className="mt-4 text-white/75 text-base md:text-lg max-w-2xl leading-relaxed">
                {item.description}
              </p>
            )}
            <div className="mt-6 flex flex-wrap gap-4 text-sm">
              {startDate && (
                <Meta icon={Calendar} label={startDate.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "long" })} />
              )}
              {maxP > 0 && (
                <Meta icon={Users} label={spotsLeft ? `${spotsLeft} Plätze frei · ${curP}/${maxP}` : `${curP}/${maxP} voll`} highlight={spotsLeft && spotsLeft <= 4} />
              )}
              {item.location && <Meta icon={MapPin} label={item.location} />}
            </div>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to={href} data-testid="hero-cta-primary" className="inline-flex items-center gap-2 px-6 py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] transition">
                {item.status === "registration_open" ? "Jetzt anmelden" : "Details ansehen"} <ArrowRight className="w-4 h-4" />
              </Link>
              <StatusBadge status={item.status} size="lg" />
            </div>
          </div>
          {/* Right: mini card with prize preview if available */}
          <div className="lg:col-span-5">
            <div className="relative border border-[#29B6E8]/30 bg-gradient-to-br from-[#29B6E8]/10 via-transparent to-[#FFD700]/5 rounded-sm p-6">
              <div className="text-[10px] uppercase tracking-[0.3em] font-bold text-[#FFD700] flex items-center gap-2"><Trophy className="w-3.5 h-3.5" /> Preise</div>
              {(item.prize_places || []).length > 0 ? (
                <div className="mt-4 space-y-2">
                  {item.prize_places.slice(0, 4).map((p) => (
                    <div key={p.place} className="flex items-center gap-3">
                      <span className={`font-display text-2xl font-black w-10 tabular-nums ${p.place === 1 ? "text-[#FFD700]" : p.place === 2 ? "text-white/80" : p.place === 3 ? "text-[#CD7F32]" : "text-[#29B6E8]"}`}>
                        {p.place}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-heading text-base md:text-lg font-bold text-white truncate">{p.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : item.prize_pool ? (
                <p className="mt-4 text-white/80 text-sm whitespace-pre-line">{item.prize_pool}</p>
              ) : (
                <p className="mt-4 text-white/50 text-sm">Preise werden in Kürze bekannt gegeben.</p>
              )}
              <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
                <span className="text-[10px] uppercase tracking-widest text-white/40">{kind === "f1" ? "Modus" : "Format"}</span>
                <span className="font-heading font-bold uppercase text-[#29B6E8]">
                  {kind === "f1" ? (item.is_championship ? "Championship" : "Single Day") : (item.format || "").replace("_", " ")}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function Meta({ icon: Icon, label, highlight = false }) {
  return (
    <div className={`inline-flex items-center gap-2 border rounded-sm px-3 py-1.5 ${highlight ? "border-[#FF3B30]/40 text-[#FF3B30]" : "border-white/10 text-white/70"}`}>
      <Icon className="w-3.5 h-3.5" />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function pickFeatured(tournaments = [], challenges = []) {
  const priority = { live: 0, check_in: 1, registration_open: 2, upcoming: 3, draft: 9, completed: 10, archived: 11 };
  const rank = (s) => priority[s] ?? 5;
  const items = [
    ...tournaments.map((t) => ({ kind: "tournament", item: t })),
    ...challenges.map((c) => ({ kind: "f1", item: c })),
  ];
  items.sort((a, b) => {
    const r = rank(a.item.status) - rank(b.item.status);
    if (r !== 0) return r;
    const da = a.item.start_date ? new Date(a.item.start_date).getTime() : Infinity;
    const db = b.item.start_date ? new Date(b.item.start_date).getTime() : Infinity;
    return da - db;
  });
  return items[0] || null;
}
