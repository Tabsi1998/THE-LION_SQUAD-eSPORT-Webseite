import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { invalidationMatches, isStreamConnected, subscribeApiInvalidation, subscribeStreamState } from "@/lib/apiInvalidation";
import { DisplayStatusBanner } from "@/components/tls/DisplayStatusBanner";
import { isTableFormat } from "@/components/tls/BracketTree";
import { statusBadgeLabel } from "@/components/tls/StatusBadge";
import { TvScreen, useTv } from "@/components/tv/TvScreen";
import { TvFooter, TvHeader, TvPill, TvPresentedBy, toneFor } from "@/components/tv/TvParts";
import { TvBracketStage } from "@/components/tv/TvBracketStage";
import { TvChampionCard, avatarOfRegistration, nameOfRegistration } from "@/components/tv/TvMoments";
import { TvCallBoard } from "@/components/tv/TvCallBoard";
import { TvQueueBoard } from "@/components/tv/TvQueueBoard";
import { TvLiveSlide, TvSlideBar, TvSponsorMoment, TvStatsSlide } from "@/components/tv/TvSlides";
import { TvCheckInScreen, TvPauseScreen, TvRegistrationScreen } from "@/components/tv/TvScreens";
import { TvNextUp } from "@/components/tv/TvNextUp";
import { TvStandingsSlide } from "@/components/tv/TvStandings";
import { useLowMomentTimer, useMinuteTick, useTvSound, useTvSponsors } from "@/components/tv/tvHooks";
import { lastStageId } from "@/lib/bracketPodium";
import { bracketChanges, bracketSnapshot, isLiveMatch } from "@/lib/tvLive";
import { slotDraw } from "@/lib/bracketGraph";
import { advancementsOf } from "@/lib/tvTravel";
import { championKey, championOf } from "@/lib/tvChampion";
import { TABLE_SLIDE, isTreeless, tableChampionOf, tvTableSections, tvWords, withTableSlide } from "@/lib/tvTable";
import { nameHead } from "@/lib/standingsTable";
import { COLLECT_AFTER, createMomentQueue, momentsFromChange } from "@/lib/tvMoments";
import { advance, changesAfter, firstIndex, isDue, onlyMomentSlides, serializePlaylist } from "@/lib/tvPlaylist";
import { callsOf, newCalls } from "@/lib/tvCalls";
import { forecastBoard, nextUp } from "@/lib/tvForecast";
import { statsTiles } from "@/lib/tvStats";
import { hasQueue } from "@/lib/tvQueue";
import { presentedBy, sponsorFor, sponsorPlan } from "@/lib/tvSponsors";
import { tvScreenFor } from "@/lib/tvScreens";
import { viennaTime } from "@/lib/vienna";

// Turnierbaum-TV (#1110, #1115-#1127): derselbe Baum wie auf der Turnierseite, mit Linien, auf einer festen Bühne - und
// seit Meilenstein 60 eine Wiedergabeliste (#1121): Baum, Live-Spiele, Aufrufe, zwischendurch Sponsor und Zahlen, jede
// Folie so lang, wie die Einstellung sagt; ein dünner Balken zeigt, wann gewechselt wird. Kommt ein Ergebnis, hält die
// Liste an, der Baum zeigt den Moment, danach läuft die Folie zu Ende. Ohne Spiel wählt der TV selbst: Pause, Check-in
// oder Anmeldung (#1123). Immer nur ein Moment; nach dem Neuladen gleich der aktuelle Stand - ohne Fahrten, Zoom oder
// Konfetti. Mit Anzeige-Schlüssel im Link läuft die Seite ohne Anmeldung.
// Seit #1564 hat jedes Turnier-Ereignis seinen Moment (Auslosung, zusammengelegt, kampflos, korrigiert, entfällt) - aus
// demselben Vergleich wie der Web-Baum, genau einmal. Nach einer Neuverbindung holt der TV den Stand ruhig nach, wie
// beim ersten Laden. Unten stehen „Läuft“ und „Als Nächstes“ mit Prognose und Verzug.
// Seit #1634: Show-Auslosung bereit und der sofort gezogene Platz sind eigene Momente; hat das Turnier vor Ort eine
// Live-Warteschlange (GET /live-queue mit demselben Schlüssel), zeigt die Folie „Aufrufe“ je Station Jetzt und Als
// Nächstes - nachgeladen wie der Baum (Strom und Ersatz-Abfrage). Ohne Warteschlange bleibt alles wie vorher.

