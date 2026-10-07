import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { isTableFormat } from "@/components/tls/BracketTree";
import { TvScreen, useTv } from "@/components/tv/TvScreen";
import { TvCallCountdown } from "@/components/tv/TvCallBoard";
import { TvFooter, TvHeader, TvPill } from "@/components/tv/TvParts";
import { TvSpotlight } from "@/components/tv/TvTreeNode";
import { TvLineup } from "@/components/tv/TvStartGrid";
import { avatarOfRegistration, nameOfRegistration } from "@/components/tv/TvMoments";
import { lastStageId } from "@/lib/bracketPodium";
import { isMatchDone, plannedText } from "@/lib/slotSource";
import { callsOf } from "@/lib/tvCalls";
import { stationLineup } from "@/lib/tvGrid";
import { isLiveMatch, matchName } from "@/lib/tvLive";
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";

// Stations-Ansicht (#1120): ein Bildschirm direkt an einer Station zeigt nur, was dort läuft oder als Nächstes kommt -
// Durchgänge als Startaufstellung, Duelle als „A gegen B“. Ist das Spiel dort gerade entschieden, bleibt das Ergebnis
// eine Minute stehen (weiter / Loser Bracket / raus), dann kommt das nächste. Derselbe Anzeige-Schlüssel wie beim
// Turnierbaum; der Link kommt aus dem Link-Baukasten unter TV & Beamer. Ist das nächste Spiel hier aufgerufen (#1122),
// steht „Aufgerufen – bitte jetzt hierher“ mit demselben Countdown wie auf der Aufruf-Tafel.

const RESULT_HOLD_MS = 60000;

export default function StationTVPage() {
  return (
    <TvScreen>
      <StationTv />
    </TvScreen>
  );
}

