import { useEffect, useRef, useState } from "react";

// Zahlen hochzählen (#425): beginnt, wenn der Block zum ersten Mal sichtbar wird - schnell
// anlaufen, dann langsamer werden bis zum Endwert (Ease-out). Wer „Bewegung reduzieren“ gesetzt
// hat, sieht sofort den Endwert; ohne Beobachter oder matchMedia (Tests, alte Browser) ebenso.

export function easeOutExpo(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
}

export function canAnimateNumbers(win = typeof window !== "undefined" ? window : null) {
  if (!win || typeof win.matchMedia !== "function" || typeof win.requestAnimationFrame !== "function") return false;
  try {
    return !win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function useCountUp(target, { durationMs = 1600 } = {}) {
  const end = Math.max(0, Math.round(Number(target) || 0));
  const ref = useRef(null);
  const [value, setValue] = useState(() => (canAnimateNumbers() ? 0 : end));

  useEffect(() => {
    if (!canAnimateNumbers()) {
      setValue(end);
      return undefined;
    }
    let frame = 0;
    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      const startedAt = performance.now();
      const step = (now) => {
        const progress = Math.min(1, (now - startedAt) / durationMs);
        setValue(Math.round(end * easeOutExpo(progress)));
        if (progress < 1) frame = window.requestAnimationFrame(step);
      };
      frame = window.requestAnimationFrame(step);
    };
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      run();
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        run();
        observer.disconnect();
      }
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [durationMs, end]);

  return [value, ref];
}
