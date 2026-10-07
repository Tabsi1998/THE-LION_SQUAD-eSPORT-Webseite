import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { TvScreen, useTv, useTvArea } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvPill } from "@/components/tv/TvParts";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { formatDateTime } from "@/lib/datetime";
import { sortByNearestDate } from "@/lib/contentSort";
import { describeSlot, finderFor, isMatchDone } from "@/lib/slotSource";
import { charsPerLine, fitItems, nameFit, TV_LINE, wrapLines } from "@/lib/tvType";
import { CalendarDays, Flag, MapPin, Monitor, Trophy, Users } from "lucide-react";

// Event-TV: was gerade läuft und welche Station frei ist. Größen aus tv.css (#1111): Listen zeigen, was ohne
// Abschneiden Platz hat, der Rest steht als „+ N weitere“ da. Leere Plätze heißen „Sieger aus A“ (#1113).

const ACTIVE_STATUSES = new Set(["live", "check_in", "checkin_open", "registration_open", "paused"]);
const BUSY_STATION_STATUSES = new Set(["busy", "reserved", "in_use"]);
const DEFAULT_PANEL = { w: 100, h: 60 };

export default function EventTVPage() {
  return (
    <TvScreen>
      <EventTv />
    </TvScreen>
  );
}

function EventTv() {
  const { id } = useParams();
  const { scale, box } = useTv();
  const [event, setEvent] = useState(null);
  const [stations, setStations] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activityRef, activityMeasured, activityTrim] = useTvArea(event ? `${(event.tournaments || []).length}:${(event.f1_challenges || []).length}` : "");
  const [stationRef, stationMeasured, stationTrim] = useTvArea(String(stations.length));
  const activityArea = activityMeasured || DEFAULT_PANEL;
  const stationArea = stationMeasured || DEFAULT_PANEL;

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
  }, [load]);
  // Die TV-Anzeige läuft stundenlang: ohne Strom alle 15 s nachfragen.
  useLiveRefresh(load, ["events", "tournaments", "matches", "matches-v2", "stations", "f1"], { fallbackMs: 15000 });

  const activity = useMemo(() => {
    if (!event) return [];
    return sortByNearestDate([
      ...(event.tournaments || []).map((item) => ({ ...item, kind: "tournament", label: "Turnier" })),
      ...(event.f1_challenges || []).map((item) => ({ ...item, kind: "fastlap", label: "Fast Lap" })),
    ]);
  }, [event]);

  // Was ohne Abschneiden Platz hat (#1111) - gerechnet in Einheiten mit denselben Größen wie tv.css.
  const activityFit = useMemo(() => {
    const titleWidth = activityArea.w - 2 * box.padX - 2 * box.colPad - 4.6 - 2 * box.gap - 12;
    const height = (item) => {
      const lines = Math.max(1, wrapLines(item.title || item.name || "", charsPerLine(titleWidth, scale.head)));
      return 2 * 0.9 + Math.max(4.6, scale.meta * TV_LINE.meta + lines * scale.head * TV_LINE.head + scale.info * TV_LINE.info) + 0.35;
    };
    return trimFit(fitItems(activity, activityArea.h - 2 * box.colPad, height, box.gap, scale.meta * TV_LINE.meta), activity.length, activityTrim);
  }, [activity, activityArea, box, scale, activityTrim]);

  const stationFit = useMemo(() => {
    const textWidth = stationArea.w - 2 * box.padX - 2 * box.colPad - box.gap - 10;
    const height = (station) => {
      const match = station.current_match;
      // Namen an den Stationen sind Namen (#1111): mindestens so groß wie im Turnierbaum, lieber zweizeilig.
      const fit = match ? nameFit(match.participants, textWidth, scale) : null;
      const detail = match
        ? scale.meta * TV_LINE.meta + fit.lines * fit.size * TV_LINE.name
        : scale.info * TV_LINE.info;
      return 2 * 0.7 + scale.head * TV_LINE.head + detail + 0.35;
    };
    return { ...trimFit(fitItems(stations, stationArea.h - 2 * box.colPad, height, box.gap, scale.meta * TV_LINE.meta), stations.length, stationTrim), textWidth };
  }, [stations, stationArea, box, scale, stationTrim]);

  if (!event) {
    return (
      <div className="tv-page">
        <DisplayStatusBanner error={loadError} label="Event-Live" onRetry={load} />
        <div className="tv-main">
          <div className="tv-empty tv-t-head font-display">{loadError ? "Event-Display konnte nicht geladen werden" : "Lade Event-Display …"}</div>
        </div>
      </div>
    );
  }

  const publicUrl = `${window.location.origin}/events/${event.slug || event.id}`;
  const busyStations = stations.filter((station) => BUSY_STATION_STATUSES.has(station.status));
  const freeStations = stations.filter((station) => !BUSY_STATION_STATUSES.has(station.status) && station.status !== "broken");
  const brokenStations = stations.filter((station) => station.status === "broken");
  const heroImage = event.banner_url || event.cover_url ? resolveMediaUrl(event.banner_url || event.cover_url) : "";
  const place = [event.location, event.city].filter(Boolean).join(", ");

  return (
    <div className="tv-page" data-testid="event-tv">
      <TvHeader
        kicker="THE LION SQUAD · EVENT LIVE"
        title={event.name}
        hero={heroImage}
        subtitle={(event.start_date || place) ? (
          <span className="inline-flex flex-wrap items-center gap-x-[1.2em] gap-y-[0.2em]">
            {event.start_date ? <span className="inline-flex items-center gap-[0.4em]"><CalendarDays className="tv-icon tv-accent" /> {formatDateTime(event.start_date)}</span> : null}
            {place ? <span className="inline-flex items-center gap-[0.4em]"><MapPin className="tv-icon tv-gold" /> {place}</span> : null}
          </span>
        ) : null}
        aside={<TvPill tone={ACTIVE_STATUSES.has(event.status) ? "accent" : "muted"} live={event.status === "live"}>{statusLabel(event.status)}</TvPill>}
      />

      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Event-Daten" onRetry={load} />

      <main className="tv-main grid min-h-0 gap-[var(--tv-gap)]" style={{ gridTemplateColumns: "minmax(0, 7fr) minmax(0, 5fr)" }}>
        <section className="tv-panel">
          <PanelHeader icon={Trophy} label="Live-Aktivitäten" value={activity.length} />
          <div ref={activityRef} className="tv-panel__body" data-testid="tv-activity-list">
            {activityFit.shown.map((item) => <ActivityCard key={`${item.kind}-${item.id}`} item={item} />)}
            {activityFit.hidden > 0 ? <MoreLine count={activityFit.hidden} noun="weitere" /> : null}
            {!activity.length && <div className="tv-empty tv-t-info">Keine verknüpften Turniere oder Fast Laps</div>}
          </div>
        </section>

        <section className="tv-panel">
          <PanelHeader icon={Monitor} label="Stationen" value={stations.length} />
          <div className="grid grid-cols-3 gap-[var(--tv-gap)] p-[var(--tv-col-pad)] border-b border-[color:var(--tv-line)]">
            <Metric label="Belegt" value={busyStations.length} tone="accent" />
            <Metric label="Frei" value={freeStations.length} tone="green" />
            <Metric label="Defekt" value={brokenStations.length} tone="red" />
          </div>
          <div ref={stationRef} className="tv-panel__body" data-testid="tv-station-list">
            {stationFit.shown.map((station) => <StationRow key={station.id} station={station} nameWidth={stationFit.textWidth} />)}
            {stationFit.hidden > 0 ? <MoreLine count={stationFit.hidden} noun={stationFit.hidden === 1 ? "weitere Station" : "weitere Stationen"} /> : null}
            {!stations.length && <div className="tv-empty tv-t-info">Keine Stationen für dieses Event</div>}
          </div>
        </section>
      </main>

      <TvFooter qrValue={publicUrl} kicker="Event verfolgen" text="QR scannen und Details öffnen" sponsorMax={5} />
    </div>
  );
}

