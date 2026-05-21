import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { Flag, Users, Clock, ChevronRight } from "lucide-react";
import { formatDate, getRegistrationState, hasOnlineRegistration } from "@/lib/datetime";

export default function F1ListPage() {
  const [list, setList] = useState([]);

  const load = useCallback(async () => {
    const { data } = await api.get("/f1/challenges");
    setList(data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useApiInvalidation(load, ["f1"]);

  return (
    <PublicLayout>
      <div className="relative border-b border-white/10 bg-grid-dense overflow-hidden">
        <img src="https://images.unsplash.com/photo-1771440571270-e27b63085a48" className="absolute inset-0 w-full h-full object-cover opacity-20" alt="" loading="lazy" decoding="async" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/70 to-[#0A0A0A]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Fast Lap Challenge</span>
          <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Speed. Rhythmus. Beste Runde.</h1>
          <p className="mt-4 text-white/70 max-w-2xl">Time-Trial Events mit Live-Leaderboards, mehreren Strecken und Championship-Wertung.</p>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-5">
        {list.map((c) => <FastLapCard key={c.id} challenge={c} />)}
        {list.length === 0 && <div className="text-center py-16 text-white/40 font-display tracking-widest">KEINE CHALLENGES VORHANDEN</div>}
      </div>
    </PublicLayout>
  );
}

function FastLapCard({ challenge: c }) {
  const registration = hasOnlineRegistration(c) ? getRegistrationState(c, "Einreichung") : null;
  return (
    <Link
      to={`/fastlap/${c.slug || c.id}`}
      data-testid={`f1-list-${c.slug}`}
      className="group block border border-white/10 hover:border-[#29B6E8]/60 rounded-sm p-6 bg-[#121212] transition-all"
    >
      <div className="flex items-start gap-5">
        {c.banner_url && <img src={resolveMediaUrl(c.banner_url)} alt="" className="w-32 h-20 object-cover rounded-sm hidden sm:block" />}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <PhaseBadge phase={c.public_phase} status={c.status} />
            {c.is_championship && <span className="text-[10px] font-bold uppercase tracking-wider text-[#FFD700] border border-[#FFD700]/40 px-2 py-[3px] rounded-sm">Championship</span>}
            {c.block_club_member_results && <span className="text-[10px] font-bold uppercase tracking-wider text-[#FFD700] border border-[#FFD700]/40 bg-[#FFD700]/10 px-2 py-[3px] rounded-sm">Externe Wertung</span>}
            {c.allow_club_reference_times !== false && c.show_club_reference_times !== false && (c.club_reference_count || 0) > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-white/65 border border-white/15 px-2 py-[3px] rounded-sm">Referenzzeiten</span>
            )}
          </div>
          <h2 className="font-heading text-2xl font-bold group-hover:text-[#29B6E8] transition">{c.title}</h2>
          {c.description && <p className="mt-1 text-sm text-white/60 line-clamp-2">{c.description}</p>}
          <div className="mt-3 flex flex-wrap gap-5 text-xs text-white/60">
            <span className="inline-flex items-center gap-1.5"><Flag className="w-3.5 h-3.5 text-[#29B6E8]" /> {c.track_count} Strecken</span>
            <span className="inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-[#29B6E8]" /> {c.participant_count} Fahrer</span>
            {(c.club_reference_count || 0) > 0 && c.allow_club_reference_times !== false && c.show_club_reference_times !== false && (
              <span className="inline-flex items-center gap-1.5"><Flag className="w-3.5 h-3.5 text-[#FFD700]" /> {c.club_reference_count} Referenzen</span>
            )}
            {c.platform && <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#29B6E8]" /> {c.platform}</span>}
            {c.start_date && <span className="inline-flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#29B6E8]" /> Start {formatDate(c.start_date)}</span>}
          </div>
          {registration && (
            <div className={`mt-3 text-[11px] uppercase tracking-widest font-bold ${
              registration.canRegister ? "text-[#00FF88]" : registration.state === "scheduled" ? "text-[#29B6E8]" : "text-white/45"
            }`}>
              {registration.label}
            </div>
          )}
        </div>
        <ChevronRight className="w-6 h-6 text-white/30 group-hover:text-[#29B6E8] transition" />
      </div>
    </Link>
  );
}
