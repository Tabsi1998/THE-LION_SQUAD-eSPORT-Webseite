import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { MascotBadge } from "@/components/tls/Logo";
import { SponsorGrid } from "@/components/tls/SponsorTicker";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { formatDateTime } from "@/lib/datetime";
import { sortByNearestDate } from "@/lib/contentSort";
import { CalendarDays, Flag, MapPin, Monitor, Trophy, Users } from "lucide-react";

const ACTIVE_STATUSES = new Set(["live", "check_in", "checkin_open", "registration_open", "paused"]);
const BUSY_STATION_STATUSES = new Set(["busy", "reserved", "in_use"]);

export default function EventTVPage() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [stations, setStations] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/events/${id}`);
      const tournaments = sortByNearestDate(data?.tournaments || []);
      const stationResponses = await Promise.allSettled([
        api.get(`/stations?event_id=${encodeURIComponent(data.id)}`),
        ...tournaments.map((tournament) => api.get(`/stations?tournament_id=${encodeURIComponent(tournament.id)}`)),
      ]);
      const stationRows = stationResponses
        .filter((result) => result.status === "fulfilled")
        .flatMap((result) => result.value.data || []);
      const uniqueStations = Array.from(new Map(stationRows.map((station) => [station.id, station])).values());
      const bracketResponses = await Promise.allSettled(
        tournaments.map((tournament) => loadTournamentBracketForDisplay(tournament.id))
      );
      const stationMatches = buildStationMatchLookup(
        bracketResponses
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value.data)
      );
      const enrichedStations = uniqueStations.map((station) => ({
        ...station,
        current_match: (station.current_match_id && stationMatches.byId.get(station.current_match_id))
          || stationMatches.byStation.get(station.id)
          || null,
      }));
      setEvent({ ...data, tournaments });
      setStations(enrichedStations);
      setLoadError(null);
      setLastUpdated(Date.now());
    } catch (error) {
      setLoadError(error);
    }
  }, [id]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const activity = useMemo(() => {
    if (!event) return [];
    return sortByNearestDate([
      ...(event.tournaments || []).map((item) => ({ ...item, kind: "tournament", label: "Turnier" })),
      ...(event.f1_challenges || []).map((item) => ({ ...item, kind: "fastlap", label: "Fast Lap" })),
    ]).slice(0, 8);
  }, [event]);

  if (!event) {
    return (
      <div className="h-screen bg-black text-white flex flex-col">
        <DisplayStatusBanner error={loadError} label="Event-Live" onRetry={load} />
        <div className="flex-1 flex items-center justify-center font-display tracking-widest text-white/40">
          {loadError ? "EVENT-DISPLAY KONNTE NICHT GELADEN WERDEN" : "LADE EVENT-DISPLAY ..."}
        </div>
      </div>
    );
  }

  const publicUrl = `${window.location.origin}/events/${event.slug || event.id}`;
  const busyStations = stations.filter((station) => BUSY_STATION_STATUSES.has(station.status));
  const freeStations = stations.filter((station) => !BUSY_STATION_STATUSES.has(station.status) && station.status !== "broken");
  const brokenStations = stations.filter((station) => station.status === "broken");
  const heroImage = event.banner_url || event.cover_url ? resolveMediaUrl(event.banner_url || event.cover_url) : "";

  return (
    <div className="h-screen tv-bg text-white overflow-hidden flex flex-col">
      <header className="relative shrink-0 border-b border-white/10 bg-black/70">
        {heroImage && <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" />}
        <div className="relative flex items-center justify-between gap-6 px-8 py-6">
          <div className="flex min-w-0 items-center gap-5">
            <MascotBadge className="h-16 w-16 shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-[0.35em] text-[#29B6E8]">THE LION SQUAD - EVENT LIVE</div>
              <h1 className="mt-1 truncate font-heading text-4xl font-black uppercase leading-none xl:text-6xl">{event.name}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-white/60">
                {event.start_date && <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-[#29B6E8]" /> {formatDateTime(event.start_date)}</span>}
                {(event.location || event.city) && <span className="inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-[#FFD700]" /> {[event.location, event.city].filter(Boolean).join(", ")}</span>}
              </div>
            </div>
          </div>
          <StatusPill status={event.status} />
        </div>
      </header>

      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Event-Daten" onRetry={load} compact />

      <main className="grid min-h-0 flex-1 grid-cols-12 gap-4 p-5">
        <section className="col-span-12 flex min-h-0 flex-col rounded-sm border border-white/10 bg-[#0A0A0A]/78 xl:col-span-7">
          <PanelHeader icon={Trophy} label="Live-Aktivitäten" value={`${activity.length}`} />
          <div className="grid min-h-0 flex-1 content-start gap-3 overflow-hidden p-4">
            {activity.length ? activity.map((item) => <ActivityCard key={`${item.kind}-${item.id}`} item={item} />) : (
              <EmptyState>Keine verknuepften Turniere oder Fast-Laps</EmptyState>
            )}
          </div>
        </section>

        <section className="col-span-12 flex min-h-0 flex-col rounded-sm border border-white/10 bg-[#0A0A0A]/78 xl:col-span-5">
          <PanelHeader icon={Monitor} label="Stationen" value={stations.length} />
          <div className="grid grid-cols-3 gap-3 border-b border-white/10 p-4">
            <Metric label="Belegt" value={busyStations.length} tone="cyan" />
            <Metric label="Frei" value={freeStations.length} tone="green" />
            <Metric label="Defekt" value={brokenStations.length} tone="red" />
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-hidden p-4">
            {stations.slice(0, 9).map((station) => <StationRow key={station.id} station={station} />)}
            {!stations.length && <EmptyState>Keine Stationen für dieses Event</EmptyState>}
          </div>
        </section>
      </main>

      <footer className="shrink-0 border-t border-white/10 bg-[#0A0A0A]/92 px-8 py-4 flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="shrink-0 rounded-sm bg-white p-1.5">
            <BrandedQRCode value={publicUrl} size={92} />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Event verfolgen</div>
            <div className="truncate text-sm text-white/70">QR scannen und Details öffnen</div>
          </div>
        </div>
        <SponsorGrid max={5} marquee className="flex-1 max-w-[58vw]" />
      </footer>
    </div>
  );
}

async function loadTournamentBracketForDisplay(tournamentId) {
  const encoded = encodeURIComponent(tournamentId);
  try {
    return await api.get(`/tournaments/${encoded}/bracket/display`);
  } catch {
    return api.get(`/tournaments/${encoded}/bracket`);
  }
}

function ActivityCard({ item }) {
  const isFastLap = item.kind === "fastlap";
  const Icon = isFastLap ? Flag : Trophy;
  const href = isFastLap ? `/display/f1/${item.id}` : `/display/bracket/${item.id}`;
  const statusActive = ACTIVE_STATUSES.has(item.status);
  return (
    <Link to={href} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-sm border border-white/10 bg-black/35 px-4 py-3 hover:border-[#29B6E8]/45">
      <div className={`flex h-12 w-12 items-center justify-center rounded-sm border ${isFastLap ? "border-[#FFD700]/35 text-[#FFD700]" : "border-[#29B6E8]/35 text-[#29B6E8]"}`}>
        <Icon className="h-6 w-6" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-white/38">{item.label}</div>
        <div className="truncate font-heading text-2xl font-black uppercase leading-tight">{item.title || item.name}</div>
        <div className="mt-1 flex items-center gap-3 text-xs text-white/45">
          {item.start_date && <span>{formatDateTime(item.start_date)}</span>}
          {item.participant_count != null && <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {item.participant_count}</span>}
          {item.track_count != null && <span>{item.track_count} Strecken</span>}
        </div>
      </div>
      <div className={`rounded-sm border px-3 py-2 text-[10px] font-bold uppercase tracking-widest ${statusActive ? "border-[#29B6E8]/50 bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/10 text-white/50"}`}>
        {statusLabel(item.status)}
      </div>
    </Link>
  );
}

function StationRow({ station }) {
  const busy = BUSY_STATION_STATUSES.has(station.status);
  const broken = station.status === "broken";
  const assignedMatch = station.current_match;
  const stateLabel = broken ? "Defekt" : busy ? "Belegt" : assignedMatch ? "Geplant" : "Frei";
  const stateClass = broken
    ? "border-[#FF3B30]/45 text-[#FF3B30]"
    : busy
      ? "border-[#29B6E8]/45 text-[#29B6E8]"
      : assignedMatch
        ? "border-[#FFD700]/45 text-[#FFD700]"
        : "border-[#00FF88]/35 text-[#00FF88]";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm border border-white/10 bg-black/30 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate font-heading text-lg font-bold uppercase">{station.name || station.label || station.id}</div>
        {assignedMatch ? (
          <>
            <div className="truncate text-[11px] font-bold uppercase tracking-wider text-[#29B6E8]">{assignedMatch.key} · {assignedMatch.kind}</div>
            <div className="truncate text-[11px] text-white/58">{assignedMatch.participants}</div>
          </>
        ) : (
          <div className="truncate text-[11px] text-white/38">{station.notes || station.device_type || "Station"}</div>
        )}
      </div>
      <div className={`rounded-sm border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${stateClass}`}>
        {stateLabel}
      </div>
    </div>
  );
}

function PanelHeader({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-[#29B6E8]">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="font-display text-2xl font-black tabular-nums text-white/75">{value}</div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  const cls = tone === "green" ? "text-[#00FF88]" : tone === "red" ? "text-[#FF3B30]" : "text-[#29B6E8]";
  return (
    <div className="rounded-sm border border-white/10 bg-black/30 p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-white/38">{label}</div>
      <div className={`mt-1 font-heading text-3xl font-black tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}

