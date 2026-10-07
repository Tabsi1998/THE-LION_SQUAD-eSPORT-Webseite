import { useId } from "react";
import { Link } from "react-router-dom";
import { bestPlacement, displayTitle, entriesOf, gameTitle, medalOf, timeOf } from "@/components/tls/references/referenceParts";

// Die Erfolgswand als Vitrine (#1334): jeder Podestplatz ein gezeichneter Pokal in Gold, Silber oder Bronze auf einem
// Regalbrett, darunter Platz, Wettbewerb (zwei Zeilen erlaubt) und „11 Teams“. Ein Klick öffnet die Details wie bisher.
// Gold bekommt beim Drüberfahren einen ruhigen Lichtschimmer - nie mit „Bewegung reduzieren“ (index.css, --tls-motion-on).

export const METALS = {
  gold: { label: "Gold", light: "#FFF2A8", base: "#FFD700", dark: "#8A6A12", text: "text-[#FFD700]" },
  silver: { label: "Silber", light: "#FFFFFF", base: "#C9CED6", dark: "#6F7682", text: "text-[#E2E2E2]" },
  bronze: { label: "Bronze", light: "#F2C08E", base: "#D08A4E", dark: "#6E3F16", text: "text-[#E4A464]" },
};

/** Der Pokal: eine Form, drei Metall-Verläufe. */
export function TrophyCup({ medal = "gold", className = "", testId }) {
  const metal = METALS[medal] || METALS.bronze;
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 64 72" className={`tls-trophy__cup ${className}`} role="img" aria-label={`Pokal in ${metal.label}`} data-testid={testId} data-medal={medal}>
      <defs>
        <linearGradient id={`${id}-metal`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={metal.dark} />
          <stop offset="0.42" stopColor={metal.light} />
          <stop offset="0.6" stopColor={metal.base} />
          <stop offset="1" stopColor={metal.dark} />
        </linearGradient>
        <clipPath id={`${id}-bowl`}>
          <path d="M16 6h32v16a16 16 0 0 1-32 0z" />
        </clipPath>
      </defs>
      <path d="M16 10h-7c0 9 4.5 13.5 10 14.5M48 10h7c0 9-4.5 13.5-10 14.5" fill="none" stroke={metal.base} strokeWidth="3" strokeLinecap="round" />
      <path d="M16 6h32v16a16 16 0 0 1-32 0z" fill={`url(#${id}-metal)`} />
      <g clipPath={`url(#${id}-bowl)`}>
        <rect className="tls-trophy__shine" x="-20" y="0" width="12" height="40" fill="#FFFFFF" opacity="0.55" transform="skewX(-18)" />
      </g>
      <rect x="29" y="38" width="6" height="12" fill={metal.dark} />
      <rect x="21" y="50" width="22" height="7" rx="1.5" fill={`url(#${id}-metal)`} />
      <rect x="16" y="57" width="32" height="8" rx="1.5" fill={metal.dark} />
    </svg>
  );
}

/** „11 Teams“ oder „13 Teilnehmende“ - aus dem besten Eintrag der Teilnahme. */
export function fieldSize(item) {
  const entries = entriesOf(item);
  const best = entries.find((entry) => Number(entry.placement) === bestPlacement(item)) || entries[0] || {};
  if (best.team_count) return `${best.team_count} Teams`;
  if (best.participant_count) return `${best.participant_count} Teilnehmende`;
  return "";
}

/** Die Pokale der Vitrine: nach Metall, dann das Neueste zuerst - oder (für „Über uns“) einfach die neuesten. */
export function trophiesOf(items, { newest = false, limit = 0 } = {}) {
  const rank = { gold: 0, silver: 1, bronze: 2 };
  const list = (Array.isArray(items) ? items : []).filter((item) => medalOf(item));
  list.sort((a, b) => (newest ? timeOf(b) - timeOf(a) : (rank[medalOf(a)] - rank[medalOf(b)]) || (timeOf(b) - timeOf(a))));
  return limit ? list.slice(0, limit) : list;
}

export function TrophyShelf({ items, compact = false, testId = "trophy-shelf" }) {
  if (!items?.length) return null;
  return (
    <ul className={`tls-trophy-shelf grid ${compact ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`} data-testid={testId}>
      {items.map((item) => {
        const medal = medalOf(item);
        const metal = METALS[medal] || METALS.bronze;
        const size = fieldSize(item);
        return (
          <li key={item.id} className="tls-trophy-shelf__slot">
            <Link to={`/references/${item.id}`} data-testid={`${testId}-${item.id}`} data-season-anchor="card" className={`tls-card tls-card--own tls-trophy tls-trophy--${medal} group flex flex-col items-center text-center gap-1.5 rounded-sm px-2 pt-2 pb-4`}>
              <TrophyCup medal={medal} className={compact ? "w-14 h-16" : "w-16 h-[4.5rem] sm:w-20 sm:h-[5.5rem]"} />
              <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${metal.text}`}>{bestPlacement(item)}. Platz</span>
              <span className="tls-card__title font-bold text-sm leading-tight break-words">{displayTitle(item)}</span>
              <span className="text-xs text-white/55">{[compact ? "" : gameTitle(item), size].filter(Boolean).join(" · ")}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