const EMPTY = new Set();
const NO_TAGS = new Map();
// Momente, die auf dem Baum spielen (die anderen sind Folien: Sponsor, Zahlen).
const HIGH = new Set(["champion", "result", "live", "draw", "draw_ready", "draw_assigned", "merge", "mark"]);
// Mehr Ereignisse auf einmal sind kein Live-Geschehen mehr (Neuaufbau, Nachladen) - dann ohne Moment ans Ende.
const MAX_EVENTS = 48;
// Worauf der TV hört - dieselbe Liste für das Nachladen und das Zählen der Meldungen aus dem Strom.
const LIVE_RESOURCES = ["tournaments", "matches", "stations", "tv"];
const FINISHED = new Set(["completed", "results_published", "archived"]);
const isTable = (match) => isTableFormat([match]);

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
  // Live-Warteschlange je Station (#1634) - `null`, solange es keine gibt (online, keine Stationen, alter Server).
  const [liveQueue, setLiveQueue] = useState(null);
  // Ein Server ohne Warteschlange (404/405, ältere Stände): für diese Sitzung nicht mehr fragen - sonst fragt jeder TV
  // in der Halle alle 15 s vergeblich nach (Codex zu #1634).
  const queueOffRef = useRef(false);
  const [loadError, setLoadError] = useState(null);
  const [keyRefused, setKeyRefused] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  // Nach einer Neuverbindung (#1564, wie die Turnierseite #1561): der nächste Stand holt Verpasstes nach - ohne Moment.
  const catchUpRef = useRef(false);
  // Der zuletzt still übernommene Stand (Codex-Prüfung #1564): beim Übernehmen festgehalten, nicht als Flag - so bleibt
  // er Basis des Vergleichs, auch wenn React ihn mit einer späteren Antwort in einem Durchgang zeichnet.
  const quietBaseRef = useRef(null);
  // Nachholen ist nur, was nicht über den Strom kam (Codex-Prüfung #1564, CI-Befund): eine Ersatz-Abfrage, während der
  // Strom getrennt ist, und die Abfrage nach einer Neuverbindung. Kam vor der Abfrage eine Änderung über den Strom, ist
  // es keine Nachhol-Abfrage - auch wenn der Strom danach kurz neu verbindet (EventSource tut das nach jedem Ende).
  // Gezählt wird ohne Uhr: so stimmt es auch bei gestellter Uhr und auf langsamen Rechnern.
  const offlineRef = useRef(false);
  const everConnected = useRef(false);
  // Eine Unterbrechung ist erst echt, wenn während der Trennung eine Ersatz-Abfrage im Takt lief (alle 15 s) - ein
  // kurzes Neuverbinden des Stroms (wenige 100 ms) ist keine, danach wird nichts still nachgeholt.
  const outageRef = useRef(false);
  const eventSeqRef = useRef(0);
  const usedEventRef = useRef(0);
  // Wozu eine Abfrage läuft - Meldung aus dem Strom, Neuverbindung oder Takt (Ersatz-Abfrage): gezählt, nicht am
  // Zustand des Stroms abgelesen. Ein Strom, der nach jeder Antwort kurz neu verbindet, ist fast immer „getrennt“.
  const reconnectSeqRef = useRef(0);
  const usedReconnectRef = useRef(0);
  const sponsors = useTvSponsors();
  const minute = useMinuteTick();

  // Abfragen können sich überholen (Codex-Nachprüfung #1564): jede bekommt beim Start ihre Nummer; eine Antwort, die
  // älter ist als die zuletzt übernommene, wird verworfen. Ob eine Abfrage still ist, steht beim Start fest - an ihr
  // selbst, nie geerbt: eine Abfrage zu einer Meldung aus dem Strom zeigt ihren Moment immer.
  const seqRef = useRef(0);
  const appliedRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++seqRef.current;
    const driven = eventSeqRef.current > usedEventRef.current;
    usedEventRef.current = eventSeqRef.current;
    const catchUp = catchUpRef.current && !driven;
    catchUpRef.current = false;
    const reconnected = reconnectSeqRef.current > usedReconnectRef.current;
    usedReconnectRef.current = reconnectSeqRef.current;
    // Ersatz-Abfrage im Takt bei getrenntem Strom: eine echte Unterbrechung - ruhig.
    const offline = !driven && !reconnected && offlineRef.current;
    if (offline) outageRef.current = true;
    const quiet = catchUp || offline;
    try {
      const { data: br } = await api.get(`/tournaments/${id}/bracket/display`, displayKey ? { params: { key: displayKey } } : undefined);
      if (seq < appliedRef.current) return;
      appliedRef.current = seq;
      // Ruhig, wenn es Nachholen ist: nach einer echten Unterbrechung und während der Strom getrennt ist (Ersatz-Abfrage).
      // Nur setzen, nie löschen: eine spätere Antwort im selben Durchgang darf die stille Basis nicht wegnehmen.
      if (quiet) quietBaseRef.current = br;
      setData(br);
      setLoadError(null);
      setKeyRefused(false);
      setLastUpdated(Date.now());
      // Die Stationen: wer reserviert ist, steht auf der Aufruf-Tafel (#1122) - mit dem Schlüssel auch bei Turnieren „Nur
      // Mitglieder“ (#1822). Dazu die Live-Warteschlange (#1634) mit demselben Schlüssel - beide zugleich; scheitert
      // eine, bleibt ihr letzter Stand.
      const tournamentId = br?.tournament?.id || id;
      const [list, live] = await Promise.allSettled([
        api.get(`/stations?tournament_id=${encodeURIComponent(tournamentId)}`, displayKey ? { params: { key: displayKey } } : undefined),
        queueOffRef.current
          ? Promise.resolve(null)
          : api.get(`/tournaments/${encodeURIComponent(tournamentId)}/live-queue`, displayKey ? { params: { key: displayKey } } : undefined),
      ]);
      if (seq < appliedRef.current) return;
      if (list.status === "fulfilled") setStations(Array.isArray(list.value?.data) ? list.value.data : []);
      if (live.status === "fulfilled" && live.value) {
        const view = live.value?.data;
        setLiveQueue(view && typeof view === "object" && !Array.isArray(view) && view.applies === true ? view : null);
      } else if (live.status === "rejected" && [404, 405].includes(live.reason?.response?.status)) {
        queueOffRef.current = true;
        setLiveQueue(null);
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
  // Abfragen dürfen sich überlappen (#1683): `load` ordnet die Antworten selbst (seqRef), und jede Meldung braucht
  // ihren Moment sofort - nicht erst nach einer noch laufenden Nachhol-Abfrage.
  // Nur Änderungen dieses Turniers und - wegen der geteilten Stationen - der anderen Turniere seines Events (#1801). Mit
  // Anzeige-Schlüssel kennt der TV sein Event nicht: dann jedes Turnier mit Event.
  const scopeTournamentId = data?.tournament?.id || null;
  const scopeEventId = data?.tournament?.event_id || null;
  useLiveRefresh(load, LIVE_RESOURCES, { fallbackMs: 15000, overlap: true, tournamentId: scopeTournamentId, eventId: scopeEventId });
  // Welche Abfrage eine Änderung aus dem Strom trägt: jede passende Meldung zählt mit - nach derselben Regel.
  const scopeRef = useRef({ tournamentId: scopeTournamentId, eventId: scopeEventId });
  useEffect(() => {
    scopeRef.current = { tournamentId: scopeTournamentId, eventId: scopeEventId };
  }, [scopeTournamentId, scopeEventId]);
  useEffect(() => subscribeApiInvalidation((event) => {
    if (invalidationMatches(event, LIVE_RESOURCES, scopeRef.current)) eventSeqRef.current += 1;
  }), []);
  // Der Zustand des Stroms direkt aus der Brücke, nicht über einen React-Effekt: so steht er fest, bevor die nächste
  // Abfrage startet - auch wenn das Neuzeichnen auf einem langsamen Rechner länger dauert.
  useEffect(() => {
    let was = isStreamConnected();
    if (was) everConnected.current = true;
    return subscribeStreamState((isConnected) => {
      if (isConnected && !was) {
        reconnectSeqRef.current += 1;
        if (outageRef.current) catchUpRef.current = true;
      }
      if (isConnected) {
        everConnected.current = true;
        outageRef.current = false;
      }
      offlineRef.current = !isConnected && everConnected.current;
      was = isConnected;
    });
  }, []);

  const t = data?.tournament;
  const matches = useMemo(() => data?.matches_v2 || [], [data?.matches_v2]);
  const registrations = useMemo(() => data?.registrations || [], [data?.registrations]);
  const nameOf = useMemo(() => nameOfRegistration(registrations), [registrations]);
  const avatarOf = useMemo(() => avatarOfRegistration(registrations), [registrations]);
  const hasMatches = matches.length > 0;
  // Anmeldung vor Check-in, solange ein Platz frei ist (#1827) - gezählt wie auf dem Anmelde-Bildschirm.
  const screen = tvScreenFor(t, { now: minute * 60000 + 30000, seats: data?.seats, registrations });
  // Tabelle (#2121): Liga, Jeder gegen jeden, Schweizer System und Gruppen zeigen nach dem Spielplan ihre Tabelle - und
  // heißen am TV nach dem, was sie sind, nicht „Turnierbaum“.
  const standings = data?.standings;
  const tableSections = useMemo(() => tvTableSections(standings), [standings]);
  const hasTable = tableSections.length > 0;
  const words = tvWords(isTreeless(t, matches, isTable));
  const playlist = useMemo(() => withTableSlide(settings.playlist, hasTable), [settings.playlist, hasTable]);
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
  const previousRef = useRef(null);
  const seenRef = useRef(new Set());
  const [resultTags, setResultTags] = useState(NO_TAGS);
  const championKeyRef = useRef(null);
  // Ohne Finale (Liga, Jeder gegen jeden, Schweizer System) kommt der Sieger aus Platz 1 der Tabelle, sobald beendet.
  const champion = useMemo(() => (data ? championOf(matches, data.stages || []) || tableChampionOf(data.standings, data.tournament) : null), [data, matches]);

  useEffect(() => {
    if (!data) return;
    // Ein still übernommener Stand ist die neue Basis: was er gegenüber dem Gezeigten ändert, ist gesehen - ohne Moment,
    // auch der Sieger. Verglichen wird erst ab ihm (er kann schon der aktuelle Stand sein).
    const base = quietBaseRef.current;
    quietBaseRef.current = null;
    if (base && previousRef.current) {
      const baseMatches = base.matches_v2 || [];
      momentsFromChange(previousRef.current, baseMatches, { seen: seenRef.current });
      previousRef.current = baseMatches;
      snapshotRef.current = bracketSnapshot(baseMatches);
      const baseKey = championKey(championOf(baseMatches, base.stages || []));
      if (baseKey !== championKeyRef.current) {
        championKeyRef.current = baseKey;
        setChampionState({ key: baseKey, parked: Boolean(baseKey) });
      }
    }
    const { started, decided, snapshot } = bracketChanges(snapshotRef.current, matches);
    const first = snapshotRef.current === null;
    snapshotRef.current = snapshot;
    // Jede Bewegung genau einmal: was der Vergleich findet, ist ab jetzt gesehen - auch wenn es gleich nicht gezeigt wird.
    const previous = previousRef.current;
    previousRef.current = matches;
    const change = momentsFromChange(previous, matches, { seen: seenRef.current });
    const hidden = typeof document !== "undefined" && document.hidden;
    const key = championKey(champion);
    // Beim ersten Laden ist nichts neu: steht der Sieger schon fest, gleich das Endbild - ohne Konfetti. Ebenso nach
    // einer Neuverbindung, bei verdecktem Bildschirm und bei Riesen-Sprüngen: nichts nachholen, nur den Stand merken.
    // Pause, Check-in, Anmeldung oder ein Bildschirm ohne Baum: genauso.
    if (first || hidden || !showMoments || change.count > MAX_EVENTS) {
      championKeyRef.current = key;
      setChampionState({ key, parked: Boolean(champion) });
      return;
    }
    if (key !== championKeyRef.current) {
      championKeyRef.current = key;
      setChampionState({ key, parked: false });
      if (champion) queue.enqueue({ type: "champion", key });
    }
    // Das Finale bekommt den Champion-Moment statt einer Ergebnis-Karte. Korrigierte Ergebnisse kommen wie neue.
    const results = [...new Set([...decided, ...change.corrected])].filter((matchId) => !champion || matchId !== champion.finalMatchId);
    if (change.walkovers.size || change.corrected.size) {
      setResultTags((current) => {
        const next = new Map(current);
        change.walkovers.forEach((matchId) => next.set(matchId, "walkover"));
        change.corrected.forEach((matchId) => next.set(matchId, "corrected"));
        return next;
      });
    }
    if (results.length) {
      if (motionOn) {
        // Bis die Fahrt ankommt, zeigen die Ziel-Plätze noch, wer kommt - dann landet der Name dort.
        const keys = [];
        for (const matchId of results) {
          const match = matches.find((row) => row.id === matchId);
          for (const move of advancementsOf(match, matches)) {
            if (!move.target || !["win", "drop"].includes(move.kind)) continue;
            // Gemischte Plätze (#1548) deckt die Auslosung auf, nicht das Ergebnis.
            const target = matches.find((row) => row.id === move.target.matchId);
            if (slotDraw(target?.slots?.[move.target.slotIndex])) continue;
            keys.push(`${move.target.matchId}:${move.target.slotIndex}`);
          }
        }
        if (keys.length) setHidden((current) => new Set([...current, ...keys]));
      }
      if (results.length > COLLECT_AFTER) queue.enqueue({ type: "result", items: results });
      else results.forEach((matchId) => queue.enqueue({ type: "result", items: [matchId] }));
    }
    // Auslosung, sofort gezogener Platz und Zusammenlegen: bis der Moment sie zeigt, stehen die neuen Plätze noch leer.
    if (motionOn) {
      const keys = [];
      for (const entry of change.moments) {
        if (entry.type === "draw" || entry.type === "draw_assigned") entry.rows.forEach((row) => keys.push(`${row.matchId}:${row.slotIndex}`));
        if (entry.type === "merge") entry.moves.forEach((move) => keys.push(`${move.matchId}:${move.slotIndex}`));
      }
      if (keys.length) setHidden((current) => new Set([...current, ...keys]));
    }
    change.moments.forEach((entry) => queue.enqueue(entry));
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
  // Was danach kommt (#1564): mit Prognose aus dem Planer und dem Verzug der Halle - jede Minute neu gerechnet.
  // Eine Prognose für Karten, Fuß und Aufruf-Tafel - überall dieselbe Zeit (#1564).
  const forecast = useMemo(() => forecastBoard(matches, { stations, now: Math.max(Date.now(), minute * 60000) }), [matches, stations, minute]);
  const upcoming = useMemo(() => nextUp(matches, { board: forecast, limit: 3, exclude: new Set(calls.map((call) => call.matchId)) }), [matches, forecast, calls]);
  const tiles = useMemo(() => statsTiles(matches, nameOf), [matches, nameOf]);
  // Vor Ort mit Stationen (#1634): die Aufruf-Folie wird zur Warteschlange je Station - die Aufrufe stecken darin.
  const queued = hasQueue(liveQueue);
  const plan = sponsorPlan(settings, sponsors);
  const lastStage = lastStageId(matches, data?.stages || []);
  const isLastStage = useCallback((match) => !lastStage || (match.stage_id || "__default") === lastStage, [lastStage]);

  // Wann Sponsor und Zahlen zuletzt kamen - der erste kommt nach dem ersten Takt, nicht gleich beim Einschalten.
  const lastLow = useRef({ sponsor: Date.now(), stats: Date.now() });
  const sponsorCount = useRef(0);
  // Eine Liste nur aus Sponsor und/oder Zahlen (ein Bildschirm nur dafür): dann stehen sie dauerhaft, statt zwischendurch.
  const onlyLow = onlyMomentSlides(playlist);
  const available = (slide) => {
    if (slide === "tree") return hasMatches;
    if (slide === TABLE_SLIDE) return hasTable;
    if (slide === "live") return live.length > 0;
    if (slide === "calls") return calls.length > 0 || queued;
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

  const publicUrl = t ? `${window.location.origin}/tournaments/${t.slug || t.id}/${words.path}` : window.location.origin;
  // Vor-Ort-Zugang (#1592): solange er gilt, trägt der QR-Code ihn - auch Nicht-Mitglieder kommen so zur Anmeldung.
  const registerUrl = data?.onsite_path ? `${window.location.origin}${data.onsite_path}` : t ? `${window.location.origin}/tournaments/${t.slug || t.id}` : window.location.origin;
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
          : hasMatches || hasTable ? (parked ? "Turnier entschieden" : { tree: words.tree, [TABLE_SLIDE]: tableSections.length > 1 ? "Tabellen" : "Tabelle", live: "Live-Spiele", calls: queued ? "Stationen" : "Aufrufe", sponsor: "Unser Partner", stats: "Zahlen zum Turnier" }[active] || words.tree) : null;

  return (
    <div className="tv-page" data-testid="bracket-tv" data-screen={screen} data-slide={screen === "playlist" ? active : undefined}>
      {t ? (
        <TvHeader
          className="tls-header-sweep"
          // Rot heißt „läuft gerade“ (#1116): der Punkt in der Kopfleiste nur, solange das Turnier läuft.
          kicker={toneFor(t.status) === "live" ? "THE LION SQUAD · LIVE" : `THE LION SQUAD · ${words.kicker}`}
          live={toneFor(t.status) === "live"}
          title={t.title}
          subtitle={subtitle}
          aside={(
            <>
              {presented ? <TvPresentedBy label={presented.label} sponsor={presented.sponsor} /> : null}
              {parked && ((parkSpot === "header" && active === "tree") || active === TABLE_SLIDE) ? (
                <TvChampionCard champion={champion} registrations={registrations} parked spot="header" testId="tv-champion-parked" />
              ) : null}
              <TvPill tone={toneFor(t.status)} live={toneFor(t.status) === "live"} testId={`status-${t.status}`}>{statusBadgeLabel(t.status)}</TvPill>
            </>
          )}
        />
      ) : null}
      <DisplayStatusBanner error={loadError} lastUpdated={lastUpdated} label={words.board} onRetry={load} />

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
                    resultTags={resultTags}
                    forecast={forecast}
                  />
                </div>
              ) : null}
              {active === "tree" && !hasMatches ? (
                <div className="tv-empty tv-t-head font-display">{words.empty}</div>
              ) : null}
              {active === TABLE_SLIDE && hasTable ? (
                <div className="tv-slide" key={`table-${playing.runId}`}>
                  <TvStandingsSlide standings={standings} nameLabel={nameHead(t)} final={FINISHED.has(String(t?.status || ""))} />
                </div>
              ) : null}
              {active === "live" ? (
                <div className="tv-slide" key={`live-${playing.runId}`}>
                  <TvLiveSlide live={live} matches={matches} nameOf={nameOf} avatarOf={avatarOf} lastStage={isLastStage} isTable={isTable} />
                </div>
              ) : null}
              {active === "calls" ? (
                <div className="tv-slide" key={`calls-${playing.runId}`}>
                  {queued ? <TvQueueBoard queue={liveQueue} matches={matches} /> : <TvCallBoard calls={calls} upcoming={upcoming} matches={matches} nameOf={nameOf} avatarOf={avatarOf} />}
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

      <TvFooter qrValue={screen === "registration" ? registerUrl : publicUrl} kicker={screen === "registration" ? "Jetzt anmelden" : "Jetzt mitfiebern"} text={screen === "registration" ? "QR scannen und anmelden" : words.qr}>
        {screen === "playlist" && hasMatches && !parked ? <TvNextUp matches={matches} stations={stations} nameOf={nameOf} forecast={forecast} queue={liveQueue} /> : null}
      </TvFooter>
      {needsClick ? <div className="tv-hint tv-t-meta" role="status" data-testid="tv-sound-hint">Für Ton einmal klicken</div> : null}
    </div>
  );
}
