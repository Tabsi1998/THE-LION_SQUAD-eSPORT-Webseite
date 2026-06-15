import { Link } from "react-router-dom";
import { PhaseBadge } from "./PhaseBadge";
import { ArrowRight, Calendar, Users, Trophy } from "lucide-react";
import { formatDate, getRegistrationState } from "@/lib/datetime";
import { formatTournamentDisplay } from "@/lib/tournamentLabels";
import { LazyImg } from "@/components/tls/LazyImg";

export function TournamentCard({ tournament, index = 0 }) {
  const t = tournament;
  const registration = getRegistrationState(t, "Anmeldung");
  const bg = t.banner_url || t.game?.cover_url ||
    "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200";

  return (
    <Link
      to={`/tournaments/${t.slug || t.id}`}
      data-testid={`tournament-card-${t.slug}`}
      className="group relative block overflow-hidden rounded-sm border border-white/10 hover:border-[#29B6E8]/60 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_24px_rgba(41,182,232,0.25)] bg-[#18181B]"
    >
      <div className="aspect-[16/9] relative overflow-hidden">
        <LazyImg
          src={bg}
          priority={index < 2}
          sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
          alt={t.title}
          className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-60 group-hover:scale-105 transition-all duration-500"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/70 to-transparent" />
        <div className="absolute top-3 inset-x-3 flex flex-col items-start gap-1.5 sm:flex-row sm:items-start sm:justify-between">
          <PhaseBadge phase={t.public_phase} status={t.status} className="max-w-full sm:max-w-[68%]" />
          <span className="max-w-full sm:max-w-[48%] text-[10px] font-bold uppercase tracking-wider text-[#29B6E8] bg-[#29B6E8]/10 border border-[#29B6E8]/30 px-2 py-1 rounded-sm leading-tight break-words">
            {formatTournamentDisplay(t)}
          </span>
        </div>
      </div>
      <div className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-2">
          {t.game?.short_name && (
            <span className="text-[11px] font-bold text-[#29B6E8] uppercase tracking-wider">
              {t.game.short_name}
            </span>
          )}
          {t.platform && <span className="text-white/40 text-xs">· {t.platform}</span>}
        </div>
        <h3 className="font-heading font-bold text-xl text-white group-hover:text-[#29B6E8] transition-colors line-clamp-2">
          {t.title}
        </h3>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-white/60">
          {t.start_date && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(t.start_date)}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users className="w-3.5 h-3.5" />
            {t.participant_count || 0}/{t.max_participants}
          </span>
          {t.prize_pool && (
            <span className="inline-flex items-center gap-1 text-[#FFD700]">
              <Trophy className="w-3.5 h-3.5" />
              Preise
            </span>
          )}
        </div>
        <div className={`mt-3 text-[11px] uppercase tracking-widest font-bold ${
          registration.canRegister ? "text-[#00FF88]" : registration.state === "scheduled" ? "text-[#29B6E8]" : "text-white/45"
        }`}>
          {registration.label}
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3">
          <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">
            {registration.canRegister ? "Anmeldung" : "Turnierdetails"}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">
            {registration.canRegister ? "Mitmachen" : "Ansehen"} <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </div>
    </Link>
  );
}
