import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useOptionalAuth } from "@/context/AuthContext";
import { previewTokenFor } from "@/seasons/preview";
import { useSeason } from "@/seasons/SeasonContext";
import { forgetOpened, readOpened, rememberOpened, rememberedYear } from "./storage";

// Der Adventkalender einer Person (#641): laden, öffnen, Quiz, Verlosung. Der Server entscheidet, was offen ist;
// hier steht nur, was die Seite gerade zeigt. Gäste öffnen ohne Konto - ihr Browser merkt sich die Türchen, und
// nach dem Anmelden werden sie für das Konto nachgeholt.
// Vorschau (#963): läuft die „Vorschau 60 Sekunden“ für den Kalender, geht das Token mit jeder Anfrage - der Server
// zeigt dann den Kalender zur simulierten Zeit und zählt nichts. Was in der Vorschau geöffnet wird, merkt sich nur
// diese Seite, bis sie neu lädt; Erfolge werden nicht gefeiert, bei Verlosungen wird nicht mitgemacht.

export const AWARDED_EVENT = "tls:achievements-awarded";
export const PREVIEW_RAFFLE_TEXT = "In der Vorschau wird bei keiner Verlosung mitgemacht.";

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
  const { preview: previewOn } = useSeason();
  const previewToken = previewOn ? previewTokenFor("advent_calendar") : null;
  const previewOpened = useRef([]);
  const [calendar, setCalendar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const replayed = useRef("");

  const load = useCallback(async () => {
    try {
      const year = rememberedYear();
      const remembered = previewToken ? previewOpened.current : (!userId && year ? readOpened(year) : []);
      const params = { ...(remembered.length ? { opened: remembered.join(",") } : {}), ...(previewToken ? { preview: previewToken } : {}) };
      const { data } = await api.get("/seasonal/advent", { params, skipInvalidation: true });
      // Die gemerkten Türchen gehören zu einem anderen Jahr: ohne sie noch einmal fragen wäre dasselbe - vergessen genügt.
      if (!previewToken && data?.active && year && year !== data.year) forgetOpened(year);
      setCalendar(data || { active: false });
      setError("");
      return data;
    } catch (failure) {
      setError(errorText(failure, "Der Adventkalender lässt sich gerade nicht laden."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [userId, previewToken]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Nach dem Anmelden: was der Browser als Gast geöffnet hat, für das Konto nachholen - einmal je Person und Jahr.
  useEffect(() => {
    if (!userId || !calendar?.active || previewToken) return;
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
  }, [userId, calendar, load, previewToken]);

  const open = useCallback(async (day) => {
    const { data } = await api.post(`/seasonal/advent/${day}/open`, null, { skipInvalidation: true, ...(previewToken ? { params: { preview: previewToken } } : {}) });
    if (previewToken) previewOpened.current = [...new Set([...previewOpened.current, day])].sort((a, b) => a - b);
    else if (!data?.counted && data?.year) rememberOpened(data.year, day);
    setCalendar((current) => {
      const next = withDoor(current, day, { state: "opened", content: data.content, opened_at: data.opened_at });
      if (!next) return next;
      const opened = data.counted ? data.opened : next.doors.filter((door) => door.state === "opened").length;
      return { ...next, opened };
    });
    if (!previewToken) celebrate(Number(data?.newly_awarded) || 0);
    return data;
  }, [previewToken]);

  const answer = useCallback(async (day, choice) => {
    const { data } = await api.post(`/seasonal/advent/${day}/quiz`, { answer: choice }, { skipInvalidation: true, ...(previewToken ? { params: { preview: previewToken } } : {}) });
    setCalendar((current) => withDoor(current, day, (door) => (door.content?.quiz ? { content: { ...door.content, quiz: { ...door.content.quiz, done: true } } } : {})));
    return data;
  }, [previewToken]);

  const raffle = useCallback(async (day, join) => {
    if (previewToken) {
      const refusal = new Error(PREVIEW_RAFFLE_TEXT);
      refusal.response = { status: 409, data: { detail: PREVIEW_RAFFLE_TEXT } };
      throw refusal;
    }
    const { data } = join
      ? await api.post(`/seasonal/advent/${day}/enter`, null, { skipInvalidation: true })
      : await api.delete(`/seasonal/advent/${day}/enter`, { skipInvalidation: true });
    setCalendar((current) => withDoor(current, day, (door) => ({ content: { ...door.content, prize: data.prize } })));
    return data.prize;
  }, [previewToken]);

  return { calendar, loading, error, signedIn: Boolean(userId) && !previewToken, previewing: Boolean(previewToken), reload: load, open, answer, raffle };
}
