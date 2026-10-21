import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { CalendarDays, MapPin } from "lucide-react";
import { resolveMediaUrl } from "@/lib/api";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { TvScreen, useTv } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvKeyRefused, TvPill } from "@/components/tv/TvParts";
import { TvDayPlan, TvNowNext, TvStationBoard } from "@/components/tv/TvHall";
import { TvSponsorMoment } from "@/components/tv/TvSlides";
import { useEventHall } from "@/components/tv/useEventHall";
import { useLowMomentTimer, useMinuteTick, useSponsorMoments, useTvSponsors } from "@/components/tv/tvHooks";
import { callsOf } from "@/lib/tvCalls";
import { dayPlan } from "@/lib/tvDayPlan";
import { publicState } from "@/lib/publicPhase";
import { formatBracketSection, matchRoundLabel } from "@/lib/tournamentLabels";
import { isLiveMatch, matchName, stationName } from "@/lib/tvLive";
import { forecastText, nextUp } from "@/lib/tvForecast";
import { createMomentQueue } from "@/lib/tvMoments";
import { hallStations, sortStations, stationState } from "@/lib/tvStationGrid";
import { sponsorFor, sponsorPlan } from "@/lib/tvSponsors";

// Event-TV als Hallen-Tafel (#1126): Gäste finden ohne Nachfragen, was läuft, was als Nächstes kommt und welcher Platz
// frei ist. Links der Tagesplan mit „jetzt“-Linie (bei mehrtägigen Events „Tag 2 von 3“, #884), rechts alle Stationen -
// frei, belegt, aufgerufen (reserviert, #1122), defekt -, unten „Jetzt läuft“ und „Als Nächstes“. Viele Stationen:
// das Raster wird kleiner bis zur Untergrenze, danach blättert es ruhig. Sponsoren nach den Einstellungen (#1125).
// Seit #1564: dieselbe Station aus mehreren Turnieren steht nur einmal da (bis die Stationen dem Event gehören, #1555),
// und „Als Nächstes“ nennt das nächste Spiel mit Prognose, Station und Verzug.

// Die Pille oben folgt der öffentlichen Phase (#1888), nicht dem Rohstatus: nach dem Ende kein „Live“ mehr, zwischen
// zwei Tagen eines mehrtägigen Events die Pause.
const ACTIVE_STATUSES = new Set(["live", "check_in", "checkin_open", "registration_open", "paused", "day_break"]);

export default function EventTVPage() {
  return (
    <TvScreen>
      <EventTv />
    </TvScreen>
  );
}

function statusLabel(status, fallback) {
  return {
    draft: "Entwurf",
    scheduled: "Geplant",
    registration_open: "Anmeldung",
    registration_closed: "Geschlossen",
    check_in: "Check-in",
    checkin_open: "Check-in",
    live: "Live",
    paused: "Pause",
    day_break: "Pause",
    completed: "Beendet",
    results_published: "Ergebnisse",
    archived: "Archiv",
    cancelled: "Abgesagt",
  }[status] || fallback || status || "Offen";
}

function EventTv() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { settings } = useTv();
  // Mit Anzeige-Schlüssel (#1822) auch die Turniere „Nur Mitglieder“ - am Hallen-TV ohne Anmeldung.
  const { event, stations, matches, lookup, tournamentOfMatch, loadError, keyRefused, lastUpdated, load } = useEventHall(id, { displayKey: params.get("key") || "" });
  const sponsors = useTvSponsors();
  const minute = useMinuteTick();
  const now = minute * 60000 + 30000;

  const plan = useMemo(() => (event ? dayPlan(event, now) : null), [event, now]);
  const calls = useMemo(() => callsOf(matches, stations, { reportMinutes: settings.report_minutes }), [matches, stations, settings.report_minutes]);
  const entries = useMemo(() => {
    const callByStation = new Map(calls.map((call) => [call.stationId, call]));
    return sortStations(hallStations(stations)).map((station) => {
      const ids = station.ids || [station.id];
      const detail = (station.current_match_id && lookup.byId.get(station.current_match_id)) || ids.map((stationId) => lookup.byStation.get(stationId)).find(Boolean) || null;
      const state = stationState(station, detail?.match);
      // Eine freie Station zeigt kein geplantes Spiel als „belegt“ - nur, was dort läuft oder aufgerufen ist.
      const shownDetail = state === "busy" || state === "called" ? detail : null;
      return { station, state, detail: shownDetail, call: ids.map((stationId) => callByStation.get(stationId)).find(Boolean) || null };
    });
  }, [stations, lookup, calls]);

  // Was gerade läuft, in einem Satz: „Winner Bracket, Runde 2 · Spiele an PC 1 und PC 3“.
  const runningText = useCallback((block) => {
    if (block.kind !== "tournament") return block.hint;
    const live = matches.filter((match) => match.tournament_id === block.source.id && isLiveMatch(match));
    if (!live.length) return block.hint;
    const first = live[0];
    const where = [formatBracketSection(first.section), matchRoundLabel(first)].filter(Boolean).join(", ");
    const places = [...new Set(live.map(stationName).filter(Boolean))];
    const games = live.length === 1 ? "1 Spiel" : `${live.length} Spiele`;
    const at = places.length ? ` an ${places.length > 1 ? `${places.slice(0, -1).join(", ")} und ${places.at(-1)}` : places[0]}` : "";
    return `${where} · ${games}${at}`;
  }, [matches]);

  // Das nächste Spiel der Halle mit Prognose (#1564): „Kart-Cup · Spiel C · ca. 16:40 · Switch 2“, dazu der Verzug.
  const nextMatch = useMemo(() => {
    const [entry] = nextUp(matches, { stations, now, limit: 1 });
    if (!entry) return null;
    return { text: [tournamentOfMatch(entry.match), matchName(entry.match), forecastText(entry)].filter(Boolean).join(" · "), delay: entry.delayText };
  }, [matches, stations, now, tournamentOfMatch]);

  // ------------------------------------------------------------ Sponsor-Moment im Takt (#1125)
  const queue = useMemo(() => createMomentQueue(), []);
  useSyncExternalStore(queue.subscribe, queue.getVersion, queue.getVersion);
  const sponsorsOn = sponsorPlan(settings, sponsors);
  const sponsorSeconds = settings.playlist.find((entry) => entry.slide === "sponsor")?.seconds || 6;
  useSponsorMoments(queue, { enabled: sponsorsOn.moment, everyMinutes: settings.sponsor_every, ms: sponsorSeconds * 1000, sponsors });
  const low = useLowMomentTimer(queue, queue.getCurrent());
  const sponsorShown = low?.moment.type === "sponsor" ? sponsorFor(sponsors, low.moment.sponsorIndex || 0) : null;

  if (keyRefused) return <TvKeyRefused />;
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
  const eventState = publicState(event);

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
        aside={<TvPill testId="tv-event-status" tone={ACTIVE_STATUSES.has(eventState) ? (eventState === "live" ? "live" : "accent") : "muted"} live={eventState === "live"}>{statusLabel(eventState, event.public_phase?.label)}</TvPill>}
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
        <TvNowNext plan={plan} runningText={runningText} nextMatch={nextMatch} />
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
