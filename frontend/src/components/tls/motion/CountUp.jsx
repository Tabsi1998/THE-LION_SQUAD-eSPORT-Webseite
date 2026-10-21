import { useEffect, useRef, useState } from "react";
import { motionAllowed } from "@/lib/motion";
import { COUNT_UP_MS, countFrame, countShape, countStart } from "@/lib/countUp";

// Baustein „Hochzählen“ (#1950, der eine für die ganze Seite, #1969): eine Zeit, ein Abstand oder eine Zahl läuft beim
// ersten Sichtbarwerden von null - oder vom alten Wert `from` - auf den Wert: ease-out, in der Form des Endwerts und
// mit fester Ziffernbreite (`tabular-nums`). Eine Zahl als Wert (35) schreibt `format` (etwa „1.234“).
// - `delay` versetzt den Start (etwa 25 ms je Zeile), `playKey` spielt es neu ab (Reiterwechsel).
// - `whenVisible` (Vorgabe): erst zählen, wenn der Wert ins Bild kommt; bis dahin steht der Startwert.
// - Live-Nachladen: ein neuer Wert steht sofort da und leuchtet einmal kurz auf (`flash`) - es zählt nie neu und flackert
//   nicht. Abgespielt wird nur beim ersten Anzeigen und bei einem neuen `playKey`.
// - Texte, die nicht zählen („+2 Runden“, „Ausfall“), und „Bewegung reduzieren“: sofort der Endwert.
// - Während des Zählens liest ein Screenreader nur den Endwert. `onDone` meldet das Ende (etwa für ein Aufleuchten).
// Die Zwischenstände schreibt der Baustein direkt in den Text (ohne React-Durchlauf je Bild) - 60 Zeilen bleiben flüssig.

function canAnimate() {
  return typeof window !== "undefined" && typeof window.requestAnimationFrame === "function" && motionAllowed();
}

function useVisible(ref, wanted) {
  const [visible, setVisible] = useState(() => !wanted || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visible) return undefined;
    const node = ref.current;
    if (!node) {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.2 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

export function CountUp({
  value, from, format, play = true, playKey = "", delay = 0, duration = COUNT_UP_MS, whenVisible = true, flash = true,
  onDone, className = "", ...rest
}) {
  const shape = countShape(value, format);
  const text = shape ? shape.text : value === null || value === undefined ? "" : String(value);
  const live = useRef({ value, format, from, onDone });
  live.current = { value, format, from, onDone };
  const ref = useRef(null);
  const digits = useRef(null);
  const finished = useRef(null);
  const reported = useRef(null);
  const visible = useVisible(ref, whenVisible);
  const countable = Boolean(shape);
  const wanted = () => play && countable && canAnimate();
  // Ablauf je Abspielen: „wait“ (Startwert steht), „run“ (zählt), „done“ (Endwert). Ein neuer `playKey` steht schon
  // beim ersten Zeichnen auf dem Startwert - kein Aufblitzen des Endwerts vor dem Start.
  const [run, setRun] = useState(() => ({ key: playKey, phase: wanted() ? "wait" : "done" }));
  const phase = run.key === playKey ? run.phase : (wanted() ? "wait" : "done");

  useEffect(() => {
    if (finished.current === playKey) return undefined;
    const finish = (final) => {
      // Ein Wert, der (noch) nicht zählt - etwa vor dem Laden -, darf später noch einmal zählen.
      if (final) finished.current = playKey;
      setRun({ key: playKey, phase: "done" });
      if (reported.current !== playKey) {
        reported.current = playKey;
        live.current.onDone?.();
      }
    };
    if (!wanted()) {
      finish(play === false || countable);
      return undefined;
    }
    if (!visible) {
      setRun((now) => (now.key === playKey ? now : { key: playKey, phase: "wait" }));
      return undefined;
    }
    let frame = 0;
    const began = window.performance.now() + Math.max(0, Number(delay) || 0);
    setRun({ key: playKey, phase: "run" });
    const step = (now) => {
      const progress = Math.min(1, Math.max(0, (now - began) / Math.max(1, duration)));
      if (progress >= 1) {
        finish(true);
        return;
      }
      const current = countShape(live.current.value, live.current.format);
      const node = digits.current?.firstChild;
      if (current && node) node.nodeValue = countFrame(current, progress, countStart(current, live.current.from));
      frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
    // Nur Start, Sichtbarwerden und ein neuer `playKey` spielen ab - ein neuer Wert beim Nachladen nicht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, playKey, visible, countable]);

  // Live-Nachladen: ein geänderter Wert nach dem Zählen leuchtet einmal kurz auf.
  const [flashes, setFlashes] = useState(0);
  const lastText = useRef(text);
  useEffect(() => {
    const before = lastText.current;
    lastText.current = text;
    if (flash && phase === "done" && before && text && before !== text && motionAllowed()) setFlashes((count) => count + 1);
  }, [text, flash, phase]);

  const classes = `tabular-nums ${className}`.trim();
  const counting = phase !== "done" && Boolean(shape);
  // `relative` hält den Endwert für Screenreader (sr-only, absolut) im Wert - sonst ragt er aus Wischflächen.
  // `tls-glow` liegt erst nach der ersten Änderung an; „on“ und „again“ wechseln sich ab und starten das Aufleuchten neu.
  return (
    <span
      ref={ref}
      className={`${counting ? "relative " : ""}${classes}${flashes ? " tls-glow" : ""}`}
      data-counting={counting ? "true" : undefined}
      data-glow={flashes ? (flashes % 2 ? "on" : "again") : undefined}
      {...rest}
    >
      {counting ? (
        <>
          <span ref={digits} aria-hidden="true">{countFrame(shape, 0, countStart(shape, from))}</span>
          <span className="sr-only">{text}</span>
        </>
      ) : text}
    </span>
  );
}
