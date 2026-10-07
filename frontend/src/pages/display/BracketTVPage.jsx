import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { isTableFormat } from "@/components/tls/BracketTree";
import { statusBadgeLabel } from "@/components/tls/StatusBadge";
import { TvScreen, useTv } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvPill, TvPresentedBy, toneFor } from "@/components/tv/TvParts";
import { TvBracketStage } from "@/components/tv/TvBracketStage";
import { TvChampionCard, avatarOfRegistration, nameOfRegistration } from "@/components/tv/TvMoments";
import { TvCallBoard } from "@/components/tv/TvCallBoard";
import { TvLiveSlide, TvSlideBar, TvSponsorMoment, TvStatsSlide } from "@/components/tv/TvSlides";
import { TvCheckInScreen, TvPauseScreen, TvRegistrationScreen } from "@/components/tv/TvScreens";
import { useLowMomentTimer, useMinuteTick, useTvSound, useTvSponsors } from "@/components/tv/tvHooks";
import { lastStageId } from "@/lib/bracketPodium";
import { bracketChanges, isLiveMatch } from "@/lib/tvLive";
import { advancementsOf } from "@/lib/tvTravel";
import { championKey, championOf } from "@/lib/tvChampion";
import { COLLECT_AFTER, createMomentQueue } from "@/lib/tvMoments";
import { advance, changesAfter, firstIndex, isDue, onlyMomentSlides, serializePlaylist } from "@/lib/tvPlaylist";
import { callsOf, newCalls, nextPlanned } from "@/lib/tvCalls";
import { statsTiles } from "@/lib/tvStats";
import { presentedBy, sponsorFor, sponsorPlan } from "@/lib/tvSponsors";
import { tvScreenFor } from "@/lib/tvScreens";
import { viennaTime } from "@/lib/vienna";

// Turnierbaum-TV (#1110, #1115-#1127): derselbe Baum wie auf der Turnierseite, mit Linien, auf einer festen Bühne - und
// seit Meilenstein 60 eine Wiedergabeliste (#1121): Baum, Live-Spiele, Aufrufe, zwischendurch Sponsor und Zahlen, jede
// Folie so lang, wie die Einstellung sagt; ein dünner Balken zeigt, wann gewechselt wird. Kommt ein Ergebnis, hält die
// Liste an, der Baum zeigt den Moment, danach läuft die Folie zu Ende. Ohne Spiel wählt der TV selbst: Pause, Check-in
// oder Anmeldung (#1123). Immer nur ein Moment; nach dem Neuladen gleich der aktuelle Stand - ohne Fahrten, Zoom oder
// Konfetti. Mit Anzeige-Schlüssel im Link läuft die Seite ohne Anmeldung.

const EMPTY = new Set();
const HIGH = new Set(["champion", "result", "live"]);

export default function BracketTVPage() {
  return (
    <TvScreen>
      <BracketTv />
    </TvScreen>
  );
}

/**
 * Die Wiedergabeliste: welche Folie gerade dran ist, seit wann, ob sie pausiert. Am Ende einer Folie kommt die nächste
 * mit Inhalt; Sponsor und Zahlen auf dem Weg dorthin gehen als Moment an die Warteschlange (`onMoments`). Bleibt es bei
 * derselben Folie, wird sie nicht neu aufgebaut (sonst blendet sie alle paar Sekunden neu ein) - nur ihre Zeit beginnt
 * von vorn (`tick`). `turn` zählt, wie oft die Folie schon dran war: eine Sponsor-Folie nimmt so den nächsten Sponsor.
 */
function startRun(playlist, available, id) {
  const index = firstIndex(playlist, available);
  return { index, id, tick: 0, turns: { [index]: 0 } };
}

