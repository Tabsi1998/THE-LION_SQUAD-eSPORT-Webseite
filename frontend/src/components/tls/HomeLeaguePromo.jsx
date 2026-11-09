// Startseite (#2324): Hinweis, solange eine Liga-Anmeldung offen ist - Emblem, Season-Banner, Anmeldeschluss, freie Plätze und
// der Knopf „Mit Co-Team anmelden“. Nach dem Anmeldeschluss verschwindet die Karte von selbst (ohne Neuladen); mehrere offene
// Seasons stehen kompakt nebeneinander. Welche Season hier steht, entscheidet der Server (sichtbar wie die Ligaseite, Schalter
// „Auf der Startseite bewerben“).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarClock, Users } from "lucide-react";
import { LazyImg } from "@/components/tls/LazyImg";
import { Reveal } from "@/components/tls/Reveal";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { accentStyle, bannerFocus } from "@/lib/leagueLook";
import { deadlineText, nextDeadline, openSignups, periodLine } from "@/lib/leagueHome";
import { seatsLine } from "@/lib/leagueApplications";

// setTimeout trägt höchstens rund 24,8 Tage - weiter weg rechnet die Karte nach dieser Zeit noch einmal.
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Kein Platz mehr und keine Warteliste: Anmelden geht nicht, die Ligaseite schon. */
function isFull(block) {
  return Boolean(block?.slots) && !block.slots_free && (!block.waitlist || block.waitlist_full);
}

function PromoCard({ row, index, compact }) {
  const block = row.application;
  const seats = seatsLine(block);
  const banner = row.banner?.url ? row.banner : null;
  const period = periodLine(row);
  return (
    <article className="tls-league-promo tls-reveal-item" data-compact={compact ? "true" : "false"}
      style={{ ...accentStyle(row.accent_color), "--tls-i": index + 1 }} data-testid={`home-league-promo-${row.slug}`}>
      {banner ? (
        <div className="tls-league-promo__banner" style={bannerFocus(banner)} aria-hidden="true">
          <LazyImg src={banner.url} alt="" sizes="(min-width: 1024px) 520px, 100vw" className="tls-league-promo__img" />
        </div>
      ) : null}
      <div className="tls-league-promo__body">
        <LeagueEmblem src={row.emblem_url} size={compact ? 52 : 72} testId={`home-league-promo-emblem-${row.slug}`} />
        <div className="min-w-0 flex-1">
          <p className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-ok">
            <span className="h-2 w-2 shrink-0 rounded-full bg-ok motion-safe:animate-pulse" aria-hidden="true" />
            Liga · Anmeldung offen
          </p>
          <h2 className={`mt-1.5 font-heading font-black uppercase leading-[0.95] text-white break-words ${compact ? "text-xl md:text-2xl" : "text-2xl md:text-4xl"}`}>
            {row.title}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-white/80">
            <li className="inline-flex items-center gap-1.5" data-testid={`home-league-promo-deadline-${row.slug}`}>
              <CalendarClock className="h-4 w-4 shrink-0 tls-league-accent" aria-hidden="true" />
              <span>Anmeldeschluss: <span className="font-semibold text-white tabular-nums">{deadlineText(block.closes_at)}</span></span>
            </li>
            {seats ? (
              <li className="inline-flex items-center gap-1.5 tabular-nums" data-testid={`home-league-promo-seats-${row.slug}`}>
                <Users className="h-4 w-4 shrink-0 tls-league-accent" aria-hidden="true" /> {seats}
              </li>
            ) : null}
          </ul>
          {period || block.entry_policy === "members" ? (
            <p className="mt-1.5 text-xs text-white/55">
              {[period ? `Season ${period}` : "", block.entry_policy === "members" ? "Nur für Vereinsmitglieder" : ""].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
        <div className="tls-league-promo__actions">
          {!isFull(block) ? (
            <Link to={row.apply_url} data-testid={`home-league-promo-apply-${row.slug}`}
              className="tls-btn tls-btn--primary inline-flex min-h-[44px] items-center justify-center rounded-sm px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
              Mit Co-Team anmelden
            </Link>
          ) : null}
          <Link to={row.url} data-testid={`home-league-promo-page-${row.slug}`}
            className="group/more tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
            Zur Ligaseite <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 motion-safe:group-hover/more:translate-x-0.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </article>
  );
}

export function HomeLeaguePromo({ leagues }) {
  const [now, setNow] = useState(() => Date.now());
  const rows = openSignups(leagues, now);
  const next = nextDeadline(leagues, now);

  // Zum nächsten Anmeldeschluss neu rechnen: Die Karte geht dann ohne Neuladen weg.
  useEffect(() => {
    if (!next) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(MAX_TIMER_MS, Math.max(0, next - Date.now()) + 500));
    return () => clearTimeout(timer);
  }, [next]);

  if (!rows.length) return null;
  const compact = rows.length > 1;
  return (
    <Reveal as="section" className="border-b border-white/10 bg-[#080808]/35" aria-label="Liga-Anmeldung offen" data-testid="home-league-promo">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 md:py-10 min-w-0">
        <div className={`grid min-w-0 gap-4 ${compact ? "lg:grid-cols-2" : ""}`}>
          {rows.map((row, index) => <PromoCard key={row.id} row={row} index={index} compact={compact} />)}
        </div>
      </div>
    </Reveal>
  );
}
