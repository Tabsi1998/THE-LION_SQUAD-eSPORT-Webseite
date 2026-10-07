// Kleine Helfer der TV-Seiten (Meilenstein 60): die TV-Sponsoren, eine Uhr im Minutentakt, Ton nach dem ersten Klick,
// Sponsor-Momente im Takt (Event- und Fast-Lap-TV) und das Ende der leisen Momente (Sponsor, Zahlen).
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { createGong, pageActivated } from "@/lib/tvGong";
import { isDue } from "@/lib/tvPlaylist";
import { MOMENT_MS, YIELDING_MOMENTS } from "@/lib/tvMoments";
import { tvSponsors } from "@/lib/tvSponsors";

/** Die Sponsoren mit „TV / Anzeige“ - dieselbe Liste wie das Laufband, neu geladen, wenn sich Sponsoren ändern. */
export function useTvSponsors() {
  const [list, setList] = useState([]);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/sponsors?placement=tv");
      setList(tvSponsors(Array.isArray(data) ? data : []));
    } catch {
      setList((current) => current);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  useLiveRefresh(load, ["sponsors"], { fallbackMs: 300000 });
  return list;
}

// Eine Uhr im Minutentakt für alle, die nicht jede Sekunde neu zeichnen müssen (Bildschirm-Wahl, „jetzt“-Linie).
const minuteListeners = new Set();
let minuteTimer = null;
function scheduleMinute() {
  const wait = 60000 - (Date.now() % 60000) + 20;
  minuteTimer = window.setTimeout(() => {
    minuteListeners.forEach((listener) => listener());
    scheduleMinute();
  }, wait);
}
function subscribeMinute(listener) {
  minuteListeners.add(listener);
  if (!minuteTimer) scheduleMinute();
  return () => {
    minuteListeners.delete(listener);
    if (!minuteListeners.size && minuteTimer) {
      window.clearTimeout(minuteTimer);
      minuteTimer = null;
    }
  };
}
const currentMinute = () => Math.floor(Date.now() / 60000);

/** Die aktuelle Minute (seit 1970) - ändert sich einmal je Minute. */
export function useMinuteTick() {
  return useSyncExternalStore(subscribeMinute, currentMinute, currentMinute);
}

/**
 * Ton (#1118, #1122): nur mit Einstellung; Browser spielen Ton erst nach einem Klick - bis dahin sagt der TV einmal klein
 * „Für Ton einmal klicken“. Den Klang-Baukasten legt der TV erst nach dem Klick an.
 */
export function useTvSound(enabled) {
  const gong = useMemo(() => createGong(), []);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!enabled || ready || !gong.supported) return undefined;
    let active = true;
    const unlock = () => {
      gong.unlock().then((ok) => {
        if (active && ok) setReady(true);
      });
    };
    if (pageActivated()) unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      active = false;
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [enabled, ready, gong]);
  return { gong: enabled ? gong : null, needsClick: enabled && gong.supported && !ready };
}

/**
 * Leise Momente (Sponsor, Zahlen) stehen so lange, wie sie mitbringen, und machen dann Platz. Gibt zurück, seit wann der
 * laufende leise Moment steht - für den Balken.
 */
export function useLowMomentTimer(queue, moment) {
  const low = moment && YIELDING_MOMENTS.has(moment.type) ? moment : null;
  const [startedAt, setStartedAt] = useState(0);
  const lowId = low?.id || null;
  const lowMs = low ? low.ms || MOMENT_MS[low.type] : 0;
  useEffect(() => {
    if (!lowId) return undefined;
    setStartedAt(Date.now());
    const timer = window.setTimeout(() => {
      queue.finish(lowId);
      queue.next();
    }, lowMs);
    return () => window.clearTimeout(timer);
  }, [lowId, lowMs, queue]);
  return low ? { moment: low, startedAt: startedAt || Date.now(), ms: lowMs } : null;
}

/**
 * Sponsor-Moment im Takt (#1125) für Event- und Fast-Lap-TV: höchstens alle `everyMinutes`, der Reihe nach. Der erste
 * kommt nach dem ersten Takt - nicht gleich beim Einschalten. Ein Moment wartet in der Warteschlange, bis nichts
 * Wichtigeres läuft.
 */
export function useSponsorMoments(queue, { enabled, everyMinutes, ms, sponsors }) {
  const lastRef = useRef(Date.now());
  const countRef = useRef(0);
  const count = sponsors?.length || 0;
  useEffect(() => {
    if (!enabled || !count) return undefined;
    const check = () => {
      const waiting = queue.getPending().some((entry) => entry.type === "sponsor") || queue.getCurrent()?.type === "sponsor";
      if (waiting || !isDue(lastRef.current, everyMinutes, Date.now())) return;
      lastRef.current = Date.now();
      queue.enqueue({ type: "sponsor", ms, sponsorIndex: countRef.current });
      countRef.current += 1;
      queue.next();
    };
    const timer = window.setInterval(check, 1000);
    return () => window.clearInterval(timer);
  }, [enabled, everyMinutes, ms, count, queue]);
}