function StationTv() {
  const { id, stationId } = useParams();
  const { settings } = useTv();
  const [params] = useSearchParams();
  const displayKey = params.get("key") || "";
  const [data, setData] = useState(null);
  const [stations, setStations] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [keyRefused, setKeyRefused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: br } = await api.get(`/tournaments/${id}/bracket/display`, displayKey ? { params: { key: displayKey } } : undefined);
      const tournamentId = br?.tournament?.id || id;
      const { data: list } = await api.get(`/stations?tournament_id=${encodeURIComponent(tournamentId)}`);
      setData(br);
      setStations(Array.isArray(list) ? list : []);
      setLoadError(null);
      setKeyRefused(false);
      setLastUpdated(Date.now());
    } catch (error) {
      const status = error?.response?.status;
      if (displayKey && (status === 401 || status === 403)) {
        setKeyRefused(true);
        setData(null);
      }
      setLoadError(error);
    }
  }, [id, displayKey]);

  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, ["tournaments", "matches", "stations", "tv"], { fallbackMs: 15000 });

  const matches = useMemo(() => data?.matches_v2 || [], [data?.matches_v2]);
  const station = (stations || []).find((entry) => entry.id === stationId) || null;
  const lineup = stationLineup(stationId, station, matches);

  // Ein Spiel, das hier gerade entschieden wurde, bleibt eine Minute stehen - so sieht man, wer weiterkommt.
  const shownRef = useRef(null);
  const [recent, setRecent] = useState(null);
  useEffect(() => {
    const previous = shownRef.current;
    if (previous) {
      const now = matches.find((match) => match.id === previous);
      if (now && isMatchDone(now) && (now.results || []).length && lineup.match?.id !== previous) {
        setRecent({ id: previous, until: Date.now() + RESULT_HOLD_MS });
      }
    }
    shownRef.current = lineup.match?.id || null;
  }, [matches, lineup.match?.id]);
  useEffect(() => {
    if (!recent) return undefined;
    const timer = window.setTimeout(() => setRecent(null), Math.max(0, recent.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [recent]);

  if (keyRefused) {
    return (
      <div className="tv-page" data-testid="tv-key-refused">
        <div className="flex-1 flex flex-col items-center justify-center gap-[calc(var(--tv-u)*1.5)] px-[var(--tv-edge)] text-center">
          <div className="tv-t-head font-heading font-black uppercase">Dieser TV-Link gilt nicht mehr</div>
          <div className="tv-t-info tv-muted">Im Admin unter eSports → TV &amp; Beamer einen neuen Link erstellen und hier öffnen.</div>
        </div>
      </div>
    );
  }

  const t = data?.tournament;
  const finishedMatch = recent ? matches.find((match) => match.id === recent.id) : null;
  const match = finishedMatch || lineup.match;
  const mode = finishedMatch ? "done" : lineup.mode;
  const stationTitle = station?.name || station?.label || "Station";
  const nameOf = nameOfRegistration(data?.registrations || []);
  const avatarOf = avatarOfRegistration(data?.registrations || []);
  const lastStage = lastStageId(matches, data?.stages || []);
  const publicUrl = t ? `${window.location.origin}/tournaments/${t.slug || t.id}/bracket` : window.location.origin;
  const call = mode === "next" && match ? callsOf([match], station ? [station] : [], { reportMinutes: settings.report_minutes })[0] || null : null;
  const pill = mode === "live" ? ["live", "Läuft"] : mode === "done" ? ["gold", "Entschieden"] : call ? ["gold", "Aufgerufen"] : mode === "next" ? ["accent", "Als Nächstes"] : ["green", "Frei"];

  return (
    <div className="tv-page" data-testid="station-tv">
      <TvHeader
        kicker="THE LION SQUAD · STATION"
        live={mode === "live"}
        title={stationTitle}
        subtitle={t?.title || null}
        aside={<TvPill tone={pill[0]} live={mode === "live"} testId="station-tv-state">{pill[1]}</TvPill>}
      />
      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Station" onRetry={load} />
      <main className="tv-main" data-testid="tv-main">
        {!data || !stations ? (
          <div className="tv-empty tv-t-head font-display">{loadError ? "Station konnte nicht geladen werden" : "Lade Station …"}</div>
        ) : !station ? (
          <div className="tv-empty tv-t-head font-display" data-testid="station-tv-missing">Diese Station gibt es in diesem Turnier nicht</div>
        ) : !match ? (
          <div className="tv-empty tv-t-head font-display" data-testid="station-tv-free">Hier ist gerade nichts geplant</div>
        ) : (
          <section className="tv-station" data-testid="station-tv-match" data-mode={mode} data-match={match.id}>
            <div className="tv-station__head">
              <div className="min-w-0">
                <div className="tv-kicker tv-t-info">
                  {mode === "live" ? "Läuft gerade" : mode === "done" ? "Gerade entschieden" : "Als Nächstes"} · {formatBracketSection(match.section)} · {formatRoundName(match.round_name, match.round)}
                </div>
                <h2 className="tv-t-title font-heading font-black uppercase">{matchName(match)}</h2>
              </div>
              {mode === "live" && isLiveMatch(match) ? (
                <TvSpotlight match={match} className="tv-station__spot" />
              ) : call ? (
                <div className="tv-station__call" data-testid="station-tv-call">
                  <span className="tv-call__go tv-t-info">Aufgerufen – bitte jetzt hierher</span>
                  <TvCallCountdown call={call} small />
                </div>
              ) : mode === "next" && plannedText(match) ? (
                <div className="tv-station__when tv-t-head" data-testid="station-tv-when">{plannedText(match)}</div>
              ) : null}
            </div>
            <div className="tv-station__body">
              <TvLineup
                match={match}
                matches={matches}
                nameOf={nameOf}
                avatarOf={avatarOf}
                lastStage={!lastStage || (match.stage_id || "__default") === lastStage}
                table={isTableFormat([match])}
              />
            </div>
          </section>
        )}
      </main>
      <TvFooter qrValue={publicUrl} kicker="Jetzt mitfiebern" text="QR scannen und Turnierbaum öffnen" />
    </div>
  );
}
