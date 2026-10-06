import { Link } from "react-router-dom";
import { PhaseBadge } from "./PhaseBadge";
import { ArrowRight, Calendar, Users, Trophy } from "lucide-react";
import { formatDate, getRegistrationState } from "@/lib/datetime";
import { formatTournamentDisplay } from "@/lib/tournamentLabels";
import { LazyImg } from "@/components/tls/LazyImg";

// Nach dem Ende sagt die Plakette oben, wie es ausging - „Anmeldung geschlossen“ wäre dort nur Lärm (#833).
const FINISHED = new Set(["completed", "results_published", "archived", "cancelled"]);

/** Was der Fuß der Karte anbietet (#833): ein Knopf - mitmachen, Ergebnisse oder ansehen. */
export function cardAction(tournament, registration) {
  if (registration.canRegister) return "Mitmachen";
  if (["completed", "results_published", "archived"].includes(tournament?.status)) return "Ergebnisse";
  return "Ansehen";
}

/** Spiel-Kürzel und Plattform - der Trennpunkt nur, wenn es beides gibt (#833). */
export function gameLine(tournament) {
  return [tournament?.game?.short_name, tournament?.platform].map((part) => String(part || "").trim()).filter(Boolean);
}

export function TournamentCard({ tournament, index = 0 }) {
  const t = tournament;
  const registration = getRegistrationState(t, "Anmeldung");
  const finished = FINISHED.has(t.status);
  const formatLabel = formatTournamentDisplay(t);
  const line = gameLine(t);
  const bg = t.banner_url || t.game?.cover_url ||
    "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200";

  return (
    <Link
      to={`/tournaments/${t.slug || t.id}`}
      data-testid={`tournament-card-${t.slug}`}
      data-live={t.public_phase?.state === "live" ? "1" : undefined}
      className={`tls-card group relative block overflow-hidden rounded-sm border border-white/10 bg-[#18181B] ${t.public_phase?.state === "live" ? "tls-live-frame" : ""}`}
    >
      <div className="aspect-[16/9] relative overflow-hidden">
        <LazyImg
          src={bg}
          priority={index < 2}
          sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
          alt={t.title}
          className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 tls-card__media"
        />
        {/* Die Grafik bleibt sichtbar (#833): oben ein Schleier für die Plaketten, unten der Übergang in die Karte. */}
        <div className="absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#18181B]/90 to-transparent" />
        <div className="absolute top-3 inset-x-3 flex flex-col items-start gap-1.5 sm:flex-row sm:items-start sm:justify-between">
          <PhaseBadge phase={t.public_phase} status={t.status} className="max-w-full sm:max-w-[68%]" />
          {formatLabel && formatLabel !== "—" ? (
            <span className="max-w-full sm:max-w-[48%] text-[10px] font-bold uppercase tracking-wider text-[#29B6E8] bg-black/55 border border-[#29B6E8]/40 px-2 py-1 rounded-sm leading-tight break-words" data-testid="tournament-card-format">
              {formatLabel}
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-4 md:p-5">
        {line.length ? (
          <div className="flex items-center gap-2 mb-2" data-testid="tournament-card-game">
            {t.game?.short_name && (
              <span className="text-[11px] font-bold text-[#29B6E8] uppercase tracking-wider">
                {t.game.short_name}
              </span>
            )}
            {t.game?.short_name && t.platform ? <span className="text-white/25 text-xs" aria-hidden="true">·</span> : null}
            {t.platform && <span className="text-white/40 text-xs">{t.platform}</span>}
          </div>
        ) : null}
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
        {finished ? null : (
          <div className={`mt-3 text-[11px] uppercase tracking-widest font-bold ${
            registration.canRegister ? "text-[#00FF88]" : registration.state === "scheduled" ? "text-[#29B6E8]" : "text-white/45"
          }`} data-testid="tournament-card-registration">
            {registration.label}
          </div>
        )}
        {/* Ein Knopf statt „Turnierdetails … Ansehen“ (#833). */}
        <div className="mt-4 flex items-center justify-end gap-3 border-t border-white/10 pt-3">
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]" data-testid="tournament-card-action">
            {cardAction(t, registration)} <ArrowRight className="w-3 h-3 transition-transform duration-300 group-hover:translate-x-1" />
          </span>
        </div>
      </div>
    </Link>
  );
}