function StatusPill({ status }) {
  const active = ACTIVE_STATUSES.has(status);
  return (
    <div className={`shrink-0 rounded-sm border px-4 py-3 text-xs font-bold uppercase tracking-[0.25em] ${active ? "border-[#29B6E8]/50 bg-[#29B6E8]/10 text-[#29B6E8]" : "border-white/15 bg-black/30 text-white/60"}`}>
      {statusLabel(status)}
    </div>
  );
}

function EmptyState({ children }) {
  return <div className="flex h-full min-h-40 items-center justify-center text-center font-display text-lg uppercase tracking-[0.22em] text-white/30">{children}</div>;
}

function statusLabel(status) {
  return {
    draft: "Entwurf",
    scheduled: "Geplant",
    registration_open: "Anmeldung",
    registration_closed: "Geschlossen",
    check_in: "Check-in",
    checkin_open: "Check-in",
    live: "Live",
    paused: "Pause",
    completed: "Beendet",
    results_published: "Ergebnisse",
    archived: "Archiv",
    cancelled: "Abgesagt",
  }[status] || status || "Offen";
}

function buildStationMatchLookup(bracketPayloads) {
  const entries = [];
  for (const payload of bracketPayloads || []) {
    const registrations = new Map((payload?.registrations || []).map((registration) => [registration.id, registration]));
    const tournamentTitle = payload?.tournament?.title || "Turnier";
    for (const match of [...(payload?.matches_v2 || []), ...(payload?.matches || [])]) {
      if (!match?.id || isDoneMatch(match)) continue;
      const detail = stationMatchDetail(match, registrations, tournamentTitle);
      entries.push(detail);
    }
  }
  entries.sort((a, b) => stationMatchSort(a.match, b.match));
  const byId = new Map();
  const byStation = new Map();
  for (const detail of entries) {
    byId.set(detail.id, detail);
    if (detail.stationId && !byStation.has(detail.stationId)) byStation.set(detail.stationId, detail);
  }
  return { byId, byStation };
}

