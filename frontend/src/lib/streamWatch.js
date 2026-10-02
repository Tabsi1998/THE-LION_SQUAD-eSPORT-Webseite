import { useEffect } from "react";
import { api } from "@/lib/api";
import { useOptionalAuth } from "@/context/AuthContext";

// Zuschauer-Ping (#616): ein eingebetteter Stream, der eine Minute im sichtbaren Tab offen ist, zählt für den
// Erfolg „Zuschauer“ - einmal je Stream und Tag, nur mit Anmeldung. Der Browser merkt sich den Tag, damit er
// nicht bei jedem Seitenwechsel neu meldet; über Treffer und Deckel entscheidet der Server.

export const WATCH_AFTER_MS = 60000;
export const STORAGE_KEY = "tls-stream-watched";
const KEY_RE = /^(twitch|youtube|kick):[a-z0-9_.@-]{2,64}$/;
const VIENNA_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" });

/** Plattform und Kanal (oder Video) als Kennung, wie der Server sie annimmt - leer, wenn sie nicht passt. */
export function streamKey(platform, id) {
  const key = `${String(platform || "").trim().toLowerCase()}:${String(id || "").trim().replace(/^@/, "").toLowerCase()}`;
  return KEY_RE.test(key) ? key : "";
}

export function viennaDay(date = new Date()) {
  return VIENNA_DAY.format(date);
}

function readStore(day) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && parsed.day === day && parsed.sent && typeof parsed.sent === "object" ? parsed : { day, sent: {} };
  } catch {
    return { day, sent: {} };
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ohne Speicher meldet der Browser öfter - der Server zählt trotzdem nur einmal je Tag.
  }
}

export function alreadyReported(userId, key, now = new Date()) {
  return Boolean(readStore(viennaDay(now)).sent[`${userId}|${key}`]);
}

function remember(userId, key, value) {
  const store = readStore(viennaDay());
  if (value) store.sent[`${userId}|${key}`] = 1;
  else delete store.sent[`${userId}|${key}`];
  writeStore(store);
}

/**
 * Meldet den Stream, sobald er `WATCH_AFTER_MS` lang sichtbar offen war. `playing` heißt: der Player ist
 * wirklich eingebettet (Zustimmung zu externen Medien liegt vor). Im verdeckten Tab bleibt die Uhr stehen.
 */
export function useStreamWatched(key, playing = true) {
  const userId = useOptionalAuth()?.user?.id || null;

  useEffect(() => {
    if (!userId || !key || !playing || alreadyReported(userId, key)) return undefined;
    let left = WATCH_AFTER_MS;
    let since = 0;
    let timer = null;
    let done = false;

    const report = () => {
      timer = null;
      done = true;
      remember(userId, key, true);
      // Klappt die Meldung nicht, versucht es der nächste Besuch noch einmal.
      api.post("/streams/watch", { key }, { skipInvalidation: true }).catch(() => remember(userId, key, false));
    };
    const pause = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
      left = Math.max(0, left - (Date.now() - since));
    };
    const run = () => {
      if (done || timer !== null || document.visibilityState !== "visible") return;
      since = Date.now();
      timer = window.setTimeout(report, left);
    };
    const onVisibility = () => (document.visibilityState === "visible" ? run() : pause());

    document.addEventListener("visibilitychange", onVisibility);
    run();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      pause();
    };
  }, [userId, key, playing]);
}
