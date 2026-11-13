import { useCallback, useEffect, useRef, useState } from "react";
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
 * sich das Turnier ändert. Ohne Pfad lädt er nichts. */
export function useNotices(path, { tournamentId = null } = {}) {
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
  useLiveRefresh(load, ["tournaments", "events"], { fallbackMs: 30000, enabled: Boolean(path), tournamentId });
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

/** Hält Hinweise, die gerade verschwinden, noch einen Augenblick stehen - sie blenden aus statt zu springen. */
function useLeaving(shown) {
  const [leaving, setLeaving] = useState([]);
  const previous = useRef(shown);
  const latest = useRef(shown);
  latest.current = shown;
  const timers = useRef(new Set());
  // Nur wenn sich die Menge ändert - nicht bei jedem Neuzeichnen (die Liste ist jedes Mal eine neue).
  const key = shown.map((item) => item.id).join("|");
  useEffect(() => {
    const now = latest.current;
    const ids = new Set(now.map((item) => item.id));
    const gone = previous.current.filter((item) => !ids.has(item.id));
    previous.current = now;
    if (!gone.length) return undefined;
    setLeaving((current) => [...current.filter((item) => !ids.has(item.id)), ...gone]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setLeaving((current) => current.filter((item) => !gone.some((old) => old.id === item.id)));
    }, LEAVE_MS);
    timers.current.add(timer);
    return undefined;
  }, [key]);
  // Ausblenden läuft auch weiter, wenn gleich danach der nächste Hinweis kommt - erst beim Verlassen der Seite aufräumen.
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);
  return leaving;
}

/**
 * Das Banner. `items`: die Antwort des Servers; `label`: „Turnier“ oder „Event“ für Hinweise eines Turniers auf der
 * Event-Seite (`tournament_title`). `limit`: wie viele höchstens stehen (der neueste zuerst).
 */
export function NoticeBanner({ items, limit = 3, className = "", showTournament = false }) {
  const now = useNow(items);
  const shown = activeNotices(items, now).slice(0, limit);
  const leaving = useLeaving(shown);
  if (!shown.length && !leaving.length) return null;
  return (
    <div className={`space-y-2 ${className}`} role="status" aria-live="polite" data-testid="notice-banner">
      {shown.map((item, index) => <NoticeCard key={item.id} item={item} index={index} now={now} showTournament={showTournament} />)}
      {leaving.map((item) => <NoticeCard key={`leaving-${item.id}`} item={item} index={0} now={now} showTournament={showTournament} leaving />)}
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
      <div className="tls-notice__icon mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[#FFD700]/45 bg-black/40 text-[#FFD700]" aria-hidden="true">
        <Megaphone className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#FFD700]">
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
