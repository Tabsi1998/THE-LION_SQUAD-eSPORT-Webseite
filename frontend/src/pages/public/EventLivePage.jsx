import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Activity, CalendarClock, CheckCircle2, Flag, MapPin, Monitor, Radio, RotateCw, Trophy, Users } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { PublicEmptyState } from "@/components/tls/PublicEmptyState";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { PhaseBadge } from "@/components/tls/PhaseBadge";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { sortByNearestDate } from "@/lib/contentSort";
import { formatMatchKind, formatMatchStatus, formatScheduleGroupLabel } from "@/lib/tournamentLabels";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { seoTextPreview } from "@/lib/textPreview";

const ACTIVE_MATCH_STATUSES = new Set(["in_progress", "running", "waiting_result", "disputed"]);
const NEXT_MATCH_STATUSES = new Set(["ready", "scheduled", "pending", "preview"]);
const DONE_MATCH_STATUSES = new Set(["completed", "forfeit", "bye", "no_show"]);
const BUSY_STATION_STATUSES = new Set(["busy", "reserved", "in_use"]);

function accessParams(accessToken) {
  return accessToken ? { params: { access: accessToken } } : undefined;
}

function stationLabel(match, stationMap) {
  const station = stationMap.get(match.station_id);
  return match.station_label || match.station_name || match.station?.name || station?.name || match.station_id || "";
}

function parseTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function matchSortValue(match) {
  return parseTime(match.scheduled_at || match.started_at || match.updated_at || match.created_at) || Number.MAX_SAFE_INTEGER;
}

function participantLabel(registration) {
  return registration?.display_name || registration?.ingame_name || registration?.user?.display_name || registration?.user?.username || "Offen";
}

function slotLabel(slot, registrationMap) {
  const registration = registrationMap.get(slot.registration_id);
  return participantLabel(registration) || slot.source?.raw || "Offen";
}

function legacyLabels(match, registrationMap) {
  return [
    participantLabel(registrationMap.get(match.participant_a_id)),
    participantLabel(registrationMap.get(match.participant_b_id)),
  ];
}

function resultLine(match, registrationMap) {
  if (Array.isArray(match.results) && match.results.length) {
    return match.results
      .slice()
      .sort((a, b) => Number(a.rank || 999) - Number(b.rank || 999))
      .slice(0, 4)
      .map((result) => {
        const name = participantLabel(registrationMap.get(result.registration_id));
        const score = result.points ?? result.score;
        return `${result.rank ? `${result.rank}. ` : ""}${name}${score != null ? ` (${score})` : ""}`;
      })
      .join(" | ");
  }
  const winner = registrationMap.get(match.winner_id);
  if (winner) return `Sieger: ${participantLabel(winner)}`;
  if (match.score_a != null || match.score_b != null) return `${match.score_a ?? 0}:${match.score_b ?? 0}`;
  return "";
}

function normalizeBracketRows(payload) {
  const tournament = payload?.tournament || {};
  const registrationMap = new Map((payload?.registrations || []).map((registration) => [registration.id, registration]));

  const v2Rows = (payload?.matches_v2 || []).map((match) => ({
    ...match,
    tournament,
    labels: (match.slots || []).map((slot) => slotLabel(slot, registrationMap)).filter(Boolean),
    groupLabel: formatScheduleGroupLabel(match, tournament),
    resultText: resultLine(match, registrationMap),
    source: "v2",
  }));

  const legacyRows = (payload?.matches || []).map((match) => ({
    ...match,
    tournament,
    labels: legacyLabels(match, registrationMap),
    groupLabel: match.round_name || (match.round ? `Runde ${match.round}` : "Runde"),
    resultText: resultLine(match, registrationMap),
    source: "legacy",
  }));

  return [...v2Rows, ...legacyRows].map((match) => ({
    ...match,
    sortTime: matchSortValue(match),
    publicUrl: `/matches/${match.id}`,
  }));
}

