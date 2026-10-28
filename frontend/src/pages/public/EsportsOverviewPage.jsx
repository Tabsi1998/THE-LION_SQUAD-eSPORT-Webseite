import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { PublicEmptyState } from "@/components/tls/PublicEmptyState";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { LazyImg } from "@/components/tls/LazyImg";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { GamesShelf } from "@/components/tls/GamesShelf";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatWhen } from "@/lib/datetime";
import { compareByNearestDate, sortByNearestDate } from "@/lib/contentSort";
import { ArrowRight, CalendarDays, Flag, Medal, Radio, Shield, Trophy, Users } from "lucide-react";
import { viennaDate } from "@/lib/vienna";

const ACTIVE_PHASES = new Set(["registration", "check_in", "live", "upcoming"]);
const ACTIVE_STATUSES = new Set(["scheduled", "registration_open", "registration_closed", "check_in", "live"]);

export default function EsportsOverviewPage() {
  useDocumentTitle(
    "eSports",
    "Alle eSports-Aktivitäten von THE LION SQUAD: Turniere, Liga, Fast-Lap-Challenges, Jahreswertung, Live-Brackets und Leaderboards."
  );

  const [tournaments, setTournaments] = useState([]);
  const [fastlaps, setFastlaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tournamentRes, fastlapRes] = await Promise.all([
        api.get("/tournaments?compact=true&limit=48&league=exclude"),
        api.get("/f1/challenges?compact=true&limit=48"),
      ]);
      setTournaments(sortByNearestDate(Array.isArray(tournamentRes.data) ? tournamentRes.data : tournamentRes.data?.items || []));
      setFastlaps(sortByNearestDate(Array.isArray(fastlapRes.data) ? fastlapRes.data : fastlapRes.data?.items || []));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["tournaments", "f1", "seasons"]);
  // Was wir spielen (#1333): dasselbe Spiele-Regal wie auf „Über uns“ - ein Klick öffnet die Turniere des Spiels.
  const [games, setGames] = useState([]);
  useEffect(() => {
    api.get("/home/about").then(({ data }) => setGames(Array.isArray(data?.games) ? data.games : [])).catch(() => setGames([]));
  }, []);
  // Liga (#2122 NW10): eine Kachel, sobald die Person eine Season sehen darf - dieselbe Regel wie der Menüpunkt.
  const [leagues, setLeagues] = useState([]);
  const loadLeagues = useCallback(() => {
    api.get("/leagues").then(({ data }) => setLeagues(Array.isArray(data?.leagues) ? data.leagues : [])).catch(() => setLeagues([]));
  }, []);
  useEffect(() => { loadLeagues(); }, [loadLeagues]);
  useApiInvalidation(loadLeagues, ["leagues", "auth"]);
  const league = leagueTile(leagues);

  const activities = useMemo(() => {
    const rows = [
      ...tournaments.map((item) => ({ ...item, kind: "tournament", label: "Turnier", href: `/tournaments/${item.slug || item.id}` })),
      ...fastlaps.map((item) => ({ ...item, kind: "fastlap", label: "Fast Lap", href: `/fastlap/${item.slug || item.id}` })),
    ];
    return rows.sort(activitySort);
  }, [tournaments, fastlaps]);

  const active = activities.filter((item) => isActiveActivity(item)).slice(0, 6);
  const spotlight = (active.length ? active : activities).slice(0, 3);
  const latestTournaments = tournaments.slice(0, 3);
  const latestFastlaps = fastlaps.slice(0, 3);
  const heroImage = spotlight.find((item) => item.banner_url)?.banner_url || spotlight[0]?.game?.cover_url || "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1600";

  return (
    <PublicLayout>
      <section className="relative overflow-hidden border-b border-white/10">
        <LazyImg src={heroImage} priority alt="" sizes="100vw" className="absolute inset-0 h-full w-full object-cover opacity-35" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/55 via-[#0A0A0A]/78 to-[#0A0A0A]" />
        <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 md:grid-cols-[minmax(0,1fr)_360px] md:py-20 lg:px-8">
          <div className="max-w-3xl self-end">
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">THE LION SQUAD</span>
            <h1 className="mt-3 font-heading text-5xl font-black uppercase leading-none md:text-7xl">eSports</h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/70">
              {league ? "Turniere, Liga, Fast-Lap-Challenges und Jahreswertung an einem Ort." : "Turniere, Fast-Lap-Challenges und Jahreswertung an einem Ort."} Alles, was aktiv ist oder als Nächstes kommt, findest du hier.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/tournaments" className="tls-btn tls-btn--primary inline-flex items-center gap-2 rounded-sm px-5 py-3 text-xs font-bold uppercase tracking-wider">
                Turniere <ArrowRight className="h-4 w-4" />
              </Link>
              {league && (
                <Link to="/liga" data-testid="esports-hero-league" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 rounded-sm px-5 py-3 text-xs font-bold uppercase tracking-wider">
                  Liga <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              <Link to="/fastlap" className="tls-btn tls-btn--quiet inline-flex items-center gap-2 rounded-sm px-5 py-3 text-xs font-bold uppercase tracking-wider">
                Fast Lap <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 self-end md:grid-cols-1">
            <StatCard icon={Trophy} label="Turniere" value={tournaments.length} />
            <StatCard icon={Flag} label="Fast Lap" value={fastlaps.length} />
            <StatCard icon={Radio} label="Aktiv" value={active.length} />
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className={`grid gap-4 ${league ? "sm:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`} data-testid="esports-hub">
          <HubLink to="/tournaments" icon={Trophy} title="Turniere" text="Cups, Brackets, Anmeldung und Ranglisten." />
          {league && <HubLink to="/liga" icon={Shield} title="Liga" text="Jede Woche ein Spieltag, Tabelle nach jeder Runde." badge={league.badge} testId="esports-hub-league" />}
          <HubLink to="/fastlap" icon={Flag} title="Fast Lap" text="Racing-Challenges mit Strecken und Bestzeiten." />
          <HubLink to="/seasons/current" icon={Medal} title="Jahreswertung" text="Punkte, Podien und Saisonstand." />
        </div>

        {games.length > 0 && (
          <section className="mt-12" data-testid="esports-games">
            <SectionHeader eyebrow="Spiele" title="Was wir spielen" action={{ to: "/tournaments", label: "Alle Turniere" }} />
            <GamesShelf games={games} testIdPrefix="esports-game" />
          </section>
        )}

        <section className="mt-12">
          <SectionHeader eyebrow="Aktuell" title="Aktive eSports-Aktivitäten" action={{ to: "/tournaments", label: "Alle Turniere" }} />
          {loading ? (
            <PublicLoadingState cards={3} />
          ) : error ? (
            <PublicEmptyState art="offline" title="Aktivitäten konnten nicht geladen werden" description="Bitte lade die Seite neu oder prüfe später noch einmal." primaryAction={{ label: "Erneut laden", onClick: load }} />
          ) : spotlight.length ? (
            <Reveal className="tls-reveal-grid grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {spotlight.map((item, index) => <ActivityCard key={`${item.kind}-${item.id}`} item={item} index={index} />)}
            </Reveal>
          ) : (
            <PublicEmptyState title="Noch keine Aktivitäten sichtbar" description="Sobald Turniere oder Fast-Lap-Challenges öffentlich sind, erscheint hier automatisch die Übersicht." primaryAction={{ to: "/events", label: "Events ansehen" }} />
          )}
        </section>

        <section className="mt-12 grid gap-8 lg:grid-cols-2">
          <CompactList title="Turniere" items={latestTournaments.map((item) => ({ ...item, kind: "tournament", label: "Turnier", href: `/tournaments/${item.slug || item.id}` }))} empty="Keine Turniere sichtbar" action={{ to: "/tournaments", label: "Turniere öffnen" }} />
          <CompactList title="Fast Lap" items={latestFastlaps.map((item) => ({ ...item, kind: "fastlap", label: "Fast Lap", href: `/fastlap/${item.slug || item.id}` }))} empty="Keine Fast-Lap-Challenges sichtbar" action={{ to: "/fastlap", label: "Fast Lap öffnen" }} />
        </section>
      </main>
    </PublicLayout>
  );
}

function isActiveActivity(item) {
  const phaseState = typeof item.public_phase === "string" ? item.public_phase : item.public_phase?.state;
  return ACTIVE_PHASES.has(phaseState) || ACTIVE_STATUSES.has(item.status);
}

function activitySort(a, b) {
  return compareByNearestDate(
    a.start_date || a.created_at,
    b.start_date || b.created_at,
    a.status,
    b.status,
    a.public_phase,
    b.public_phase,
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-sm border border-white/10 bg-[#0A0A0A]/75 p-4 backdrop-blur">
      <Icon className="h-5 w-5 text-[#29B6E8]" />
      <div className="mt-3 font-heading text-3xl font-black text-white">{value}</div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-white/45">{label}</div>
    </div>
  );
}

/**
 * Die Kachel „Liga“ (#2122 NW10): da, sobald eine Season sichtbar ist. Die Zeile darunter sagt, ob sie läuft oder
 * wann sie startet - die nächste startende Season, sonst die laufende.
 */
export function leagueTile(leagues, now = Date.now()) {
  const seasons = (leagues || []).flatMap((league) => (league.seasons || []).map((season) => ({ ...season, league })));
  if (!seasons.length) return null;
  const running = seasons.find((season) => season.status === "active");
  if (running) return { badge: `Läuft: ${running.name || running.league.name || "Season"}` };
  const upcoming = seasons
    .filter((season) => season.status !== "completed" && season.start_date)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date))
    .find((season) => new Date(season.start_date).getTime() >= now - 24 * 3600 * 1000);
  if (upcoming) return { badge: `Start am ${viennaDate(upcoming.start_date, { day: "numeric", month: "numeric", year: "numeric" })}` };
  return { badge: seasons.some((season) => season.status !== "completed") ? "Startet bald" : "" };
}

function HubLink({ to, icon: Icon, title, text, badge = "", testId }) {
  return (
    <Link to={to} className="tls-card group rounded-sm border border-white/10 bg-[#121212] p-5" data-testid={testId}>
      <div className="flex items-start justify-between gap-4">
        <Icon className="h-6 w-6 text-[#29B6E8]" />
        <ArrowRight className="h-4 w-4 text-white/25 transition group-hover:text-[#29B6E8] group-hover:translate-x-0.5" />
      </div>
      <h2 className="mt-5 font-heading text-2xl font-black uppercase text-white">{title}</h2>
      <p className="mt-2 text-sm leading-relaxed text-white/55">{text}</p>
      {badge && <p className="mt-3 inline-flex rounded-sm border border-honor/40 bg-honor/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-honor" data-testid={testId ? `${testId}-badge` : undefined}>{badge}</p>}
    </Link>
  );
}

function SectionHeader({ eyebrow, title, action }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#29B6E8]">{eyebrow}</div>
        <h2 className="mt-1 font-heading text-3xl font-black uppercase">{title}</h2>
      </div>
      {action && <Link to={action.to} className="text-xs font-bold uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">{action.label}</Link>}
    </div>
  );
}

