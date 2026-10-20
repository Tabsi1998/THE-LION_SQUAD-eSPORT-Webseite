import { useEffect, useMemo, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { TvScreen, useTv } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvKeyRefused, TvPill } from "@/components/tv/TvParts";
import { TvCallBoard } from "@/components/tv/TvCallBoard";
import { avatarOfRegistration, nameOfRegistration } from "@/components/tv/TvMoments";
import { useEventHall } from "@/components/tv/useEventHall";
import { useMinuteTick, useTvSound } from "@/components/tv/tvHooks";
import { callsOf, newCalls } from "@/lib/tvCalls";
import { nextUp } from "@/lib/tvForecast";

// Aufruf-Tafel für ein ganzes Event (#1122): ein Bildschirm nur für Aufrufe, über alle Turniere des Events - wer jetzt an
// welche Station soll, mit Countdown. Ohne Aufrufe „Gerade keine Aufrufe“ und die nächsten geplanten Spiele. Der Gong
// beim Aufruf ist eine Einstellung (Standard aus). Läuft ohne Anmeldung wie der Event-TV; Turniere „Nur Mitglieder“
// zeigt sie mit dem Anzeige-Schlüssel des Events im Link (#1822).

export default function EventCallsTVPage() {
  return (
    <TvScreen>
      <EventCallsTv />
    </TvScreen>
  );
}

function EventCallsTv() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { settings } = useTv();
  // Mit Anzeige-Schlüssel (#1822) auch die Aufrufe der Turniere „Nur Mitglieder“ - am Hallen-TV ohne Anmeldung.
  const { event, stations, matches, registrations, tournamentOfMatch, loadError, keyRefused, lastUpdated, load } = useEventHall(id, { displayKey: params.get("key") || "" });
  const calls = useMemo(() => callsOf(matches, stations, { reportMinutes: settings.report_minutes }), [matches, stations, settings.report_minutes]);
  // Was danach kommt (#1564): mit Prognose und Verzug - jede Minute neu gerechnet.
  const minute = useMinuteTick();
  const upcoming = useMemo(() => nextUp(matches, { stations, now: Math.max(Date.now(), minute * 60000), limit: 3, exclude: new Set(calls.map((call) => call.matchId)) }), [matches, stations, calls, minute]);
  const nameOf = useMemo(() => nameOfRegistration(registrations), [registrations]);
  const avatarOf = useMemo(() => avatarOfRegistration(registrations), [registrations]);
  const titles = new Set(matches.map((match) => tournamentOfMatch(match)).filter(Boolean));

  const { gong, needsClick } = useTvSound(Boolean(settings.call_sound));
  const seenRef = useRef(null);
  useEffect(() => {
    if (!event) return;
    const fresh = newCalls(seenRef.current, calls);
    seenRef.current = new Set(calls.map((call) => call.matchId));
    if (fresh.length && gong) gong.play();
  }, [event, calls, gong]);

  if (keyRefused) return <TvKeyRefused />;
  if (!event) {
    return (
      <div className="tv-page">
        <DisplayStatusBanner error={loadError} label="Aufrufe" onRetry={load} />
        <div className="tv-main">
          <div className="tv-empty tv-t-head font-display">{loadError ? "Aufrufe konnten nicht geladen werden" : "Lade Aufrufe …"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="tv-page" data-testid="event-calls-tv">
      <TvHeader
        kicker="THE LION SQUAD · AUFRUFE"
        live={calls.length > 0}
        title="Aufrufe"
        subtitle={[event.name, ...[...titles].slice(0, 3)].filter(Boolean).join(" · ")}
        aside={<TvPill tone={calls.length ? "gold" : "muted"}>{calls.length ? `${calls.length} ${calls.length === 1 ? "Aufruf" : "Aufrufe"}` : "Keine Aufrufe"}</TvPill>}
      />
      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Aufrufe" onRetry={load} />
      <main className="tv-main" data-testid="tv-main">
        <TvCallBoard calls={calls} upcoming={upcoming} matches={matches} nameOf={nameOf} avatarOf={avatarOf} tournamentOf={titles.size > 1 ? tournamentOfMatch : null} />
      </main>
      <TvFooter qrValue={`${window.location.origin}/events/${event.slug || event.id}`} kicker="Event verfolgen" text="QR scannen und Details öffnen" sponsorMax={5} />
      {needsClick ? <div className="tv-hint tv-t-meta" role="status" data-testid="tv-sound-hint">Für Ton einmal klicken</div> : null}
    </div>
  );
}
