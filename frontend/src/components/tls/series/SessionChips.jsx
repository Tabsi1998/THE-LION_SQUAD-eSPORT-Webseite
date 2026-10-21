import { Link } from "react-router-dom";
import { PUBLIC_STATE_LABELS, STATE_LABELS, STATE_TONES, dayLabel } from "@/lib/referenceCalendar";
import { chipLabel } from "@/lib/raceWeekend";
import { dayNoon, viennaDate } from "@/lib/vienna";

// Lauf-Chips eines Rennwochenendes (#1930): „Quali · Sprint · Rennen“ in einer Zeile, je Chip in der Farbe seines
// Status (wie die Status-Abzeichen des Kalenders), optional mit Uhrzeit - an einem anderen Tag als der erste Lauf mit
// Wochentag. Ein Chip ist ein Link (`hrefFor`), ein Knopf (`onOpen`, etwa „Ergebnis eintragen“ in der Verwaltung) oder
// reiner Text. So docken die Ergebnis-Ansicht je Lauf (#1950) und die Verwaltung an, ohne die Chips neu zu bauen.

const BASE = "inline-flex items-center gap-1.5 px-2 py-1 border rounded-sm text-[11px] font-bold uppercase tracking-[0.1em] leading-none whitespace-nowrap";
const PRESS = "tls-session-chip transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#29B6E8] hover:border-white/40 hover:text-white";

function weekday(day) {
  return day ? viennaDate(dayNoon(day), { weekday: "short" }).replace(/\.$/, "") : "";
}

/** Uhrzeit eines Laufs - an einem anderen Tag als `leadDay` mit Wochentag („Sa 20:00“). */
export function chipWhen(round, leadDay) {
  const otherDay = round?.club_day && leadDay && round.club_day !== leadDay;
  return [otherDay ? weekday(round.club_day) : "", round?.time || ""].filter(Boolean).join(" ");
}

function chipTitle(round, labels) {
  const when = [dayLabel(round?.club_day), round?.time].filter(Boolean).join(" · ");
  return [round?.session || "Rennen", when, labels[round?.state] || ""].filter(Boolean).join(", ");
}

/** Die Läufe einer Runde als Chips. `rounds`: die Termine der Runde in Kalender-Reihenfolge. `showTime` zeigt die
 * Uhrzeit, `admin` die Status-Worte der Verwaltung („Ergebnis fehlt“ statt „Ergebnis folgt“). */
export function SessionChips({ rounds, showTime = false, hrefFor, onOpen, admin = false, className = "", testId = "session-chips" }) {
  const list = rounds || [];
  if (!list.length) return null;
  const leadDay = list[0]?.club_day;
  const labels = admin ? STATE_LABELS : PUBLIC_STATE_LABELS;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`} aria-label="Läufe der Runde" data-testid={testId}>
      {list.map((round) => {
        const tone = STATE_TONES[round.state] || STATE_TONES.planned;
        const when = showTime ? chipWhen(round, leadDay) : "";
        const title = chipTitle(round, labels);
        const body = (
          <>
            <span>{chipLabel(round)}</span>
            {when && <span className="font-semibold normal-case tracking-normal tabular-nums opacity-80">{when}</span>}
          </>
        );
        const props = { className: `${BASE} ${tone}`, title, "data-state": round.state, "data-testid": "session-chip" };
        const href = hrefFor?.(round);
        return (
          <li key={round.id}>
            {href ? (
              <Link to={href} {...props} className={`${props.className} ${PRESS}`} aria-label={title}>{body}</Link>
            ) : onOpen ? (
              <button type="button" {...props} className={`${props.className} ${PRESS} min-h-[32px]`} onClick={() => onOpen(round)} aria-label={title}>{body}</button>
            ) : (
              <span {...props}>{body}<span className="sr-only">{`: ${title}`}</span></span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
