import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useOptionalAuth } from "@/context/AuthContext";
import { forgetOpened, readOpened, rememberOpened, rememberedYear } from "./storage";

// Der Adventkalender einer Person (#641): laden, öffnen, Quiz, Verlosung. Der Server entscheidet, was offen ist;
// hier steht nur, was die Seite gerade zeigt. Gäste öffnen ohne Konto - ihr Browser merkt sich die Türchen, und
// nach dem Anmelden werden sie für das Konto nachgeholt.

export const AWARDED_EVENT = "tls:achievements-awarded";

export function errorText(error, fallback) {
  const detail = error?.response?.data?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

function celebrate(count) {
  if (!(count > 0)) return;
  try {
    window.dispatchEvent(new CustomEvent(AWARDED_EVENT, { detail: { count, source: "advent" } }));
  } catch {
    // Ohne CustomEvent zeigt der nächste Besuch den Erfolg.
  }
}

function withDoor(calendar, day, patch) {
  if (!calendar?.doors) return calendar;
  return { ...calendar, doors: calendar.doors.map((door) => (door.day === day ? { ...door, ...(typeof patch === "function" ? patch(door) : patch) } : door)) };
}

export function useAdventCalendar() {
  const userId = useOptionalAuth()?.user?.id || null;
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const replayed = useRef("");

  const load = useCallback(async () => {
    try {
      const year = rememberedYear();
      const remembered = !userId && year ? readOpened(year) : [];
      const { data } = await api.get("/seasonal/advent", { params: remembered.length ? { opened: remembered.join(",") } : {}, skipInvalidation: true });
      // Die gemerkten Türchen gehören zu einem anderen Jahr: ohne sie noch einmal fragen wäre dasselbe - vergessen genügt.
      if (data?.active && year && year !== data.year) forgetOpened(year);
      setCalendar(data || { active: false });
      setError("");
      return data;
    } catch (failure) {
      setError(errorText(failure, "Der Adventkalender lässt sich gerade nicht laden."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Nach dem Anmelden: was der Browser als Gast geöffnet hat, für das Konto nachholen - einmal je Person und Jahr.
  useEffect(() => {
    if (!userId || !calendar?.active) return;
    const key = `${userId}:${calendar.year}`;
    if (replayed.current === key) return;
    replayed.current = key;
    const open = new Set(calendar.doors.filter((door) => door.state === "opened").map((door) => door.day));
    const pending = readOpened(calendar.year).filter((day) => !open.has(day));
    if (!pending.length) {
      forgetOpened(calendar.year);
      return;
    }
    (async () => {
      let awarded = 0;
      for (const day of pending) {
        try {
          const { data } = await api.post(`/seasonal/advent/${day}/open`, null, { skipInvalidation: true });
          awarded += Number(data?.newly_awarded) || 0;
        } catch {
          // Ein Türchen, das sich nicht nachholen lässt, bleibt für die Person einfach zu.
        }
      }
      forgetOpened(calendar.year);
      celebrate(awarded);
      load();
    })();
  }, [userId, calendar, load]);

  const open = useCallback(async (day) => {
    const { data } = await api.post(`/seasonal/advent/${day}/open`, null, { skipInvalidation: true });
    if (!data?.counted && data?.year) rememberOpened(data.year, day);
    setCalendar((current) => {
      const next = withDoor(current, day, { state: "opened", content: data.content, opened_at: data.opened_at });
      if (!next) return next;
      const opened = data.counted ? data.opened : next.doors.filter((door) => door.state === "opened").length;
      return { ...next, opened };
    });
    celebrate(Number(data?.newly_awarded) || 0);
    return data;
  }, []);

  const answer = useCallback(async (day, choice) => {
    const { data } = await api.post(`/seasonal/advent/${day}/quiz`, { answer: choice }, { skipInvalidation: true });
    setCalendar((current) => withDoor(current, day, (door) => (door.content?.quiz ? { content: { ...door.content, quiz: { ...door.content.quiz, done: true } } } : {})));
    return data;
  }, []);

  const raffle = useCallback(async (day, join) => {
    const { data } = join
      ? await api.post(`/seasonal/advent/${day}/enter`, null, { skipInvalidation: true })
      : await api.delete(`/seasonal/advent/${day}/enter`, { skipInvalidation: true });
    setCalendar((current) => withDoor(current, day, (door) => ({ content: { ...door.content, prize: data.prize } })));
    return data.prize;
  }, []);

  return { calendar, loading, error, signedIn: Boolean(userId), reload: load, open, answer, raffle };
}
