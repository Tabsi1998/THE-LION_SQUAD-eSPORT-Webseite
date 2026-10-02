import { useEffect, useRef, useState } from "react";
import { seasonYear } from "../rng";
import { useSeason } from "../SeasonContext";
import { markToastShown, toastShownToday } from "../SeasonStage";
import { recordSignal } from "../signals";
import { handwriting, planHour, salvoLaunches, salvoTimes } from "./choreography";
import { countdownState, newYearOf, pulseLevel, COUNTDOWN_SECONDS, ZERO_SECONDS } from "./countdown";
import { windDrift } from "./fireworks";
import { createFireworksLayer } from "./layer";
import { NEW_YEAR_SOUND_EVENT, createNewYearSound, readNewYearSound, writeNewYearSound } from "./sound";
import "./newyear.css";

// Silvester (Jahreszeiten II S9, #640; N1–N5, #739–#743): ab dem 29.12. abends vereinzelt Raketen, am 31. aufbauend,
// ab 23:59 der Countdown, um Mitternacht die Show mit drei großen Salven, danach der Ausklang und am 1. Jänner der Gruß.
// Wann eine Rakete steigt, sagt der Server (Rampe und Startsekunden je Stunde, für alle Geräte gleich); wie sie aussieht,
// die Handschrift des Jahres (choreography.js). Alles nach der Serveruhr. Ton nur nach Einschalten. Untertags, bei
// „dezent“ und „Bewegung reduzieren“: keine Raketen - Countdown und Gruß bleiben, ruhig.

export const SIGNAL_KEY = "online_at_new_year";
/** In diesen Phasen zählt „um Mitternacht dabei“ (der Server prüft dasselbe Fenster). */
export const LIVE_PHASES = new Set(["pre_countdown", "countdown", "show", "fade"]);
/** Phasen, in denen Raketen fliegen können - dort gibt es den Ton-Schalter. */
export const ROCKET_PHASES = new Set(["ramp_29", "ramp_30", "evening_31", "pre_countdown", "countdown", "show", "fade", "greeting"]);
const GREETING_KEY = "new-year-greeting";

// Was die Ebene braucht, hält die Bühne hier aktuell (Corners rendert bei jeder neuen Antwort des Servers): die Saison
// mit ihren Startsekunden, der Abstand der Serveruhr, das Wetter. Die Ebene liest es je Bild, ohne neu zu entstehen.
let live = { season: null, offset: 0, payloadNow: null, weather: null, version: 0 };
let planCache = { version: -1, launches: [] };
let handCache = { year: null, hand: null };
let sound = null;

/** Nur für Tests und die Bühne: den aktuellen Stand setzen. */
export function setLiveNewYear(next) {
  live = { ...live, ...next, version: live.version + 1 };
}

export function resetLiveNewYear() {
  live = { season: null, offset: 0, payloadNow: null, weather: null, version: 0 };
  planCache = { version: -1, launches: [] };
  handCache = { year: null, hand: null };
  sound?.dispose();
  sound = null;
}

/** Das Jahr der Handschrift: das Silvester-Jahr (Beginn der Saison) - nicht das neue Jahr. */
export function showYear(season) {
  return seasonYear({ key: "new_year", starts_at: season?.starts_at || "" });
}

function handFor(season) {
  const year = showYear(season);
  if (handCache.year !== year) handCache = { year, hand: handwriting(year) };
  return handCache.hand;
}

/** Die Raketen der laufenden Stunde (Server) und - in der Show - die drei großen Salven. Gecacht je Antwort. */
export function currentPlan() {
  if (planCache.version === live.version) return planCache.launches;
  const season = live.season;
  let launches = [];
  if (season && season.key === "new_year") {
    const data = season.data || {};
    const hand = handFor(season);
    const payloadNow = Date.parse(live.payloadNow || "");
    const hourStart = Number.isFinite(payloadNow) ? Math.floor(payloadNow / 3600000) * 3600000 : 0;
    launches = planHour(hand, { hourSeed: data.seed, salvos: Array.isArray(data.salvos) ? data.salvos : [], phase: season.phase, hourStart });
    const showStart = Date.parse(data.show_start || "");
    if (Number.isFinite(showStart) && (season.phase === "countdown" || season.phase === "show" || season.phase === "pre_countdown")) {
      salvoTimes(showStart).forEach((at, index) => launches.push(...salvoLaunches(hand, index, at)));
    }
  }
  planCache = { version: live.version, launches };
  return launches;
}

