import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentTabs } from "@/components/tls/tournament/TournamentTabs";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { SkeletonCards, SkeletonDetailHeader } from "@/components/tls/Skeleton";
import { api } from "@/lib/api";
import { describeResult, freshResults, matchResultSignature } from "@/lib/liveChanges";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useChangedKeys } from "@/hooks/useLiveChanges";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { formatMatchKind, formatMatchStatus, formatScheduleGroupLabel } from "@/lib/tournamentLabels";
import { seoTextPreview } from "@/lib/textPreview";

function formatDateTime(value) {
  if (!value) return "Termin offen";
  return new Date(value).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

// Ein Spieltag ist eine Woche. Die Kopfzeile nennt deshalb den Zeitraum, nicht
// nur die Nummer - "Spieltag 3" allein sagt niemandem, wann gespielt wird.
function formatWeekRange(startsAt, endsAt) {
  if (!startsAt || !endsAt) return "";
  const day = { day: "2-digit", month: "2-digit" };
  const start = new Date(startsAt).toLocaleDateString("de-DE", day);
  const end = new Date(endsAt).toLocaleDateString("de-DE", { ...day, year: "numeric" });
  return `${start} – ${end}`;
}

// Warum dieser Termin gilt. Ohne das steht da eine Uhrzeit, bei der unklar
// bleibt, ob sie vereinbart oder nur die Vorgabe ist.
const SCHEDULE_SOURCE_LABELS = {
  accepted: "vereinbart",
  home: "Heimrecht",
  default: "Standardzeit",
  manual: "von der Turnierleitung",
};

function stationLabel(match) {
  return match?.station_label || match?.station_name || match?.station?.name || match?.station_id || "";
}

function participantLabel(slot, registrations) {
  const reg = registrations[slot.registration_id] || {};
  return reg.display_name || reg.ingame_name || reg.user?.display_name || slot.source?.raw || "Offen";
}

function duelLabels(match, registrations) {
  const a = registrations[match.participant_a_id] || {};
  const b = registrations[match.participant_b_id] || {};
  return [
    a.display_name || a.ingame_name || "Offen",
    b.display_name || b.ingame_name || "Offen",
  ];
}

export default function TournamentSchedulePage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState(null);
  const [activeMatchday, setActiveMatchday] = useState(null);

  const load = useCallback(async () => {
    const accessConfig = { params: accessToken ? { access: accessToken } : undefined };
    const { data: tournament } = await api.get(`/tournaments/${slug}`, accessConfig);
    const { data: bracket } = await api.get(`/tournaments/${tournament.id}/bracket`, accessConfig);
    setData(bracket);
    // Spielwochen gibt es nur bei Liga, Round Robin und Gruppen. Schlägt der
    // Aufruf fehl, bleibt die bisherige Gruppierung stehen statt einer leeren Seite.
    try {
      const { data: matchdayPlan } = await api.get(`/tournaments/${tournament.id}/matchdays`, accessConfig);
      setPlan(matchdayPlan);
    } catch {
      setPlan({ applies: false, matchdays: [] });
    }
  }, [slug, accessToken]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, ["tournaments", "matches", "matches-v2"], { fallbackMs: 7000 });

  // Frisch eingetragene Ergebnisse tragen kurz „gerade eingetragen“, und unten steht ein
  // Hinweis mit dem Ergebnis - auch für Zuschauer (#225). Beim ersten Laden nichts davon.
  const allMatches = useMemo(() => [...(data?.matches_v2 || []), ...(data?.matches || [])], [data]);
  const changedMatches = useChangedKeys(allMatches, (match) => match.id, matchResultSignature);
  const previousMatches = useRef(null);
  useEffect(() => {
    const before = previousMatches.current;
    previousMatches.current = allMatches;
    if (!before || !data) return;
    const registrations = Object.fromEntries((data.registrations || []).map((r) => [r.id, r]));
    for (const match of freshResults(before, allMatches).slice(0, 3)) {
      toast(describeResult(match, registrations), { id: `result-${match.id}`, duration: 6000 });
    }
  }, [allMatches, data]);

  const groups = useMemo(() => {
    const tournament = data?.tournament || {};
    const registrations = Object.fromEntries((data?.registrations || []).map((r) => [r.id, r]));
    const multiSlotRows = (data?.matches_v2 || []).map((match) => ({
      ...match,
      matchday: match.matchday_number || match.round || 0,
      matchdayLabel: formatScheduleGroupLabel(match, tournament),
      labels: (match.slots || []).map((slot) => participantLabel(slot, registrations)),
    }));
    const duelRows = (data?.matches || []).map((match) => ({
      ...match,
      matchday: match.round || 0,
      matchdayLabel: match.round_name || (match.round ? `Runde ${match.round}` : "Ohne Runde"),
      labels: duelLabels(match, registrations),
    }));
    const rows = [...multiSlotRows, ...duelRows];
    const byDay = new Map();
    rows.forEach((match) => {
      const key = `${match.matchday}:${match.matchdayLabel}`;
      if (!byDay.has(key)) byDay.set(key, { key, label: match.matchdayLabel, matches: [] });
      byDay.get(key).matches.push(match);
    });
    return [...byDay.values()].sort((a, b) => Number(a.key.split(":")[0]) - Number(b.key.split(":")[0]));
  }, [data]);

  const weeks = useMemo(() => (plan?.applies ? (plan.matchdays || []) : []), [plan]);
  const suggestedMatchday = plan?.current ?? null;
  // Beim Öffnen die Woche zeigen, die gerade gespielt wird - nicht Spieltag 1
  // einer Liga, die im März angefangen hat. Beim Neuladen alle sieben Sekunden
  // bleibt die gewählte Woche stehen, damit einem nichts wegspringt.
  useEffect(() => {
    if (!weeks.length) return;
    setActiveMatchday((current) => (
      current != null && weeks.some((week) => week.number === current)
        ? current
        : (suggestedMatchday ?? weeks[0].number)
    ));
  }, [suggestedMatchday, weeks]);

  const resolvedByMatch = useMemo(() => {
    const map = {};
    for (const week of weeks) {
      for (const entry of week.matches || []) map[entry.match_id] = entry;
    }
    return map;
  }, [weeks]);

  const weekIndex = weeks.findIndex((week) => week.number === activeMatchday);
  const currentWeek = weekIndex >= 0 ? weeks[weekIndex] : null;
  const weekMatches = useMemo(() => {
    if (!currentWeek) return [];
    const wanted = new Set((currentWeek.matches || []).map((entry) => entry.match_id));
    return groups.flatMap((group) => group.matches).filter((match) => wanted.has(match.id));
  }, [currentWeek, groups]);

  const tournament = data?.tournament || {};
  const tournamentUrl = `/tournaments/${tournament.slug || tournament.id}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`;
  const seoDescription = seoTextPreview(tournament.description, "Spielplan des eSports Turniers mit Runden, Heats, Zeiten und Matchseiten.");
  useDocumentTitle(`${tournament.title || "Turnier"} Spielplan`, seoDescription, {
    image: tournament.banner_url,
    canonical: tournament.slug ? `${window.location.origin}/tournaments/${tournament.slug}/matches` : undefined,
  });
  useCanonicalSlugRedirect(slug, tournament.slug, "/tournaments", "/matches");

  if (!data) {
    return (
      <PublicLayout>
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
          <SkeletonDetailHeader label="Lade Spielplan" />
          <SkeletonCards count={6} columns={3} image={false} label="Lade Spielplan" />
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Turniere", to: "/tournaments" },
            { label: tournament.title, to: tournamentUrl },
            { label: "Spielplan" },
          ]}
          className="mb-3"
        />
        <Link to={tournamentUrl} className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] hover:text-white">← Zurück zum Turnier</Link>
        <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase">Spielplan</h1>
        <p className="mt-3 text-white/60 max-w-2xl">Alle Runden, Heats, Zeiten und öffentlichen Matchseiten für Terminabstimmung, Chat und Ergebnisstatus.</p>
        <TournamentTabs tournament={tournament} accessToken={accessToken} className="mt-5" />

        {currentWeek ? (
          <div className="mt-10" data-testid="matchday-pager">
            <div className="flex items-center justify-between gap-3 border border-white/10 bg-[#121212] rounded-sm px-3 py-3">
              <button
                type="button"
                onClick={() => setActiveMatchday(weeks[weekIndex - 1].number)}
                disabled={weekIndex <= 0}
                data-testid="matchday-prev"
                aria-label="Vorheriger Spieltag"
                className="p-2 rounded-sm border border-white/10 text-white/70 enabled:hover:border-[#29B6E8]/50 enabled:hover:text-white disabled:opacity-30"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="text-center min-w-0">
                <div className="font-heading text-xl md:text-2xl font-black uppercase truncate" data-testid="matchday-title">
                  Spieltag {currentWeek.number}
                </div>
                <div className="mt-0.5 text-xs text-white/55 tabular-nums" data-testid="matchday-range">
                  {formatWeekRange(currentWeek.starts_at, currentWeek.ends_at)}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-widest text-white/30">
                  {weekIndex + 1} von {weeks.length}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveMatchday(weeks[weekIndex + 1].number)}
                disabled={weekIndex >= weeks.length - 1}
                data-testid="matchday-next"
                aria-label="Nächster Spieltag"
                className="p-2 rounded-sm border border-white/10 text-white/70 enabled:hover:border-[#29B6E8]/50 enabled:hover:text-white disabled:opacity-30"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="matchday-matches">
              {weekMatches.map((match) => (
                <MatchCard key={match.id} match={match} resolved={resolvedByMatch[match.id]} changed={changedMatches.has(match.id)} />
              ))}
              {weekMatches.length === 0 && (
                <div className="md:col-span-2 xl:col-span-3 border border-dashed border-white/15 rounded-sm p-8 text-center text-white/45">
                  Für diesen Spieltag liegen keine Partien vor.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-10 space-y-8">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="font-heading text-2xl font-black uppercase flex items-center gap-2"><CalendarClock className="w-5 h-5 text-[#29B6E8]" /> {group.label}</h2>
                <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {group.matches.map((match) => (
                    <MatchCard key={match.id} match={match} resolved={resolvedByMatch[match.id]} changed={changedMatches.has(match.id)} />
                  ))}
                </div>
              </section>
            ))}
            {groups.length === 0 && <div className="border border-dashed border-white/15 rounded-sm p-12 text-center text-white/45">Noch kein Spielplan generiert.</div>}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function MatchCard({ match, resolved, changed = false }) {
  // Der berechnete Termin geht vor: bei Spielwochen steht er auch dann fest,
  // wenn noch niemand etwas vereinbart hat, weil dann die Standardzeit gilt.
  // Seit #235 steht der geltende Termin samt Quelle auch in der Partie selbst.
  const scheduledAt = resolved?.scheduled_at || match.scheduled_at;
  const sourceLabel = SCHEDULE_SOURCE_LABELS[match.schedule_source === "manual" ? "manual" : resolved?.schedule_source || match.schedule_source];
  return (
    <Link
      to={`/matches/${match.id}`}
      data-testid={`schedule-match-${match.id}`}
      data-changed={changed ? "true" : undefined}
      className={`border border-white/10 hover:border-[#29B6E8]/50 bg-[#121212] rounded-sm p-4 transition ${changed ? "tls-changed" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-white/40">{formatMatchKind(match)} {match.match_key || ""}</div>
          <div className="mt-1 font-heading font-bold uppercase line-clamp-2">{match.labels.join(" vs. ")}</div>
        </div>
        <span className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] uppercase tracking-widest text-[#FFD700] font-bold">{formatMatchStatus(match.schedule_status || match.status)}</span>
          {changed && <span className="tls-new-chip" data-testid={`schedule-fresh-${match.id}`}>gerade eingetragen</span>}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm text-white/55">{formatDateTime(scheduledAt)}</span>
        {sourceLabel && (
          <span className="text-[10px] uppercase tracking-widest text-white/35" data-testid={`schedule-source-${match.id}`}>
            {sourceLabel}
          </span>
        )}
      </div>
      {stationLabel(match) && (
        <div className="mt-1 text-xs font-bold uppercase tracking-wider text-[#29B6E8]">Station {stationLabel(match)}</div>
      )}
    </Link>
  );
}