/** Läuft eine Liste am TV trotz Rechnung über (andere Schrift), fallen hinten Einträge weg - nie abgeschnitten. */
function trimFit(fit, total, trim) {
  if (!trim) return fit;
  const shown = fit.shown.slice(0, Math.max(0, fit.shown.length - trim));
  return { shown, hidden: total - shown.length };
}

async function loadTournamentBracketForDisplay(tournamentId) {
  const encoded = encodeURIComponent(tournamentId);
  try {
    return await api.get(`/tournaments/${encoded}/bracket/display`);
  } catch {
    return api.get(`/tournaments/${encoded}/bracket`);
  }
}

function MoreLine({ count, noun }) {
  return <div className="tv-t-meta tv-faint text-center uppercase tracking-[0.18em]">+ {count} {noun}</div>;
}

function ActivityCard({ item }) {
  const isFastLap = item.kind === "fastlap";
  const Icon = isFastLap ? Flag : Trophy;
  const href = isFastLap ? `/display/f1/${item.id}` : `/display/bracket/${item.id}`;
  const statusActive = ACTIVE_STATUSES.has(item.status);
  return (
    <Link to={href} className="tv-card grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[var(--tv-gap)] px-[var(--tv-pad-x)] py-[calc(var(--tv-u)*0.9)]" data-testid="tv-activity">
      <div className={`flex items-center justify-center w-[calc(var(--tv-u)*4.6)] h-[calc(var(--tv-u)*4.6)] border border-current rounded-sm ${isFastLap ? "tv-gold" : "tv-accent"}`}>
        <Icon className="w-1/2 h-1/2" />
      </div>
      <div className="min-w-0">
        <div className="tv-kicker tv-t-meta tv-faint">{item.label}</div>
        <div className="tv-t-head font-heading font-black uppercase" style={{ overflowWrap: "anywhere" }}>{item.title || item.name}</div>
        <div className="tv-t-info tv-muted flex flex-wrap items-center gap-x-[1em]">
          {item.start_date && <span>{formatDateTime(item.start_date)}</span>}
          {item.participant_count != null && <span className="inline-flex items-center gap-[0.3em]"><Users className="tv-icon" /> {item.participant_count}</span>}
          {item.track_count != null && <span>{item.track_count} Strecken</span>}
        </div>
      </div>
      <TvPill tone={statusActive ? "accent" : "muted"}>{statusLabel(item.status)}</TvPill>
    </Link>
  );
}

