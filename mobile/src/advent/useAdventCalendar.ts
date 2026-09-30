import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api, errorMessage } from "../lib/api";
import { isGuestUser } from "../live";
import type { Calendar, Door, DoorContent, PrizeState } from "./doors";
import { forgetOpened, readOpened, rememberOpened, remembered } from "./storage";

// Der Adventkalender einer Person in der App (#641, #642): laden, öffnen, Quiz, Verlosung - dieselbe Schnittstelle
// wie im Web. Der Server entscheidet, was offen ist. Gäste öffnen ohne Konto; ihr Gerät merkt sich die Türchen, und
// nach dem Anmelden werden sie für das Konto nachgeholt.

export type OpenResult = { day: number; year: number; content: DoorContent; counted: boolean; first: boolean; opened: number | null; newly_awarded: number; opened_at?: string | null };
export type QuizResult = { day: number; correct: boolean; correct_index: number; correct_answer: string; explanation: string; done: boolean };

function withDoor(calendar: Calendar | null, day: number, patch: Partial<Door> | ((door: Door) => Partial<Door>)): Calendar | null {
  if (!calendar?.doors) return calendar;
  return { ...calendar, doors: calendar.doors.map((door) => (door.day === day ? { ...door, ...(typeof patch === "function" ? patch(door) : patch) } : door)) };
}

export function useAdventCalendar(onAwarded?: (count: number) => void) {
  const { user } = useAuth();
  const userId = user?.id && !isGuestUser(user) ? user.id : null;
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const replayed = useRef("");
  const awarded = useRef(onAwarded);
  awarded.current = onAwarded;

  const load = useCallback(async (): Promise<Calendar | null> => {
    try {
      const stored = userId ? null : await remembered();
      const params = stored?.days.length ? { opened: stored.days.join(",") } : {};
      const { data } = await api.get<Calendar>("/seasonal/advent", { params });
      // Die gemerkten Türchen gehören zu einem anderen Jahr: vergessen.
      if (data?.active && stored && stored.year !== data.year) await forgetOpened(stored.year);
      setCalendar(data || { active: false });
      setError("");
      return data;
    } catch (failure) {
      setError(errorMessage(failure, "Der Adventkalender lässt sich gerade nicht laden."));
      return null;
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Nach dem Anmelden: was das Gerät als Gast geöffnet hat, für das Konto nachholen - einmal je Person und Jahr.
  useEffect(() => {
    if (!userId || !calendar?.active || !calendar.year || !calendar.doors) return;
    const key = `${userId}:${calendar.year}`;
    if (replayed.current === key) return;
    replayed.current = key;
    const year = calendar.year;
    const open = new Set(calendar.doors.filter((door) => door.state === "opened").map((door) => door.day));
    (async () => {
      const pending = (await readOpened(year)).filter((day) => !open.has(day));
      if (!pending.length) {
        await forgetOpened(year);
        return;
      }
      let count = 0;
      for (const day of pending) {
        try {
          const { data } = await api.post<OpenResult>(`/seasonal/advent/${day}/open`);
          count += Number(data?.newly_awarded) || 0;
        } catch {
          // Ein Türchen, das sich nicht nachholen lässt, bleibt für die Person einfach zu.
        }
      }
      await forgetOpened(year);
      if (count > 0) awarded.current?.(count);
      await load();
    })();
  }, [userId, calendar, load]);

  const open = useCallback(async (day: number): Promise<OpenResult> => {
    const { data } = await api.post<OpenResult>(`/seasonal/advent/${day}/open`);
    if (!data.counted && data.year) await rememberOpened(data.year, day);
    setCalendar((current) => {
      const next = withDoor(current, day, { state: "opened", content: data.content, opened_at: data.opened_at });
      if (!next?.doors) return next;
      const opened = data.counted && data.opened !== null ? data.opened : next.doors.filter((door) => door.state === "opened").length;
      return { ...next, opened };
    });
    if (Number(data.newly_awarded) > 0) awarded.current?.(Number(data.newly_awarded));
    return data;
  }, []);

  const answer = useCallback(async (day: number, choice: number): Promise<QuizResult> => {
    const { data } = await api.post<QuizResult>(`/seasonal/advent/${day}/quiz`, { answer: choice });
    setCalendar((current) => withDoor(current, day, (door) => (door.content?.quiz ? { content: { ...door.content, quiz: { ...door.content.quiz, done: true } } } : {})));
    return data;
  }, []);

  const raffle = useCallback(async (day: number, join: boolean): Promise<PrizeState> => {
    const { data } = join ? await api.post<{ prize: PrizeState }>(`/seasonal/advent/${day}/enter`) : await api.delete<{ prize: PrizeState }>(`/seasonal/advent/${day}/enter`);
    setCalendar((current) => withDoor(current, day, (door) => (door.content ? { content: { ...door.content, prize: data.prize } } : {})));
    return data.prize;
  }, []);

  return { calendar, loading, error, signedIn: Boolean(userId), reload: load, open, answer, raffle };
}