function usePlaylist({ playlist, availableRef, paused, onMoments }) {
  const key = serializePlaylist(playlist);
  const [run, setRun] = useState(() => startRun(playlist, availableRef.current, 1));
  const clock = useRef({ startedAt: Date.now(), elapsed: 0 });
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;

  // Eine neue Liste (Grundwerte oder Link geändert): von vorn, bei der ersten Folie mit Inhalt.
  const firstKey = useRef(key);
  useEffect(() => {
    if (firstKey.current === key) return;
    firstKey.current = key;
    setRun((current) => startRun(playlistRef.current, availableRef.current, current.id + 1));
  }, [key, availableRef]);

  // Eine neue Folie (oder dieselbe noch einmal) beginnt bei 0 - pausiert die Liste gerade, läuft ihre Zeit erst nach
  // dem Moment.
  useLayoutEffect(() => {
    clock.current = { startedAt: pausedRef.current ? null : Date.now(), elapsed: 0 };
  }, [run.id, run.tick]);

  useEffect(() => {
    const state = clock.current;
    if (paused && state.startedAt !== null) {
      state.elapsed += Date.now() - state.startedAt;
      state.startedAt = null;
    } else if (!paused && state.startedAt === null) state.startedAt = Date.now();
  }, [paused]);

  const index = Math.min(run.index, Math.max(0, playlist.length - 1));
  const seconds = playlist[index]?.seconds || 10;
  useEffect(() => {
    if (paused) return undefined;
    const state = clock.current;
    const ran = state.elapsed + (state.startedAt === null ? 0 : Date.now() - state.startedAt);
    const timer = window.setTimeout(() => {
      const list = playlistRef.current;
      const next = advance(list, Math.min(run.index, list.length - 1), availableRef.current);
      if (next.moments.length) onMoments(next.moments, list);
      setRun((current) => {
        const turns = { ...current.turns, [next.index]: next.index in current.turns ? current.turns[next.index] + 1 : 0 };
        if (next.index === current.index) return { ...current, tick: current.tick + 1, turns };
        return { index: next.index, id: current.id + 1, tick: 0, turns };
      });
    }, Math.max(0, seconds * 1000 - ran));
    return () => window.clearTimeout(timer);
  }, [paused, run, seconds, key, availableRef, onMoments]);

  return { index, runId: run.id, tick: run.tick, turn: run.turns[index] || 0, clock, totalMs: seconds * 1000 };
}