function StationRow({ station, nameWidth }) {
  const { scale } = useTv();
  const busy = BUSY_STATION_STATUSES.has(station.status);
  const broken = station.status === "broken";
  const assignedMatch = station.current_match;
  const stateLabel = broken ? "Defekt" : busy ? "Belegt" : assignedMatch ? "Geplant" : "Frei";
  const tone = broken ? "red" : busy ? "accent" : assignedMatch ? "gold" : "green";
  return (
    <div className="tv-card grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[var(--tv-gap)] px-[var(--tv-pad-x)] py-[calc(var(--tv-u)*0.7)]" data-testid="tv-station">
      <div className="min-w-0">
        <div className="tv-t-head font-heading font-bold uppercase" style={{ overflowWrap: "anywhere" }}>{station.name || station.label || station.id}</div>
        {assignedMatch ? (
          <>
            <div className="tv-kicker tv-t-meta">{assignedMatch.key} · {assignedMatch.kind}</div>
            <div className="tv-t-name tv-muted" data-tv-name="1" data-fit={nameFit(assignedMatch.participants, nameWidth, scale).small ? "small" : undefined}>{assignedMatch.participants}</div>
          </>
        ) : (
          <div className="tv-t-info tv-faint">{station.notes || station.device_type || "Station"}</div>
        )}
      </div>
      <TvPill tone={tone}>{stateLabel}</TvPill>
    </div>
  );
}

function PanelHeader({ icon: Icon, label, value }) {
  return (
    <div className="tv-panel__head items-center">
      <div className="tv-kicker tv-t-meta inline-flex items-center gap-[0.5em]">
        <Icon className="tv-icon" /> {label}
      </div>
      <div className="tv-t-num font-display font-black tv-muted">{value}</div>
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="tv-card px-[var(--tv-pad-x)] py-[calc(var(--tv-u)*0.8)]">
      <div className="tv-kicker tv-t-meta tv-faint">{label}</div>
      <div className={`tv-t-title font-heading font-black tabular-nums tv-${tone}`}>{value}</div>
    </div>
  );
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
    const finder = finderFor(payload?.matches_v2 || []);
    const tournamentTitle = payload?.tournament?.title || "Turnier";
    for (const match of payload?.matches_v2 || []) {
      if (!match?.id || isMatchDone(match)) continue;
      entries.push(stationMatchDetail(match, registrations, finder(match), tournamentTitle));
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

function stationMatchDetail(match, registrations, findMatch, tournamentTitle) {
  const nameOf = (registrationId) => {
    const registration = registrations.get(registrationId) || {};
    return registration.display_name || registration.ingame_name || registration.user?.display_name || "";
  };
  const slots = Array.isArray(match.slots)
    ? match.slots
    : [{ registration_id: match.participant_a_id }, { registration_id: match.participant_b_id }];
  const labels = slots.map((slot) => describeSlot(slot, nameOf, findMatch).label).filter(Boolean);
  const participants = labels.slice(0, 4).join(" vs. ") || "Teilnehmer offen";
  return {
    id: match.id,
    stationId: match.station_id || "",
    key: match.match_key ? `Spiel ${match.match_key}` : match.round_name || matchLabel(match),
    kind: tournamentTitle,
    participants,
    match,
  };
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