function soundEngine() {
  if (!sound) sound = createNewYearSound();
  return sound;
}

/** Die Ebene für den gemeinsamen Canvas-Loop - keine bei „dezent“, ohne Bewegung oder ohne Budget. */
export function skyLayers({ season, budget = 0, reducedMotion = false, weather = null }) {
  if (reducedMotion || season.effective === "subtle" || !budget) return [];
  if (!live.season) setLiveNewYear({ season, weather });
  return [createFireworksLayer({
    plan: currentPlan,
    clock: () => Date.now() + (live.offset || 0),
    wind: () => windDrift(live.weather),
    budget,
    onLaunch: (launch) => soundEngine().whistle(launch.distance, launch.rise),
    onBurst: (launch) => soundEngine().burst(launch.type, launch.distance),
  })];
}

/** Hält die Ebene auf dem Stand des Servers und zählt „um Mitternacht dabei“ - zeigt selbst nichts. */
export function Corners({ season }) {
  const { serverOffset, serverNow, weather } = useSeason();
  const counted = useRef(false);
  useEffect(() => {
    setLiveNewYear({ season, offset: serverOffset || 0, payloadNow: serverNow, weather });
  }, [season, serverOffset, serverNow, weather]);
  useEffect(() => {
    if (counted.current || !LIVE_PHASES.has(season.phase)) return;
    counted.current = true;
    recordSignal(SIGNAL_KEY);
  }, [season.phase]);
  return null;
}

/** Ton an oder aus - eigener Schalter, Vorgabe aus (#640). */
function useNewYearSound() {
  const [on, setOn] = useState(readNewYearSound);
  useEffect(() => {
    const onPref = (event) => setOn(Boolean(event?.detail?.on));
    window.addEventListener(NEW_YEAR_SOUND_EVENT, onPref);
    return () => window.removeEventListener(NEW_YEAR_SOUND_EVENT, onPref);
  }, []);
  useEffect(() => {
    if (sound || on) soundEngine().setOn(on);
  }, [on]);
  const toggle = () => writeNewYearSound(!on);
  return [on, toggle];
}

