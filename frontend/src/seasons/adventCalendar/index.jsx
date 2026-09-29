import { useId } from "react";
import { Link } from "react-router-dom";
import "./advent-calendar-widget.css";

// Adventkalender (#641): der Einstieg neben dem Logo - ein kleines Türchen mit der Zahl des neuesten Tages, das zur
// Seite /advent führt. Es erscheint nur, wenn für das Jahr Türchen angelegt sind (`data.ready` vom Server). Durch
// den Spalt fällt Licht; „dezent“ und „Bewegung reduzieren“ lassen es ruhig stehen.

export const ACCENT = "rgba(233, 196, 106, 0.26)";

/** Was das kleine Türchen zeigt und sagt - aus der Antwort des Servers. */
export function calendarEntry(season) {
  const data = season?.data || {};
  if (!data.ready) return null;
  const door = Math.max(0, Math.min(24, Math.round(Number(data.today_door) || 0)));
  const hour = Math.round(Number(data.door_hour)) || 6;
  if (data.catch_up) return { door: 24, label: "Adventkalender – alle Türchen sind offen, nachholen bis 6. Jänner", waiting: false, catchUp: true };
  if (door === 0) return { door: 1, label: `Adventkalender – das erste Türchen öffnet sich um ${hour} Uhr`, waiting: true, catchUp: false, hour };
  return { door, label: `Adventkalender – Türchen ${door} ist offen`, waiting: false, catchUp: false };
}

/** Das kleine Türchen als Zeichnung - für die Kopfzeile und den Hinweis im Dashboard. */
export function DoorGlyph({ door }) {
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg viewBox="0 0 36 40" aria-hidden="true" className="tls-advcal__svg">
      <defs>
        <linearGradient id={`${ids}-door`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2a58" />
          <stop offset="1" stopColor="#0b1330" />
        </linearGradient>
        <linearGradient id={`${ids}-gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.5" stopColor="#e9c46a" />
          <stop offset="1" stopColor="#b8862b" />
        </linearGradient>
        <radialGradient id={`${ids}-light`} cx="50%" cy="55%" r="60%">
          <stop offset="0" stopColor="rgba(255, 200, 110, 0.85)" />
          <stop offset="1" stopColor="rgba(255, 180, 84, 0)" />
        </radialGradient>
      </defs>
      <ellipse className="tls-advcal__light" cx="18" cy="22" rx="17" ry="18" fill={`url(#${ids}-light)`} />
      <path d="M6 37 V17 C6 9.3 11.4 4 18 4 S30 9.3 30 17 V37 Z" fill={`url(#${ids}-door)`} stroke={`url(#${ids}-gold)`} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8.6 35 V17.3 C8.6 11 13 6.7 18 6.7 S27.4 11 27.4 17.3 V35" fill="none" stroke="rgba(233, 196, 106, 0.35)" strokeWidth="0.7" />
      <path d="M13.5 9.8 l0.9 1.9 2 0.2 -1.5 1.4 0.4 2 -1.8 -1 -1.8 1 0.4 -2 -1.5 -1.4 2 -0.2 z" fill="#e9c46a" opacity="0.55" transform="translate(4.5 -1.5) scale(0.62)" />
      <text x="17.5" y="28.2" textAnchor="middle" fontFamily={'Georgia, "Noto Serif", "Times New Roman", serif'} fontWeight="600" fontSize={door > 9 ? 12.5 : 14} fill={`url(#${ids}-gold)`}>{door}</text>
    </svg>
  );
}

export function Widget({ season }) {
  const entry = calendarEntry(season);
  if (!entry) return null;
  const subtle = season?.effective === "subtle";
  return (
    <Link
      to="/advent"
      className={`tls-advcal${subtle ? " tls-advcal--subtle" : ""}${entry.waiting ? " tls-advcal--waiting" : ""}`}
      aria-label={entry.label}
      title={entry.label}
      data-testid="advent-calendar-widget"
      data-door={entry.door}
    >
      <DoorGlyph door={entry.door} />
    </Link>
  );
}

export const season = { key: "advent_calendar", accent: ACCENT, Widget };