export default function EventLivePage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const accessToken = searchParams.get("access") || "";
  const [event, setEvent] = useState(null);
  const [matches, setMatches] = useState([]);
  const [stations, setStations] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/events/${slug}`, accessParams(accessToken));
      const tournaments = sortByNearestDate(data?.tournaments || []);
      const bracketResponses = await Promise.allSettled(
        tournaments.map((tournament) => api.get(`/tournaments/${tournament.id}/bracket`, accessParams(accessToken)))
      );
      const stationResponses = await Promise.allSettled([
        api.get(`/stations?event_id=${encodeURIComponent(data.id)}`),
        ...tournaments.map((tournament) => api.get(`/stations?tournament_id=${encodeURIComponent(tournament.id)}`)),
      ]);

      const nextMatches = bracketResponses
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => normalizeBracketRows(result.value.data));
      const nextStations = stationResponses
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => result.value.data || []);

      setEvent({ ...data, tournaments });
      setMatches(nextMatches);
      setStations(Array.from(new Map(nextStations.map((station) => [station.id, station])).values()));
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [accessToken, slug]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [load]);

  const stationMap = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const liveMatches = useMemo(() => matches.filter((match) => ACTIVE_MATCH_STATUSES.has(match.status)).sort((a, b) => a.sortTime - b.sortTime), [matches]);
  const nextMatches = useMemo(() => matches.filter((match) => NEXT_MATCH_STATUSES.has(match.status)).sort((a, b) => a.sortTime - b.sortTime).slice(0, 8), [matches]);
  const resultMatches = useMemo(() => matches.filter((match) => DONE_MATCH_STATUSES.has(match.status)).sort((a, b) => b.sortTime - a.sortTime).slice(0, 8), [matches]);
  const activityItems = useMemo(() => {
    if (!event) return [];
    return sortByNearestDate([
      ...(event.tournaments || []).map((item) => ({ ...item, kind: "tournament" })),
      ...(event.f1_challenges || []).map((item) => ({ ...item, kind: "fastlap" })),
    ]);
  }, [event]);

  const busyStations = stations.filter((station) => BUSY_STATION_STATUSES.has(station.status));
  const freeStations = stations.filter((station) => !BUSY_STATION_STATUSES.has(station.status) && station.status !== "broken");
  const brokenStations = stations.filter((station) => station.status === "broken");

  const seoDescription = seoTextPreview(event?.description || event?.program, "Live-Uebersicht mit Zeitplan, Matches, Stationen und Ergebnissen fuer lokale THE LION SQUAD Events.");
  useDocumentTitle(`${event?.name || "Event"} Live`, seoDescription, {
    image: event?.banner_url,
    canonical: event?.slug ? `${window.location.origin}/events/${event.slug}/live` : undefined,
  });

  if (loading && !event) {
    return <PublicLayout><PublicLoadingState label="Lade Event-Live" /></PublicLayout>;
  }

  if (!event && error) {
    return (
      <PublicLayout>
        <PublicEmptyState
          icon={Radio}
          eyebrow="Event Live"
          title="Live-Seite nicht verfuegbar"
          description="Das Event konnte nicht geladen werden oder ist nicht oeffentlich sichtbar."
          primaryAction={{ to: "/events", label: "Events ansehen" }}
          className="my-16"
        />
      </PublicLayout>
    );
  }

  const eventUrl = `/events/${event.slug || event.id}${accessToken ? `?access=${encodeURIComponent(accessToken)}` : ""}`;

  return (
    <PublicLayout>
      <section className="border-b border-white/10 bg-[#0A0A0A]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <Breadcrumbs
            items={[
              { label: "Home", to: "/" },
              { label: "Events", to: "/events" },
              { label: event.name, to: eventUrl },
              { label: "Live" },
            ]}
            className="mb-4"
          />
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Event Live</span>
                <PhaseBadge phase={event.public_phase || event.event_phase} status={event.status} />
              </div>
              <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase leading-tight break-words">{event.name}</h1>
              <div className="mt-4 flex flex-wrap gap-4 text-sm text-white/60">
                {event.start_date && <span className="inline-flex items-center gap-2"><CalendarClock className="w-4 h-4 text-[#29B6E8]" />{formatDateTime(event.start_date)}</span>}
                {(event.location || event.city) && <span className="inline-flex items-center gap-2"><MapPin className="w-4 h-4 text-[#FFD700]" />{[event.location, event.city].filter(Boolean).join(", ")}</span>}
                {lastUpdated && <span className="inline-flex items-center gap-2"><RotateCw className="w-4 h-4 text-white/35" />Aktualisiert {new Date(lastUpdated).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={eventUrl} className="px-4 py-2 border border-white/10 text-xs uppercase tracking-wider font-bold rounded-sm text-white/70 hover:text-white hover:border-white/30">Eventdetails</Link>
              <button type="button" onClick={load} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black text-xs uppercase tracking-wider font-bold rounded-sm">
                <RotateCw className="w-3.5 h-3.5" /> Aktualisieren
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <LiveStat icon={Radio} label="Jetzt live" value={liveMatches.length} tone="cyan" />
          <LiveStat icon={CalendarClock} label="Als naechstes" value={nextMatches.length} tone="gold" />
          <LiveStat icon={CheckCircle2} label="Ergebnisse" value={resultMatches.length} tone="green" />
          <LiveStat icon={Monitor} label="Freie Stationen" value={freeStations.length} tone="white" />
        </div>

        <div className="grid lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 space-y-6 min-w-0">
            <LivePanel icon={Radio} title="Jetzt laeuft" count={liveMatches.length}>
              {liveMatches.length ? liveMatches.map((match) => (
                <MatchCard key={match.id} match={match} stationMap={stationMap} featured />
              )) : (
                <InlineEmpty text="Aktuell ist kein Match als laufend markiert." />
              )}
            </LivePanel>

            <LivePanel icon={CalendarClock} title="Als naechstes" count={nextMatches.length}>
              {nextMatches.length ? nextMatches.map((match) => (
                <MatchCard key={match.id} match={match} stationMap={stationMap} />
              )) : (
                <InlineEmpty text="Noch keine kommenden Matches geplant." />
              )}
            </LivePanel>
          </section>

          <aside className="lg:col-span-5 space-y-6 min-w-0">
            <LivePanel icon={Monitor} title="Stationen" count={stations.length}>
              <div className="grid grid-cols-3 gap-2">
                <MiniMetric label="Belegt" value={busyStations.length} />
                <MiniMetric label="Frei" value={freeStations.length} />
                <MiniMetric label="Defekt" value={brokenStations.length} />
              </div>
              <div className="space-y-2">
                {stations.slice(0, 12).map((station) => <StationRow key={station.id} station={station} />)}
                {!stations.length && <InlineEmpty text="Keine Stationen mit diesem Event verknuepft." />}
              </div>
            </LivePanel>

            <LivePanel icon={CheckCircle2} title="Ergebnis-Ticker" count={resultMatches.length}>
              {resultMatches.length ? resultMatches.map((match) => (
                <ResultRow key={match.id} match={match} />
              )) : (
                <InlineEmpty text="Sobald Ergebnisse eingetragen sind, erscheinen sie hier." />
              )}
            </LivePanel>

            <LivePanel icon={Activity} title="Aktivitaeten" count={activityItems.length}>
              {activityItems.length ? activityItems.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} accessToken={accessToken} />) : (
                <InlineEmpty text="Keine Turniere oder Fast-Laps verknuepft." />
              )}
            </LivePanel>
          </aside>
        </div>
      </section>
    </PublicLayout>
  );
}

function MatchCard({ match, stationMap, featured = false }) {
  const station = stationLabel(match, stationMap);
  return (
    <Link to={match.publicUrl} className={`block rounded-sm border bg-[#121212] p-4 transition hover:border-[#29B6E8]/50 ${featured ? "border-[#29B6E8]/35" : "border-white/10"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-white/40">
            <span>{match.tournament?.title || "Turnier"}</span>
            <span>{match.groupLabel}</span>
          </div>
          <h2 className="mt-2 font-heading text-lg font-black uppercase leading-tight break-words">{match.labels.join(" vs. ") || "Teilnehmer offen"}</h2>
        </div>
        <span className="shrink-0 rounded-sm border border-[#29B6E8]/35 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">{formatMatchStatus(match.schedule_status || match.status)}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/55">
        <span className="inline-flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" />{formatDateTime(match.scheduled_at, { fallback: "Termin offen" })}</span>
        {station && <span className="inline-flex items-center gap-1.5 text-[#FFD700]"><Monitor className="w-3.5 h-3.5" />{station}</span>}
        <span className="inline-flex items-center gap-1.5"><Users className="w-3.5 h-3.5" />{formatMatchKind(match)}</span>
      </div>
    </Link>
  );
}

