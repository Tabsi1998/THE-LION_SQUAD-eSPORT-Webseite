import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, MapPin } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { TvScreen, useTv } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvPill } from "@/components/tv/TvParts";
import { TvDayPlan, TvNowNext, TvStationBoard } from "@/components/tv/TvHall";
import { TvSponsorMoment } from "@/components/tv/TvSlides";
import { useEventHall } from "@/components/tv/useEventHall";
import { useLowMomentTimer, useMinuteTick, useSponsorMoments, useTvSponsors } from "@/components/tv/tvHooks";
import { callsOf } from "@/lib/tvCalls";
import { dayPlan } from "@/lib/tvDayPlan";
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";
import { isLiveMatch, stationName } from "@/lib/tvLive";
import { createMomentQueue } from "@/lib/tvMoments";
import { sortStations, stationState } from "@/lib/tvStationGrid";
import { sponsorFor, sponsorPlan } from "@/lib/tvSponsors";

// Event-TV als Hallen-Tafel (#1126): Gäste finden ohne Nachfragen, was läuft, was als Nächstes kommt und welcher Platz
// frei ist. Links der Tagesplan mit „jetzt“-Linie (bei mehrtägigen Events „Tag 2 von 3“, #884), rechts alle Stationen -
// frei, belegt, aufgerufen (reserviert, #1122), defekt -, unten „Jetzt läuft“ und „Als Nächstes“. Viele Stationen:
// das Raster wird kleiner bis zur Untergrenze, danach blättert es ruhig. Sponsoren nach den Einstellungen (#1125).

const ACTIVE_STATUSES = new Set(["live", "check_in", "checkin_open", "registration_open", "paused"]);

export default function EventTVPage() {
  return (
    <TvScreen>
      <EventTv />
    </TvScreen>
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

function EventTv() {
  const { id } = useParams();
  const { settings } = useTv();
  const { event, stations, matches, lookup, loadError, lastUpdated, load } = useEventHall(id);
  const sponsors = useTvSponsors();
  const minute = useMinuteTick();
  const now = minute * 60000 + 30000;

  const plan = useMemo(() => (event ? dayPlan(event, now) : null), [event, now]);
  const calls = useMemo(() => callsOf(matches, stations, { reportMinutes: settings.report_minutes }), [matches, stations, settings.report_minutes]);
  const entries = useMemo(() => {
    const callByStation = new Map(calls.map((call) => [call.stationId, call]));
    return sortStations(stations).map((station) => {
      const detail = (station.current_match_id && lookup.byId.get(station.current_match_id)) || lookup.byStation.get(station.id) || null;
      const state = stationState(station, detail?.match);
      // Eine freie Station zeigt kein geplantes Spiel als „belegt“ - nur, was dort läuft oder aufgerufen ist.
      const shownDetail = state === "busy" || state === "called" ? detail : null;
      return { station, state, detail: shownDetail, call: callByStation.get(station.id) || null };
    });
  }, [stations, lookup, calls]);

  // Was gerade läuft, in einem Satz: „Winner Bracket, Runde 2 · Spiele an PC 1 und PC 3“.
  const runningText = useCallback((block) => {
    if (block.kind !== "tournament") return block.hint;
    const live = matches.filter((match) => match.tournament_id === block.source.id && isLiveMatch(match));
    if (!live.length) return block.hint;
    const first = live[0];
    const where = [formatBracketSection(first.section), formatRoundName(first.round_name, first.round)].filter(Boolean).join(", ");
    const places = [...new Set(live.map(stationName).filter(Boolean))];
    const games = live.length === 1 ? "1 Spiel" : `${live.length} Spiele`;
    const at = places.length ? ` an ${places.length > 1 ? `${places.slice(0, -1).join(", ")} und ${places.at(-1)}` : places[0]}` : "";
    return `${where} · ${games}${at}`;
  }, [matches]);

  // ------------------------------------------------------------ Sponsor-Moment im Takt (#1125)
  const queue = useMemo(() => createMomentQueue(), []);
  useSyncExternalStore(queue.subscribe, queue.getVersion, queue.getVersion);
  const sponsorsOn = sponsorPlan(settings, sponsors);
  const sponsorSeconds = settings.playlist.find((entry) => entry.slide === "sponsor")?.seconds || 6;
  useSponsorMoments(queue, { enabled: sponsorsOn.moment, everyMinutes: settings.sponsor_every, ms: sponsorSeconds * 1000, sponsors });
  const low = useLowMomentTimer(queue, queue.getCurrent());
  const sponsorShown = low?.moment.type === "sponsor" ? sponsorFor(sponsors, low.moment.sponsorIndex || 0) : null;

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
  const heroImage = event.banner_url || event.cover_url ? resolveMediaUrl(event.banner_url || event.cover_url) : "";
  const place = [event.location, event.city].filter(Boolean).join(", ");
  const hasItems = Boolean(plan?.lanes.length);

  return (
    <div className="tv-page" data-testid="event-tv">
      <TvHeader
        kicker="THE LION SQUAD · EVENT LIVE"
        title={event.name}
        hero={heroImage}
        subtitle={(plan || place) ? (
          <span className="inline-flex flex-wrap items-center gap-x-[1.2em] gap-y-[0.2em]">
            {plan ? <span className="inline-flex items-center gap-[0.4em]" data-testid="tv-event-day"><CalendarDays className="tv-icon tv-accent" /> {plan.title}</span> : null}
            {place ? <span className="inline-flex items-center gap-[0.4em]"><MapPin className="tv-icon tv-gold" /> {place}</span> : null}
          </span>
        ) : null}
        aside={<TvPill tone={ACTIVE_STATUSES.has(event.status) ? (event.status === "live" ? "live" : "accent") : "muted"} live={event.status === "live"}>{statusLabel(event.status)}</TvPill>}
      />

      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Event-Daten" onRetry={load} />

      <main className="tv-main tv-hall" data-testid="tv-hall">
        <section className="tv-panel tv-hall__plan">
          <div className="tv-panel__head items-center">
            <div className="tv-kicker tv-t-meta">Tagesplan{plan ? ` · ${plan.weekday}` : ""}</div>
            <div className="tv-t-info tv-muted" data-testid="tv-plan-clock">{plan?.now ? `jetzt ${plan.now.label}` : plan?.startsText || ""}</div>
          </div>
          <div className="tv-hall__plan-body" data-testid="tv-activity-list">
            {hasItems ? <TvDayPlan plan={plan} /> : <div className="tv-empty tv-t-info">Keine verknüpften Turniere oder Fast Laps</div>}
          </div>
        </section>
        <TvStationBoard entries={entries} />
        <TvNowNext plan={plan} runningText={runningText} />
        {sponsorShown ? (
          <div className="tv-hall__moment">
            <TvSponsorMoment sponsor={sponsorShown} title={event.name} overlay />
          </div>
        ) : null}
      </main>

      <TvFooter qrValue={publicUrl} kicker="Event verfolgen" text="QR scannen und Details öffnen" sponsorMax={5} />
    </div>
  );
}