function stationMatchDetail(match, registrations, tournamentTitle) {
  const labels = Array.isArray(match.slots)
    ? (match.slots || []).map((slot) => participantName(slot.registration_id, registrations, slot.source?.raw))
    : [
        participantName(match.participant_a_id, registrations),
        participantName(match.participant_b_id, registrations),
      ];
  const participants = labels.filter(Boolean).slice(0, 4).join(" vs. ") || "Teilnehmer offen";
  return {
    id: match.id,
    stationId: match.station_id || "",
    key: match.match_key || match.round_name || matchLabel(match),
    kind: tournamentTitle,
    participants,
    match,
  };
}

function participantName(registrationId, registrations, fallback = "") {
  const registration = registrations.get(registrationId) || {};
  return registration.display_name || registration.ingame_name || registration.user?.display_name || fallback || "Offen";
}

function isDoneMatch(match) {
  return ["completed", "forfeit", "archived"].includes(match.status) || Boolean(match.winner_id);
}

function stationMatchSort(a, b) {
  const statusRank = { in_progress: 0, live: 0, ready: 1, scheduled: 2, pending: 3, preview: 4 };
  const aTime = Date.parse(a.scheduled_at || "") || Number.MAX_SAFE_INTEGER;
  const bTime = Date.parse(b.scheduled_at || "") || Number.MAX_SAFE_INTEGER;
  return (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9)
    || aTime - bTime
    || (Number(a.round || 0) - Number(b.round || 0))
    || ((a.order ?? a.match_index ?? 0) - (b.order ?? b.match_index ?? 0));
}

function matchLabel(match) {
  if (Number.isInteger(match.match_index)) return `Spiel ${match.match_index + 1}`;
  if (match.order != null) return `Spiel ${Number(match.order) + 1}`;
  return "Match";
}