function ResultRow({ match }) {
  return (
    <Link to={match.publicUrl} className="block border border-white/10 bg-black/20 rounded-sm p-3 hover:border-[#29B6E8]/40 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-white/35">{match.tournament?.title || "Turnier"}</div>
          <div className="mt-1 font-heading font-bold uppercase line-clamp-2">{match.labels.join(" vs. ") || match.groupLabel}</div>
          {match.resultText && <div className="mt-1 text-xs text-[#00FF88] line-clamp-2">{match.resultText}</div>}
        </div>
        <span className="text-[10px] uppercase tracking-widest font-bold text-white/45">{formatMatchStatus(match.status)}</span>
      </div>
    </Link>
  );
}

function ActivityRow({ item, accessToken }) {
  const isFastLap = item.kind === "fastlap";
  const Icon = isFastLap ? Flag : Trophy;
  const href = isFastLap ? `/fastlap/${item.slug || item.id}` : `/tournaments/${item.slug || item.id}`;
  const suffix = item.access_link && accessToken ? `?access=${encodeURIComponent(accessToken)}` : "";
  return (
    <Link to={`${href}${suffix}`} className="flex items-center gap-3 border border-white/10 bg-black/20 rounded-sm p-3 hover:border-[#29B6E8]/40 transition min-w-0">
      <div className={`w-10 h-10 rounded-sm border flex items-center justify-center shrink-0 ${isFastLap ? "border-[#FFD700]/35 text-[#FFD700]" : "border-[#29B6E8]/35 text-[#29B6E8]"}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-widest text-white/35">{isFastLap ? "Fast Lap" : "Turnier"}</div>
        <div className="font-heading font-bold uppercase truncate">{item.title || item.name}</div>
      </div>
    </Link>
  );
}

function StationRow({ station }) {
  const busy = BUSY_STATION_STATUSES.has(station.status);
  const broken = station.status === "broken";
  return (
    <div className="flex items-center justify-between gap-3 border border-white/10 bg-black/20 rounded-sm p-3">
      <div className="min-w-0">
        <div className="font-heading font-bold uppercase truncate">{station.name || station.label || station.id}</div>
        <div className="text-xs text-white/40 truncate">{station.notes || station.device_type || "Station"}</div>
      </div>
      <span className={`shrink-0 rounded-sm border px-2 py-1 text-[10px] uppercase tracking-widest font-bold ${broken ? "border-[#FF3B30]/40 text-[#FF3B30]" : busy ? "border-[#29B6E8]/40 text-[#29B6E8]" : "border-[#00FF88]/35 text-[#00FF88]"}`}>
        {broken ? "Defekt" : busy ? "Belegt" : "Frei"}
      </span>
    </div>
  );
}

function LivePanel({ icon: Icon, title, count, children }) {
  return (
    <section className="border border-white/10 bg-[#0F0F0F] rounded-sm p-4 min-w-0">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-heading text-xl font-black uppercase inline-flex items-center gap-2">
          <Icon className="w-5 h-5 text-[#29B6E8]" /> {title}
        </h2>
        <span className="font-display text-lg text-white/45 tabular-nums">{count}</span>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function LiveStat({ icon: Icon, label, value, tone }) {
  const color = tone === "gold" ? "text-[#FFD700]" : tone === "green" ? "text-[#00FF88]" : tone === "white" ? "text-white" : "text-[#29B6E8]";
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</span>
        <Icon className={`w-4 h-4 ${color}`} />
      </div>
      <div className={`mt-2 font-heading text-3xl font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function MiniMetric({ label, value }) {
  return (
    <div className="border border-white/10 bg-black/20 rounded-sm p-3">
      <div className="text-[10px] uppercase tracking-widest text-white/35">{label}</div>
      <div className="mt-1 font-heading text-2xl font-black tabular-nums">{value}</div>
    </div>
  );
}

function InlineEmpty({ text }) {
  return <div className="border border-dashed border-white/15 rounded-sm p-5 text-center text-sm text-white/45">{text}</div>;
}
