import { useCallback, useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { api } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { activeNotices, nextExpiry, noticeClock, remainingShare, remainingText } from "@/lib/tournamentNotices";
import "./notice.css";

// Hinweis der Turnierleitung (#1166): oben auf Turnier- und Event-Seite, bis er abläuft oder entfernt wird. Öffentlich -
// nur Text und Zeit, nie die Person, die geschrieben hat (der Server schickt sie gar nicht erst).

const TICK_MS = 30000;
const LEAVE_MS = 180;

/** Lädt die stehenden Hinweise (`path`: `/tournaments/<id>/notices` bzw. `/events/<slug>/notices`) und lädt nach, sobald
 * sich das Turnier oder ein anderes Turnier desselben Events (`eventId`) ändert. Ohne Pfad lädt er nichts. */
export function useNotices(path, { tournamentId = null, eventId = null } = {}) {
  const [items, setItems] = useState([]);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      const { data } = await api.get(path);
      setItems(Array.isArray(data?.items) ? data.items : []);
    } catch {
      // Ein fehlendes Banner hält die Seite nicht auf.
      setItems([]);
    }
  }, [path]);
  useEffect(() => { load(); }, [load]);
  // Ein Hinweis ans ganze Event kann aus einem anderen Turnier des Events kommen (#1166, Review M2): dann zählt jede Änderung
  // eines Turniers desselben Events - nicht nur die des eigenen.
  useLiveRefresh(load, ["tournaments", "events"], { fallbackMs: 30000, enabled: Boolean(path), tournamentId, eventId, wholeEvent: true });
  return items;
}

/** Die Uhr des Banners: alle 30 Sekunden für die Restzeit - und genau dann, wenn der nächste Hinweis abläuft. */
function useNow(items) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const left = nextExpiry(items, Date.now());
    if (left == null) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(left + 50, 2147483000));
    return () => clearTimeout(timer);
  }, [items, now]);
  return now;
}

/**
 * Was das Banner zeigt: die stehenden Hinweise und dazu, am selben Platz und mit demselben Schlüssel, die gerade
 * verschwundenen - so blendet dieselbe Karte aus, statt neu einzufahren und am Ende zu stehen (Review N2). Die Liste der
 * verschwindenden wird beim Zeichnen nachgeführt (Zustand „während des Renderns“ angepasst): Schon das erste Bild ohne
 * den Hinweis hält seine Karte noch, sonst würde sie einmal abgebaut und neu angelegt.
 */
function useDisplayed(shown) {
  const key = shown.map((item) => item.id).join("|");
  const [state, setState] = useState({ key, shown, leaving: [] });
  if (state.key !== key) {
    const ids = new Set(shown.map((item) => item.id));
    const gone = state.shown.map((item, index) => ({ item, index })).filter(({ item }) => !ids.has(item.id));
    const kept = state.leaving.filter(({ item }) => !ids.has(item.id) && !gone.some((entry) => entry.item.id === item.id));
    setState({ key, shown, leaving: [...kept, ...gone] });
  }
  const leavingKey = state.leaving.map((entry) => entry.item.id).join("|");
  useEffect(() => {
    if (!leavingKey) return undefined;
    const timer = setTimeout(() => setState((current) => ({ ...current, leaving: [] })), LEAVE_MS);
    return () => clearTimeout(timer);
  }, [leavingKey]);
  const ids = new Set(shown.map((item) => item.id));
  const list = shown.map((item) => ({ item, leaving: false }));
  [...state.leaving]
    .filter(({ item }) => !ids.has(item.id))
    .sort((a, b) => a.index - b.index)
    .forEach(({ item, index }) => list.splice(Math.min(index, list.length), 0, { item, leaving: true }));
  return list;
}

/**
 * Das Banner. `items`: die Antwort des Servers; `showTournament`: auf der Event-Seite der Turniername vor Hinweisen eines
 * Turniers (`tournament_title`). `limit`: wie viele höchstens stehen (der neueste zuerst).
 */
export function NoticeBanner({ items, limit = 3, className = "", showTournament = false }) {
  const now = useNow(items);
  const shown = activeNotices(items, now).slice(0, limit);
  const displayed = useDisplayed(shown);
  if (!displayed.length) return null;
  return (
    <div className={`space-y-2 ${className}`} role="status" aria-live="polite" data-testid="notice-banner">
      {displayed.map(({ item, leaving }, index) => (
        <NoticeCard key={item.id} item={item} index={index} now={now} showTournament={showTournament} leaving={leaving} />
      ))}
    </div>
  );
}

function NoticeCard({ item, index, now, showTournament, leaving = false }) {
  // Die Leiste gleitet bis zum nächsten Takt dorthin, wo sie dann stehen wird - so läuft sie ohne Sprung gleichmäßig leer.
  const share = remainingShare(item, now + TICK_MS);
  const where = showTournament && item.target === "tournament" && item.tournament_title ? item.tournament_title : "";
  return (
    <div
      className="tls-notice flex items-start gap-3 rounded-sm px-3 py-3 sm:px-4"
      style={{ "--tls-notice-i": index }}
      data-leaving={leaving ? "1" : undefined}
      aria-hidden={leaving ? "true" : undefined}
      data-testid={leaving ? undefined : `notice-${item.id}`}
    >
      <div className="tls-notice__icon mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-honor/45 bg-black/40 text-honor" aria-hidden="true">
        <Megaphone className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-honor">
          Hinweis der Turnierleitung{where ? <span className="text-white/45 tracking-[0.12em]"> · {where}</span> : null}
        </div>
        <p className="mt-0.5 text-base sm:text-lg font-bold leading-snug text-white [overflow-wrap:anywhere]" data-testid="notice-text">{item.text}</p>
        <div className="mt-1 text-[11px] text-white/50 tabular-nums" data-testid="notice-meta">
          {noticeClock(item)} Uhr · {remainingText(item.expires_at, now)}
        </div>
      </div>
      <span className="tls-notice__left" style={{ transform: `scaleX(${share})` }} aria-hidden="true" />
    </div>
  );
}
