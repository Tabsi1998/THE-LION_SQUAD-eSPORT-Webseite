import { useEffect, useRef, useState } from "react";
import { motionAllowed } from "@/lib/motion";
import { COUNT_UP_MS, countFrame, countShape } from "@/lib/countUp";

// Baustein „Hochzählen“ (#1950, überall einsetzbar, #1969): eine Zeit, ein Abstand oder eine Zahl läuft beim ersten
// Anzeigen von null auf den Wert - ease-out, in der Form des Endwerts und mit fester Ziffernbreite (`tabular-nums`).
// `delay` versetzt den Start (etwa 25 ms je Zeile), `playKey` spielt es neu ab (Reiterwechsel). Neue Werte beim
// Nachladen im Hintergrund stehen sofort da - abgespielt wird nur beim ersten Anzeigen und bei einem neuen `playKey`.
// Texte, die nicht zählen („+2 Runden“, „Ausfall“), und „Bewegung reduzieren“: sofort der Endwert. Während des Zählens
// liest ein Screenreader nur den Endwert. `onDone` meldet das Ende (für eine Detail-Runde wie ein kurzes Aufleuchten).

function canAnimate() {
  return typeof window !== "undefined" && typeof window.requestAnimationFrame === "function" && motionAllowed();
}

export function CountUp({ value, play = true, playKey = "", delay = 0, duration = COUNT_UP_MS, onDone, className = "", ...rest }) {
  const text = value === null || value === undefined ? "" : String(value);
  const textRef = useRef(text);
  textRef.current = text;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const startsAtZero = () => play && Boolean(countShape(textRef.current)) && canAnimate();
  // Fortschritt je Abspielen: ein neuer `playKey` steht schon beim ersten Zeichnen auf null - kein Aufblitzen des
  // Endwerts vor dem Start.
  const [run, setRun] = useState(() => ({ key: playKey, progress: startsAtZero() ? 0 : 1 }));
  const progress = run.key === playKey ? run.progress : (startsAtZero() ? 0 : 1);

  useEffect(() => {
    if (!startsAtZero()) {
      setRun({ key: playKey, progress: 1 });
      doneRef.current?.();
      return undefined;
    }
    let frame = 0;
    const began = window.performance.now() + Math.max(0, Number(delay) || 0);
    setRun({ key: playKey, progress: 0 });
    const step = (now) => {
      const next = Math.min(1, Math.max(0, (now - began) / Math.max(1, duration)));
      setRun({ key: playKey, progress: next });
      if (next < 1) frame = window.requestAnimationFrame(step);
      else doneRef.current?.();
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
    // Nur Start und neuer `playKey` spielen ab - ein neuer Wert beim Nachladen nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, playKey]);

  const shape = progress < 1 ? countShape(text) : null;
  const classes = `tabular-nums ${className}`.trim();
  if (!shape) return <span className={classes} {...rest}>{text}</span>;
  // `relative` hält den Endwert für Screenreader (sr-only, absolut) in der Zelle - sonst ragt er aus Wischflächen.
  return (
    <span className={`relative ${classes}`} data-counting="true" {...rest}>
      <span aria-hidden="true">{countFrame(shape, progress)}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