export function SoundSwitch({ testId = "new-year-sound" }) {
  const [on, toggle] = useNewYearSound();
  return (
    <button type="button" className={`tls-ny-sound${on ? " tls-ny-sound--on" : ""}`} onClick={toggle} aria-pressed={on} aria-label={on ? "Feuerwerk-Ton ausschalten" : "Feuerwerk-Ton einschalten"} title={on ? "Ton aus" : "Ton an"} data-testid={testId}>
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
        <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
        {on ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" /> : <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
      </svg>
    </button>
  );
}

/** Die Serverzeit, alle `ms` neu gelesen - für Hinweis und Countdown. */
function useServerClock(ms) {
  const { serverOffset } = useSeason();
  const [now, setNow] = useState(() => Date.now() + (serverOffset || 0));
  useEffect(() => {
    setNow(Date.now() + (serverOffset || 0));
    const timer = window.setInterval(() => setNow(Date.now() + (serverOffset || 0)), ms);
    return () => window.clearInterval(timer);
  }, [serverOffset, ms]);
  return now;
}

/** Neben dem Logo: ab 23:00 „noch 42 Min.“, dazu der Ton-Schalter, solange Raketen fliegen können. */
export function Widget({ season }) {
  const now = useServerClock(5000);
  const state = countdownState(now, Date.parse(season.data?.show_start || ""));
  if (!ROCKET_PHASES.has(season.phase)) return null;
  const year = newYearOf(season.data?.show_start);
  return (
    <span className="tls-ny-widget" data-testid="new-year-widget">
      {state.stage === "hint" && (
        <span className="tls-ny-hint" data-testid="new-year-hint">
          noch {state.minutes} Min.{year ? ` bis ${year}` : ""}
        </span>
      )}
      {season.effective !== "subtle" && <SoundSwitch />}
    </span>
  );
}

/**
 * Der Countdown als Karte oben in der Mitte (ab 23:59:00): ruhig, die letzten zehn Sekunden mit Puls, um 00:00 bricht
 * die Zahl auf, der Gruß steht acht Sekunden groß da. Danach - und wer erst später kommt - einmal am Tag der Gruß als
 * Karte unten. Nie über die ganze Seite, nie blockierend.
 */
export function Toast({ season }) {
  const showStart = Date.parse(season.data?.show_start || "");
  const near = season.phase === "pre_countdown" || season.phase === "countdown" || season.phase === "show";
  const now = useServerClock(near ? 100 : 5000);
  const state = countdownState(now, showStart);
  const year = newYearOf(season.data?.show_start);
  const still = season.effective === "subtle";
  const greeting = season.texts?.greeting || "Frohes neues Jahr wünscht THE LION SQUAD";
  const [toast, setToast] = useState(false);
  const after = state.stage === "done" && ["show", "fade", "greeting"].includes(season.phase);
  // Wer um Mitternacht den großen Gruß gesehen hat, bekommt danach nicht noch die Karte (sie käme mit der nächsten
  // Antwort des Servers, ein paar Sekunden später, doppelt).
  useEffect(() => {
    if (state.stage === "zero") markToastShown(GREETING_KEY);
  }, [state.stage]);
  useEffect(() => {
    if (!after || toastShownToday(GREETING_KEY)) return undefined;
    const show = window.setTimeout(() => {
      markToastShown(GREETING_KEY);
      setToast(true);
    }, 1500);
    const hide = window.setTimeout(() => setToast(false), 1500 + 12000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, [after]);
  if (state.stage === "calm" || state.stage === "pulse") {
    const beat = still ? 0 : pulseLevel(state.remaining);
    return (
      <div className={`tls-ny-countdown${state.stage === "pulse" ? " tls-ny-countdown--pulse" : ""}${still ? " tls-ny-countdown--still" : ""}`} role="timer" aria-live={state.stage === "pulse" ? "assertive" : "off"} aria-label={`Noch ${state.seconds} Sekunden bis ${year || "zum neuen Jahr"}`} data-testid="new-year-countdown" data-stage={state.stage}>
        <div className="tls-ny-countdown__label">{state.stage === "pulse" ? "Gleich ist es so weit" : "Noch"}</div>
        <div className="tls-ny-countdown__digits" style={{ "--beat": beat }} key={state.stage === "pulse" ? state.seconds : "calm"} data-testid="new-year-digits">{state.seconds}</div>
        <div className="tls-ny-countdown__label">{state.stage === "pulse" ? `bis ${year || "Mitternacht"}` : `Sekunden bis ${year || "Mitternacht"}`}</div>
        <SoundSwitch testId="new-year-countdown-sound" />
      </div>
    );
  }
  if (state.stage === "zero") {
    return (
      <div className={`tls-ny-countdown tls-ny-countdown--zero${still ? " tls-ny-countdown--still" : ""}`} role="status" data-testid="new-year-zero">
        <div className="tls-ny-countdown__burst" aria-hidden="true">0</div>
        <div className="tls-ny-countdown__title">Frohes neues Jahr{year ? ` ${year}` : ""}!</div>
        <div className="tls-ny-countdown__text">{greeting}</div>
      </div>
    );
  }
  if (!toast) return null;
  return (
    <div className={`tls-season-toast tls-ny-toast${still ? " tls-ny-toast--still" : ""}`} role="status" data-testid="new-year-toast">
      {!still && (
        <div className="tls-ny-toast__confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, i) => <span key={i} style={{ "--i": i }} />)}
        </div>
      )}
      <div className="tls-ny-toast__title">Frohes neues Jahr{year ? ` ${year}` : ""}</div>
      <p className="tls-ny-toast__text">{greeting}</p>
      <button type="button" className="tls-ny-toast__close" aria-label="Gruß schließen" onClick={() => setToast(false)} data-testid="new-year-toast-close">×</button>
    </div>
  );
}

export { COUNTDOWN_SECONDS, ZERO_SECONDS };
export const season = { key: "new_year", Corners, Widget, Toast, skyLayers };
