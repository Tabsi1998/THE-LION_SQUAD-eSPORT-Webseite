import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { Skull } from "lucide-react";
import { emitSound, getActiveEngine } from "../audio";
import { useSeason } from "../SeasonContext";
import { isQuietPath } from "../SeasonStage";
import { Cat, FlyingBatShape, Ghost, Lantern, Spider } from "./art";
import { NOTE_MS, dayKey, markScared, noteVisit, pageState, pickVariant, readScareState, scareDuration, setScaresDisabled, shouldScare } from "./scareRules";

// Jumpscares (#680) als Bühne: ein Portal über allem, das nach den Regeln aus scare.js einmal am Tag eine Variante
// zeigt - Figur aus den eigenen Zeichnungen, Auftritt und Rahmen aus dem CSS, der Klang aus der Palette. Jeder
// Klick, jede Taste, jedes Wischen beendet ihn, spätestens nach 1,8 s ist er von selbst weg; danach ein kleiner
// Hinweis mit „Nie wieder“. Der Schalter (Totenkopf) neben dem Widget schaltet alles ab und wieder an.

function Figure({ figure }) {
  if (figure === "spider") return <Spider size={70} thread={false} className="tls-scare__spider" />;
  if (figure === "ghost") return <Ghost size={260} className="tls-scare__ghost" />;
  if (figure === "cat") return <Cat size={320} className="tls-scare__cat" />;
  if (figure === "lantern") return <span className="tls-scare__lantern"><Lantern open face="wicked" /></span>;
  if (figure === "bats") {
    return (
      <span className="tls-scare__bats">
        {[0, 1, 2].map((index) => <span key={index} className={`tls-scare__bat tls-scare__bat--${index}`}><FlyingBatShape size={180 - index * 40} /></span>)}
      </span>
    );
  }
  return <span className="tls-scare__shadow" />;
}

/** Der Wächter: prüft alle `checkMs`, ob ein Schreck kommen darf, und zeigt ihn. `allowed`/`rng`/`now` nur für Tests überschreibbar. */
export function Scares({ season, allowed, rng = Math.random, now = () => Date.now(), checkMs = 5000 }) {
  const context = useSeason();
  const location = useLocation();
  const permitted = allowed ?? Boolean(context.scaresAllowed);
  const reducedMotion = Boolean(context.reducedMotion);
  const night = Boolean(season?.data?.night);
  const [active, setActive] = useState(null);
  const [note, setNote] = useState(false);
  const loadedAt = useRef(now());
  const lastFigure = useRef(null);
  const storage = typeof localStorage === "undefined" ? null : localStorage;

  useEffect(() => {
    noteVisit(storage, dayKey(now()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!permitted || typeof window === "undefined") return undefined;
    const check = () => {
      if (active) return;
      const today = dayKey(now());
      const state = readScareState(storage, today);
      const engine = getActiveEngine();
      const page = pageState(document);
      const verdict = shouldScare({
        allowed: permitted, disabled: state.disabled, reducedMotion, soundsOn: Boolean(engine && engine.unlocked && engine.prefs.sounds),
        quiet: isQuietPath(location.pathname), inputFocused: page.inputFocused, mediaPlaying: page.mediaPlaying,
        visits: state.visits, lastDay: state.lastDay, today, loadedAt: loadedAt.current,
      }, now());
      if (!verdict.ok) return;
      const variant = pickVariant(rng, { night, lastFigure: lastFigure.current });
      lastFigure.current = variant.figure;
      markScared(storage, today);
      emitSound(variant.sound);
      setActive({ ...variant, until: now() + scareDuration(rng) });
    };
    const timer = window.setInterval(check, checkMs);
    return () => window.clearInterval(timer);
  }, [permitted, reducedMotion, night, location.pathname, active, checkMs, now, rng, storage]);

  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    const end = () => {
      setActive(null);
      setNote(true);
    };
    const timer = window.setTimeout(end, Math.max(100, active.until - now()));
    const onAny = () => end();
    ["pointerdown", "keydown", "touchstart"].forEach((name) => window.addEventListener(name, onAny, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      ["pointerdown", "keydown", "touchstart"].forEach((name) => window.removeEventListener(name, onAny));
    };
  }, [active, now]);

  useEffect(() => {
    if (!note || typeof window === "undefined") return undefined;
    const timer = window.setTimeout(() => setNote(false), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  if (typeof document === "undefined" || (!active && !note)) return null;
  const disable = () => {
    setScaresDisabled(storage, true);
    setNote(false);
  };
  return createPortal(
    <>
      {active && (
        <div className={`tls-scare tls-scare--${active.entrance} tls-scare--frame-${active.frame} tls-scare--${active.figure}`} aria-hidden="true" data-testid="halloween-scare" data-variant={active.id}>
          <div className="tls-scare__figure"><Figure figure={active.figure} /></div>
        </div>
      )}
      {note && (
        <div className="tls-scare-note" role="status" data-testid="halloween-scare-note">
          <span>Boo.</span>
          <button type="button" onClick={disable} data-testid="halloween-scare-off">Nie wieder</button>
        </div>
      )}
    </>,
    document.body,
  );
}

/** Der Schalter neben dem Widget: Schrecken an oder aus - nur für Personen, die welche bekommen dürften. */
export function ScareToggle() {
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  const [disabled, setDisabled] = useState(() => readScareState(storage, dayKey()).disabled);
  const onClick = () => {
    setScaresDisabled(storage, !disabled);
    setDisabled(!disabled);
  };
  const label = disabled ? "Schrecken aus - klicken für an" : "Schrecken an - klicken für aus";
  return (
    <button type="button" onClick={onClick} className={`tls-season-scare ${disabled ? "tls-season-scare--off" : ""}`} aria-label={label} title={label} aria-pressed={!disabled} data-testid="season-scare-toggle" data-state={disabled ? "off" : "on"}>
      <Skull className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}
