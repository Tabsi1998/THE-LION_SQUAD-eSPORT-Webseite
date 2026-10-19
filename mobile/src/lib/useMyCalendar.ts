import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { MyCalendarItem, Subscription } from "./myCalendar";

// „Mein Kalender“ (#1788): die eigenen Termine vom Server (GET /api/calendar/me) - dieselbe Liste wie der persönliche
// Feed, auch ohne Abo. Ohne Konto (401) bittet der Screen um das Login statt um Geduld.

export type MyCalendarState = {
  items: MyCalendarItem[];
  subscription: Subscription | null;
  loading: boolean;
  failed: boolean;
  needsLogin: boolean;
};

type MePayload = { items?: MyCalendarItem[]; subscription?: Subscription | null; hint_due?: boolean };

const EMPTY: MyCalendarState = { items: [], subscription: null, loading: true, failed: false, needsLogin: false };

/** Lädt beim Einschalten und jedes Mal, wenn sich `refreshKey` ändert. Eine späte Antwort eines alten Aufrufs zählt nicht. */
export function useMyCalendar(enabled: boolean, refreshKey: unknown = 0): MyCalendarState & { reload: () => void } {
  const [state, setState] = useState<MyCalendarState>(EMPTY);
  const call = useRef(0);

  const reload = useCallback(() => {
    const mine = ++call.current;
    setState((current) => ({ ...current, failed: false, loading: !current.items.length }));
    api.get<MePayload>("/calendar/me")
      .then(({ data }) => {
        if (mine !== call.current) return;
        setState({
          items: Array.isArray(data?.items) ? data.items : [],
          subscription: data?.subscription || null,
          loading: false,
          failed: false,
          needsLogin: false,
        });
      })
      .catch((error: { response?: { status?: number } }) => {
        if (mine !== call.current) return;
        const needsLogin = error?.response?.status === 401;
        setState((current) => ({ ...current, loading: false, failed: !needsLogin, needsLogin }));
      });
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reload();
  }, [enabled, refreshKey, reload]);

  return { ...state, reload };
}
