import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Activity, CalendarClock, CheckCircle2, Flag, Monitor, Radio, RotateCw, Trophy, Users } from "lucide-react";
import { api } from "@/lib/api";
import { formatWhen } from "@/lib/datetime";
import { sortByNearestDate } from "@/lib/contentSort";
import { formatMatchKind, formatMatchStatus, formatScheduleGroupLabel, matchScheduleStatusText, slotName, stationText } from "@/lib/tournamentLabels";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { viennaTime } from "@/lib/vienna";
import { finderFor, sourceLabel } from "@/lib/slotSource";
import { eventIsOver } from "@/lib/afterEnd";

const ACTIVE_MATCH_STATUSES = new Set(["in_progress", "running", "waiting_result", "disputed"]);
const NEXT_MATCH_STATUSES = new Set(["ready", "scheduled", "pending", "preview"]);
const DONE_MATCH_STATUSES = new Set(["completed", "forfeit", "bye", "no_show"]);
const BUSY_STATION_STATUSES = new Set(["busy", "reserved", "in_use"]);

function accessParams(accessToken) {
  return accessToken ? { params: { access: accessToken } } : undefined;
}

// Station im Klartext (#1220): der fertige Text vom Server, sonst der Name aus der Stationsliste - nie eine Kennung.
function stationLabel(match, stationMap) {
  return stationText(match) || stationMap.get(match.station_id)?.name || "";
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

// Leere Plätze späterer Runden im Klartext (#1113): „Sieger aus A“; ein Platz ohne Gegner heißt „Freilos“, ein
// Setzplatz vor der Auslosung „noch offen“ (#1220).
function slotLabel(slot, registrationMap, findMatch, match) {
  const registration = registrationMap.get(slot.registration_id);
  if (registration) return participantLabel(registration);
  return sourceLabel(slot.source, findMatch) || slotName("", slot, match);
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
  const finder = finderFor(payload?.matches_v2 || []);

  const v2Rows = (payload?.matches_v2 || []).map((match) => ({
    ...match,
    tournament,
    labels: (match.slots || []).map((slot) => slotLabel(slot, registrationMap, finder(match), match)).filter(Boolean),
    groupLabel: formatScheduleGroupLabel(match, tournament),
    resultText: resultLine(match, registrationMap),
    source: "v2",
  }));

  return v2Rows.map((match) => ({
    ...match,
    sortTime: matchSortValue(match),
    publicUrl: `/matches/${match.id}`,
  }));
}

// „Live“ ist seit #1183 ein Reiter der Event-Seite: die alte Adresse /events/<slug>/live führt dorthin (Links aus
// Discord, Mails und der App bleiben gültig). Den Inhalt zeigt EventLiveBoard - im Reiter, mit dem Event der Seite.
export default function EventLivePage() {
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const params = new URLSearchParams({ tab: "live" });
  const access = searchParams.get("access");
  if (access) params.set("access", access);
  return <Navigate to={`/events/${encodeURIComponent(slug || "")}?${params.toString()}`} replace />;
}

/**
 * Was gerade läuft (#1183, vorher eine eigene Seite): laufende und nächste Matches, Stationen, Ergebnisse und die
 * Turniere und Fast Laps des Events. Lädt die Bäume und Stationen selbst und frischt sich auf, solange das Event läuft.
 */
export function EventLiveBoard({ event, accessToken = "" }) {
  const [matches, setMatches] = useState([]);
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const tournaments = useMemo(() => sortByNearestDate(event?.tournaments || []), [event?.tournaments]);
  const over = eventIsOver(event);

  const load = useCallback(async () => {
    if (!event?.id) return;
    try {
      const bracketResponses = await Promise.allSettled(
        tournaments.map((tournament) => api.get(`/tournaments/${tournament.id}/bracket`, accessParams(accessToken)))
      );
      const stationResponses = await Promise.allSettled([
        api.get(`/stations?event_id=${encodeURIComponent(event.id)}`),
        ...tournaments.map((tournament) => api.get(`/stations?tournament_id=${encodeURIComponent(tournament.id)}`)),
      ]);
      setMatches(bracketResponses.filter((result) => result.status === "fulfilled").flatMap((result) => normalizeBracketRows(result.value.data)));
      const nextStations = stationResponses.filter((result) => result.status === "fulfilled").flatMap((result) => result.value.data || []);
      setStations(Array.from(new Map(nextStations.map((station) => [station.id, station])).values()));
      setLastUpdated(Date.now());
    } finally {
      setLoading(false);
    }
  }, [accessToken, event?.id, tournaments]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, ["events", "tournaments", "matches", "matches-v2", "stations", "f1"], { fallbackMs: 20000, enabled: !over });

  const stationMap = useMemo(() => new Map(stations.map((station) => [station.id, station])), [stations]);
  const liveMatches = useMemo(() => matches.filter((match) => ACTIVE_MATCH_STATUSES.has(match.status)).sort((a, b) => a.sortTime - b.sortTime), [matches]);
  const nextMatches = useMemo(() => matches.filter((match) => NEXT_MATCH_STATUSES.has(match.status)).sort((a, b) => a.sortTime - b.sortTime).slice(0, 8), [matches]);
  const resultMatches = useMemo(() => matches.filter((match) => DONE_MATCH_STATUSES.has(match.status)).sort((a, b) => b.sortTime - a.sortTime).slice(0, 8), [matches]);
  const activityItems = useMemo(() => sortByNearestDate([
    ...tournaments.map((item) => ({ ...item, kind: "tournament" })),
    ...(event?.f1_challenges || []).map((item) => ({ ...item, kind: "fastlap" })),
  ]), [event?.f1_challenges, tournaments]);

  const busyStations = stations.filter((station) => BUSY_STATION_STATUSES.has(station.status));
  const freeStations = stations.filter((station) => !BUSY_STATION_STATUSES.has(station.status) && station.status !== "broken");
  const brokenStations = stations.filter((station) => station.status === "broken");

  if (loading) return <p className="text-sm text-white/45 py-6" data-testid="event-live-loading">Lade, was gerade läuft …</p>;

  return (
    <div className="space-y-8" data-testid="event-live-board">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {lastUpdated ? <span className="inline-flex items-center gap-2 text-xs text-white/45"><RotateCw className="w-3.5 h-3.5" /> Aktualisiert {viennaTime(lastUpdated, { hour: "2-digit", minute: "2-digit" })}</span> : <span />}
        <button type="button" onClick={load} className="tls-btn tls-btn--quiet inline-flex items-center gap-2 px-3 py-1.5 text-xs uppercase tracking-wider font-bold rounded-sm" data-testid="event-live-refresh">
          <RotateCw className="w-3.5 h-3.5" /> Aktualisieren
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <LiveStat icon={Radio} label="Jetzt live" value={liveMatches.length} tone="cyan" />
        <LiveStat icon={CalendarClock} label="Als nächstes" value={nextMatches.length} tone="gold" />
        <LiveStat icon={CheckCircle2} label="Ergebnisse" value={resultMatches.length} tone="green" />
        <LiveStat icon={Monitor} label="Freie Stationen" value={freeStations.length} tone="white" />
      </div>

      <div className="grid xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 space-y-6 min-w-0">
          <LivePanel icon={Radio} title="Jetzt läuft" count={liveMatches.length}>
            {liveMatches.length ? liveMatches.map((match) => (
              <MatchCard key={match.id} match={match} stationMap={stationMap} featured />
            )) : (
              <InlineEmpty text="Aktuell ist kein Match als laufend markiert." />
            )}
          </LivePanel>

          <LivePanel icon={CalendarClock} title="Als nächstes" count={nextMatches.length}>
            {nextMatches.length ? nextMatches.map((match) => (
              <MatchCard key={match.id} match={match} stationMap={stationMap} />
            )) : (
              <InlineEmpty text="Noch keine kommenden Matches geplant." />
            )}
          </LivePanel>
        </section>

        <aside className="xl:col-span-5 space-y-6 min-w-0">
          <LivePanel icon={Monitor} title="Stationen" count={stations.length}>
            <div className="grid grid-cols-3 gap-2">
              <MiniMetric label="Belegt" value={busyStations.length} />
              <MiniMetric label="Frei" value={freeStations.length} />
              <MiniMetric label="Defekt" value={brokenStations.length} />
            </div>
            <div className="space-y-2">
              {stations.slice(0, 12).map((station) => <StationRow key={station.id} station={station} />)}
              {!stations.length && <InlineEmpty text="Keine Stationen mit diesem Event verknüpft." />}
            </div>
          </LivePanel>

          <LivePanel icon={CheckCircle2} title="Ergebnis-Ticker" count={resultMatches.length}>
            {resultMatches.length ? resultMatches.map((match) => (
              <ResultRow key={match.id} match={match} />
            )) : (
              <InlineEmpty text="Sobald Ergebnisse eingetragen sind, erscheinen sie hier." />
            )}
          </LivePanel>

          <LivePanel icon={Activity} title="Aktivitäten" count={activityItems.length}>
            {activityItems.length ? activityItems.map((item) => <ActivityRow key={`${item.kind}-${item.id}`} item={item} accessToken={accessToken} />) : (
              <InlineEmpty text="Keine Turniere oder Fast Laps verknüpft." />
            )}
          </LivePanel>
        </aside>
      </div>
    </div>
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
        <span className="shrink-0 rounded-sm border border-[#29B6E8]/35 px-2 py-1 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8]">{matchScheduleStatusText(match)}</span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/55">
        <span className="inline-flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" />{formatWhen(match.scheduled_at, { fallback: "Termin offen" })}</span>
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
