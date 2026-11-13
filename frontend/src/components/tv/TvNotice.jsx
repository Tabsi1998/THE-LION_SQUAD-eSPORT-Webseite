import { useEffect, useState } from "react";
import { Megaphone } from "lucide-react";
import { activeNotices, nextExpiry, noticeClock, remainingShare, remainingText } from "@/lib/tournamentNotices";

// Hinweis der Turnierleitung am TV (#1166): ein Band unter der Kopfleiste, solange der Hinweis steht - nur die mit
// „auch am TV zeigen“, nur Text und Zeit. Turnierbaum-TV und Hallen-Tafel zeigen dasselbe Band.

const TICK_MS = 30000;

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

/** `items`: die Hinweise aus der TV-Antwort; `showTournament`: an der Hallen-Tafel der Turniername davor. */
export function TvNoticeBand({ items, limit = 2, showTournament = false }) {
  const now = useNow(items);
  const shown = activeNotices((items || []).filter((item) => item?.tv !== false), now).slice(0, limit);
  if (!shown.length) return null;
  return (
    <div className="tv-notice-band" role="status" aria-live="polite" data-testid="tv-notice-band">
      {shown.map((item, index) => {
        const where = showTournament && item.target === "tournament" && item.tournament_title ? item.tournament_title : "";
        return (
          <div key={item.id} className="tv-notice" style={{ "--tv-notice-i": index }} data-testid={`tv-notice-${item.id}`}>
            <div className="tv-notice__badge" aria-hidden="true"><Megaphone className="tv-icon" /></div>
            <div className="tv-notice__body">
              <div className="tv-notice__kicker tv-t-meta">Hinweis der Turnierleitung{where ? ` · ${where}` : ""}</div>
              <div className="tv-notice__text tv-t-head font-heading font-black" data-testid="tv-notice-text">{item.text}</div>
            </div>
            <div className="tv-notice__time tv-t-info" data-testid="tv-notice-time">
              <span>{noticeClock(item)} Uhr</span>
              <span className="tv-muted">{remainingText(item.expires_at, now)}</span>
            </div>
            <span className="tv-notice__left" style={{ transform: `scaleX(${remainingShare(item, now + TICK_MS)})` }} aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}