function ActivityCard({ item, index = 0 }) {
  const image = item.banner_url || item.game?.cover_url || (item.kind === "fastlap" ? "https://images.unsplash.com/photo-1771440571270-e27b63085a48?w=1200" : "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1200");
  return (
    <Link to={item.href} className="tls-card tls-reveal-item group overflow-hidden rounded-sm border border-white/10 bg-[#121212]">
      <div className="relative aspect-video overflow-hidden">
        <LazyImg src={image} priority={index < 2} alt={item.title} sizes="(min-width: 1024px) 33vw, 100vw" className="absolute inset-0 h-full w-full object-cover opacity-45 tls-card__media group-hover:opacity-65" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/45 to-transparent" />
        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <span className="rounded-sm border border-white/15 bg-black/45 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white/75">{item.label}</span>
          <PhaseBadge phase={item.public_phase} status={item.status} />
        </div>
      </div>
      <div className="p-5">
        <h3 className="tls-card__title font-heading text-2xl font-bold leading-tight text-white">{item.title}</h3>
        {item.description && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-white/55">{item.description}</p>}
        <ActivityMeta item={item} />
      </div>
    </Link>
  );
}

function CompactList({ title, items, empty, action }) {
  return (
    <section>
      <SectionHeader eyebrow="Bereich" title={title} action={action} />
      <div className="divide-y divide-white/5 overflow-hidden rounded-sm border border-white/10 bg-[#121212]">
        {items.length ? items.map((item) => (
          <Link key={`${item.kind}-${item.id}`} to={item.href} className="group flex items-center gap-4 p-4 transition hover:bg-white/[0.03]">
            <div className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-white/10 bg-[#0A0A0A]">
              {item.banner_url || item.game?.cover_url ? (
                <LazyImg src={item.banner_url || item.game?.cover_url} alt="" sizes="5rem" className="h-full w-full object-cover opacity-70 transition group-hover:scale-105" />
              ) : item.kind === "fastlap" ? (
                <Flag className="h-6 w-6 text-[#29B6E8]/45" />
              ) : (
                <Trophy className="h-6 w-6 text-[#FFD700]/45" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#29B6E8]">{item.label}</div>
              <div className="mt-1 truncate font-semibold text-white group-hover:text-[#29B6E8]">{item.title}</div>
              <ActivityMeta item={item} compact />
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-white/25 group-hover:text-[#29B6E8]" />
          </Link>
        )) : (
          <div className="p-6 text-sm text-white/45">{empty}</div>
        )}
      </div>
    </section>
  );
}

function ActivityMeta({ item, compact = false }) {
  const classes = compact ? "mt-1 gap-3 text-[11px]" : "mt-4 gap-4 text-xs";
  return (
    <div className={`flex flex-wrap items-center ${classes} text-white/55`}>
      {item.start_date && <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5 text-[#29B6E8]" />{formatWhen(item.start_date)}</span>}
      {item.kind === "fastlap" ? (
        <>
          <span className="inline-flex items-center gap-1.5"><Flag className="h-3.5 w-3.5 text-[#29B6E8]" />{item.track_count || 0} Strecken</span>
          <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-[#29B6E8]" />{item.participant_count || 0} Fahrer</span>
        </>
      ) : (
        <>
          <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-[#29B6E8]" />{item.participant_count || 0}/{item.max_participants || "-"}</span>
          {item.prize_pool && <span className="inline-flex items-center gap-1.5 text-[#FFD700]"><Trophy className="h-3.5 w-3.5" />Preise</span>}
        </>
      )}
    </div>
  );
}