function BracketTv() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const displayKey = params.get("key") || "";
  const { motionOn, settings } = useTv();
  const [data, setData] = useState(null);
  const [stations, setStations] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [keyRefused, setKeyRefused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const sponsors = useTvSponsors();
  const minute = useMinuteTick();

  const load = useCallback(async () => {
    try {
      const { data: br } = await api.get(`/tournaments/${id}/bracket/display`, displayKey ? { params: { key: displayKey } } : undefined);
      setData(br);
      setLoadError(null);
      setKeyRefused(false);
      setLastUpdated(Date.now());
      // Die Stationen (öffentlich, wie bisher): wer reserviert ist, steht auf der Aufruf-Tafel (#1122).
      const tournamentId = br?.tournament?.id || id;
      try {
        const { data: list } = await api.get(`/stations?tournament_id=${encodeURIComponent(tournamentId)}`);
        setStations(Array.isArray(list) ? list : []);
      } catch {
        setStations((current) => current);
      }
    } catch (error) {
      const status = error?.response?.status;
      // Widerrufen oder falsch: der Bildschirm zeigt nichts mehr vom Turnier, nur wie es weitergeht.
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
  // Die TV-Anzeige läuft stundenlang: ohne Strom alle 15 s nachfragen. „tv“: ein widerrufener Schlüssel wirkt sofort.
  useLiveRefresh(load, ["tournaments", "matches", "stations", "tv"], { fallbackMs: 15000 });

  const t = data?.tournament;
  const matches = useMemo(() => data?.matches_v2 || [], [data?.matches_v2]);
  const registrations = useMemo(() => data?.registrations || [], [data?.registrations]);
  const nameOf = useMemo(() => nameOfRegistration(registrations), [registrations]);
  const avatarOf = useMemo(() => avatarOfRegistration(registrations), [registrations]);
  const hasMatches = matches.length > 0;
  const screen = tvScreenFor(t, { now: minute * 60000 + 30000 });
  const playlist = settings.playlist;
  const treeInList = playlist.some((entry) => entry.slide === "tree");
  const showMoments = screen === "playlist" && treeInList && hasMatches;

  // ------------------------------------------------------------ Momente
  const queue = useMemo(() => createMomentQueue(), []);
  useSyncExternalStore(queue.subscribe, queue.getVersion, queue.getVersion);
  const moment = queue.getCurrent();
  const highMoment = moment && HIGH.has(moment.type) ? moment : null;
  const lowMoment = useLowMomentTimer(queue, moment);
  const [hidden, setHidden] = useState(EMPTY);
  const [championState, setChampionState] = useState({ key: "", parked: false });
  const [parkSpot, setParkSpot] = useState("");
  const snapshotRef = useRef(null);
  const championKeyRef = useRef(null);
  const champion = useMemo(() => (data ? championOf(matches, data.stages || []) : null), [data, matches]);

  useEffect(() => {
    if (!data) return;
    const { started, decided, snapshot } = bracketChanges(snapshotRef.current, matches);
    const first = snapshotRef.current === null;
    snapshotRef.current = snapshot;
    const key = championKey(champion);
    // Beim ersten Laden ist nichts neu: steht der Sieger schon fest, gleich das Endbild - ohne Konfetti.
    if (first) {
      championKeyRef.current = key;
      setChampionState({ key, parked: Boolean(champion) });
      return;
    }
    if (!showMoments) {
      // Pause, Check-in, Anmeldung oder ein Bildschirm ohne Baum: nichts nachholen, nur den Stand merken.
      championKeyRef.current = key;
      setChampionState({ key, parked: Boolean(champion) });
      return;
    }
    if (key !== championKeyRef.current) {
      championKeyRef.current = key;
      setChampionState({ key, parked: false });
      if (champion) queue.enqueue({ type: "champion", key });
    }
    // Das Finale bekommt den Champion-Moment statt einer Ergebnis-Karte.
    const results = decided.filter((matchId) => !champion || matchId !== champion.finalMatchId);
    if (results.length) {
      if (motionOn) {
        // Bis die Fahrt ankommt, zeigen die Ziel-Plätze noch, wer kommt - dann landet der Name dort.
        const keys = [];
        for (const matchId of results) {
          const match = matches.find((row) => row.id === matchId);
          for (const move of advancementsOf(match, matches)) {
            if (move.target && ["win", "drop"].includes(move.kind)) keys.push(`${move.target.matchId}:${move.target.slotIndex}`);
          }
        }
        if (keys.length) setHidden((current) => new Set([...current, ...keys]));
      }
      if (results.length > COLLECT_AFTER) queue.enqueue({ type: "result", items: results });
      else results.forEach((matchId) => queue.enqueue({ type: "result", items: [matchId] }));
    }
    if (started.length) queue.enqueue({ type: "live", matchIds: started });
    queue.next();
  }, [data, matches, champion, queue, motionOn, showMoments]);

  const onMomentDone = useCallback((momentId) => {
    queue.finish(momentId);
    queue.next();
  }, [queue]);
  const onReveal = useCallback((keys) => {
    if (!keys?.length) return;
    setHidden((current) => {
      if (!keys.some((key) => current.has(key))) return current;
      const next = new Set(current);
      keys.forEach((key) => next.delete(key));
      return next.size ? next : EMPTY;
    });
  }, []);
  const onChampionParked = useCallback(() => setChampionState((current) => ({ ...current, parked: true })), []);
  // Ohne Bewegung landen Namen sofort - es gibt nichts zu verstecken.
  const hiddenSlots = motionOn ? hidden : EMPTY;

  // ------------------------------------------------------------ Inhalte der Folien
  const live = useMemo(() => matches.filter(isLiveMatch), [matches]);
  const calls = useMemo(() => callsOf(matches, stations, { reportMinutes: settings.report_minutes }), [matches, stations, settings.report_minutes]);
  const upcoming = useMemo(() => nextPlanned(matches, calls, { limit: 3 }), [matches, calls]);
  const tiles = useMemo(() => statsTiles(matches, nameOf), [matches, nameOf]);
  const plan = sponsorPlan(settings, sponsors);
  const lastStage = lastStageId(matches, data?.stages || []);
  const isLastStage = useCallback((match) => !lastStage || (match.stage_id || "__default") === lastStage, [lastStage]);
  const isTable = useCallback((match) => isTableFormat([match]), []);

  // Wann Sponsor und Zahlen zuletzt kamen - der erste kommt nach dem ersten Takt, nicht gleich beim Einschalten.
  const lastLow = useRef({ sponsor: Date.now(), stats: Date.now() });
  const sponsorCount = useRef(0);
  // Eine Liste nur aus Sponsor und/oder Zahlen (ein Bildschirm nur dafür): dann stehen sie dauerhaft, statt zwischendurch.
  const onlyLow = onlyMomentSlides(playlist);
  const available = (slide) => {
    if (slide === "tree") return hasMatches;
    if (slide === "live") return live.length > 0;
    if (slide === "calls") return calls.length > 0;
    if (slide === "sponsor") return plan.moment && (onlyLow || isDue(lastLow.current.sponsor, settings.sponsor_every));
    if (slide === "stats") return Boolean(settings.stats) && tiles.length > 0 && (onlyLow || isDue(lastLow.current.stats, settings.stats_every));
    return false;
  };
  const availableRef = useRef(available);
  availableRef.current = available;

  const onMoments = useCallback((slides, list) => {
    for (const slide of slides) {
      const seconds = list.find((entry) => entry.slide === slide)?.seconds || 6;
      lastLow.current[slide] = Date.now();
      if (slide === "sponsor") {
        queue.enqueue({ type: "sponsor", ms: seconds * 1000, sponsorIndex: sponsorCount.current });
        sponsorCount.current += 1;
      } else queue.enqueue({ type: "stats", ms: seconds * 1000 });
    }
    queue.next();
  }, [queue]);

  const paused = Boolean(moment) || screen !== "playlist";
  const playing = usePlaylist({ playlist, availableRef, paused, onMoments });
  const current = playlist[playing.index]?.slide || "tree";
  const active = highMoment ? "tree" : lowMoment ? lowMoment.moment.type : current;
  const showBar = !moment && screen === "playlist" && changesAfter(playlist, playing.index, available);

  // ------------------------------------------------------------ Ton
  const { gong, needsClick } = useTvSound(Boolean(settings.result_sound || settings.call_sound));
  const callIdsRef = useRef(null);
  useEffect(() => {
    if (!data) return;
    const fresh = newCalls(callIdsRef.current, calls);
    callIdsRef.current = new Set(calls.map((call) => call.matchId));
    if (fresh.length && settings.call_sound && gong && screen === "playlist") gong.play();
  }, [data, calls, settings.call_sound, gong, screen]);

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

  const publicUrl = t ? `${window.location.origin}/tournaments/${t.slug || t.id}/bracket` : window.location.origin;
  const registerUrl = t ? `${window.location.origin}/tournaments/${t.slug || t.id}` : window.location.origin;
  const parked = Boolean(champion) && championState.parked && championState.key === championKey(champion);
  const presented = plan.presented && screen === "playlist" ? presentedBy(t, matches, sponsors) : null;
  const sponsorShown = lowMoment?.moment.type === "sponsor"
    ? sponsorFor(sponsors, lowMoment.moment.sponsorIndex || 0)
    : onlyLow && active === "sponsor" && plan.moment ? sponsorFor(sponsors, playing.turn) : null;
  // Ein Bildschirm nur für Sponsor und Zahlen, aber gerade nichts davon: ein ruhiger Satz statt einer leeren Fläche.
  const lowEmpty = !onlyLow || lowMoment ? null
    : active === "sponsor" && !sponsorShown ? (settings.sponsor_moment ? "Gerade kein Sponsor für den TV" : "Sponsoren am TV sind ausgeschaltet")
      : active === "stats" && !tiles.length ? (settings.stats ? "Noch keine Zahlen zum Turnier" : "Zahlen zum Turnier sind ausgeschaltet") : null;
  const subtitle = !t ? null
    : screen === "pause" ? (t.paused_until ? `Pause bis ${viennaTime(t.paused_until, { hour: "2-digit", minute: "2-digit" })}` : "Kurze Pause")
      : screen === "checkin" ? "Check-in"
        : screen === "registration" ? "Anmeldung offen"
          : hasMatches ? (parked ? "Turnier entschieden" : { tree: "Turnierbaum", live: "Live-Spiele", calls: "Aufrufe", sponsor: "Unser Partner", stats: "Zahlen zum Turnier" }[active] || "Turnierbaum") : null;

  return (
    <div className="tv-page" data-testid="bracket-tv" data-screen={screen} data-slide={screen === "playlist" ? active : undefined}>
      {t ? (
        <TvHeader
          className="tls-header-sweep"
          // Rot heißt „läuft gerade“ (#1116): der Punkt in der Kopfleiste nur, solange das Turnier läuft.
          kicker={toneFor(t.status) === "live" ? "THE LION SQUAD · LIVE" : "THE LION SQUAD · TURNIERBAUM"}
          live={toneFor(t.status) === "live"}
          title={t.title}
          subtitle={subtitle}
          aside={(
            <>
              {presented ? <TvPresentedBy label={presented.label} sponsor={presented.sponsor} /> : null}
              {parked && parkSpot === "header" && active === "tree" ? (
                <TvChampionCard champion={champion} registrations={registrations} parked spot="header" testId="tv-champion-parked" />
              ) : null}
              <TvPill tone={toneFor(t.status)} live={toneFor(t.status) === "live"} testId={`status-${t.status}`}>{statusBadgeLabel(t.status)}</TvPill>
            </>
          )}
        />
      ) : null}
      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label="Turnierbaum" onRetry={load} />

      <main className="tv-main tv-main--slides" data-testid="tv-main" data-paused={paused ? "1" : "0"} data-run={playing.runId} data-moment={moment?.type || undefined}>
        {showBar && !lowMoment ? <TvSlideBar key={`${playing.runId}-${playing.tick}`} clock={playing.clock} totalMs={playing.totalMs} paused={paused} /> : null}
        {lowMoment ? <TvSlideBar key={lowMoment.moment.id} clock={{ current: { startedAt: lowMoment.startedAt, elapsed: 0 } }} totalMs={lowMoment.ms} /> : null}
        <div className="h-full min-h-0 relative" data-testid="tv-board-area">
          {!data ? (
            <div className="tv-empty tv-t-head font-display">{loadError ? "Turnierbaum konnte nicht geladen werden" : "Lade Turnierbaum …"}</div>
          ) : screen === "pause" ? (
            <TvPauseScreen tournament={t} matches={matches} />
          ) : screen === "checkin" ? (
            <TvCheckInScreen tournament={t} registrations={registrations} />
          ) : screen === "registration" ? (
            <TvRegistrationScreen tournament={t} seats={data.seats} registrations={registrations} url={registerUrl} />
          ) : (
            <>
              {treeInList && hasMatches ? (
                <div className="tv-slide tv-slide--tree" data-active={active === "tree" ? "1" : "0"} aria-hidden={active === "tree" ? undefined : "true"}>
                  <TvBracketStage
                    data={data}
                    moment={highMoment}
                    onMomentDone={onMomentDone}
                    hiddenSlots={hiddenSlots}
                    onReveal={onReveal}
                    champion={champion}
                    championParked={parked}
                    onChampionParked={onChampionParked}
                    onParkSpot={setParkSpot}
                    gong={settings.result_sound ? gong : null}
                    active={active === "tree"}
                  />
                </div>
              ) : null}
              {active === "tree" && !hasMatches ? (
                <div className="tv-empty tv-t-head font-display">Turnierbaum wurde noch nicht generiert</div>
              ) : null}
              {active === "live" ? (
                <div className="tv-slide" key={`live-${playing.runId}`}>
                  <TvLiveSlide live={live} matches={matches} nameOf={nameOf} avatarOf={avatarOf} lastStage={isLastStage} isTable={isTable} />
                </div>
              ) : null}
              {active === "calls" ? (
                <div className="tv-slide" key={`calls-${playing.runId}`}>
                  <TvCallBoard calls={calls} upcoming={upcoming} matches={matches} nameOf={nameOf} avatarOf={avatarOf} />
                </div>
              ) : null}
              {active === "sponsor" && sponsorShown ? (
                <div className="tv-slide" key={`sponsor-${lowMoment ? lowMoment.moment.id : sponsorShown.id || sponsorShown.logo_url}`}>
                  <TvSponsorMoment sponsor={sponsorShown} title={t?.title || ""} />
                </div>
              ) : null}
              {active === "stats" && tiles.length ? (
                <div className="tv-slide" key={`stats-${lowMoment ? lowMoment.moment.id : playing.runId}`}>
                  <TvStatsSlide tiles={tiles} avatarOf={avatarOf} />
                </div>
              ) : null}
              {lowEmpty ? <div className="tv-empty tv-t-head font-display" data-testid="tv-slide-empty">{lowEmpty}</div> : null}
            </>
          )}
        </div>
      </main>

      <TvFooter qrValue={screen === "registration" ? registerUrl : publicUrl} kicker={screen === "registration" ? "Jetzt anmelden" : "Jetzt mitfiebern"} text={screen === "registration" ? "QR scannen und anmelden" : "QR scannen und Turnierbaum öffnen"} />
      {needsClick ? <div className="tv-hint tv-t-meta" role="status" data-testid="tv-sound-hint">Für Ton einmal klicken</div> : null}
    </div>
  );
}
