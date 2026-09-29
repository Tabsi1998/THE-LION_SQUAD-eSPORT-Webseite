// Motive „Fast Lap“, „Saison“ und „Team“ (E8, #618). Raster 64×64, Linien in currentColor.

export const RACING = {
  "checkered-flag": (
    <>
      <path d="M14 58 V10" strokeWidth="5" />
      <path d="M14 12 H50 V36 H14 Z" />
      <path d="M14 12 h9 v6 h-9z M32 12 h9 v6 h-9z M23 18 h9 v6 h-9z M41 18 h9 v6 h-9z M14 24 h9 v6 h-9z M32 24 h9 v6 h-9z M23 30 h9 v6 h-9z M41 30 h9 v6 h-9z" fill="currentColor" stroke="none" />
    </>
  ),
  "finish-flag": (
    <>
      <path d="M14 58 V10" strokeWidth="5" />
      <path d="M14 12 C26 6 38 18 50 12 V36 C38 42 26 30 14 36 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "starting-lights": (
    <>
      <rect x="8" y="18" width="48" height="26" rx="6" />
      <circle cx="18" cy="31" r="5" fill="currentColor" stroke="none" opacity="0.5" />
      <circle cx="32" cy="31" r="5" fill="currentColor" stroke="none" opacity="0.75" />
      <circle cx="46" cy="31" r="5" fill="currentColor" stroke="none" />
      <path d="M32 18 V8" />
    </>
  ),
  stopwatch: (
    <>
      <circle cx="32" cy="36" r="20" />
      <path d="M32 24 V36 L40 40" strokeWidth="4.5" />
      <path d="M26 8 H38 M32 8 V16 M48 18 L52 14" />
    </>
  ),
  gauge: (
    <>
      <path d="M10 44 A22 22 0 1 1 54 44" />
      <path d="M32 44 L44 24" strokeWidth="4.5" />
      <circle cx="32" cy="44" r="4" fill="currentColor" stroke="none" />
      <path d="M16 36 L20 38 M32 22 V26 M48 36 L44 38" strokeWidth="3" />
    </>
  ),
  helmet: (
    <>
      <path d="M10 36 C10 20 20 12 32 12 C44 12 54 20 54 36 V46 H10 Z" fill="currentColor" stroke="none" />
      <path d="M10 40 H36 C42 40 46 36 46 30 V26" stroke="#000" strokeOpacity="0.45" fill="none" />
      <rect x="34" y="26" width="18" height="12" rx="3" fill="#000" fillOpacity="0.5" stroke="none" />
    </>
  ),
  track: (
    <>
      <path d="M18 14 H40 C50 14 54 22 50 30 C46 38 30 34 26 42 C22 50 30 54 44 54" strokeWidth="6" />
      <path d="M18 14 H40 C50 14 54 22 50 30 C46 38 30 34 26 42 C22 50 30 54 44 54" stroke="#000" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="4 4" />
    </>
  ),
  pole: (
    <>
      <path d="M20 58 V8" strokeWidth="5" />
      <path d="M20 10 H46 L40 20 L46 30 H20 Z" fill="currentColor" stroke="none" />
      <path d="M26 20 L28 14 M30 20 L32 14 M34 20 L36 14" stroke="#000" strokeOpacity="0.45" strokeWidth="2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="10" y="14" width="44" height="40" rx="4" />
      <path d="M10 26 H54 M20 8 V18 M44 8 V18" />
      <circle cx="24" cy="38" r="3" fill="currentColor" stroke="none" />
      <circle cx="40" cy="38" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  "calendar-star": (
    <>
      <rect x="10" y="14" width="44" height="40" rx="4" />
      <path d="M10 26 H54 M20 8 V18 M44 8 V18" />
      <path d="M32 30 L34 36 L40 36 L35 40 L37 46 L32 42 L27 46 L29 40 L24 36 L30 36 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "calendar-link": (
    <>
      <rect x="8" y="14" width="34" height="34" rx="4" />
      <path d="M8 24 H42 M16 8 V16 M34 8 V16" />
      <path d="M40 40 L48 32 M44 46 A6 6 0 0 0 52 38 L56 34 M44 46 L40 50 A6 6 0 0 0 48 58 L52 54" strokeWidth="3.5" />
    </>
  ),
  "full-calendar": (
    <>
      <rect x="10" y="14" width="44" height="40" rx="4" />
      <path d="M10 26 H54 M20 8 V18 M44 8 V18" />
      <path d="M17 32 h6 v5 h-6z M29 32 h6 v5 h-6z M41 32 h6 v5 h-6z M17 41 h6 v5 h-6z M29 41 h6 v5 h-6z M41 41 h6 v5 h-6z" fill="currentColor" stroke="none" />
    </>
  ),
  points: (
    <>
      <circle cx="20" cy="22" r="7" fill="currentColor" stroke="none" />
      <circle cx="44" cy="22" r="7" fill="currentColor" stroke="none" opacity="0.8" />
      <circle cx="32" cy="42" r="7" fill="currentColor" stroke="none" opacity="0.6" />
      <path d="M26 26 L38 26 M24 28 L30 36 M40 28 L34 36" opacity="0.6" />
    </>
  ),
  seven: (
    <>
      <path d="M18 14 H46 L28 52" strokeWidth="7" />
      <path d="M22 32 H38" strokeWidth="5" opacity="0.6" />
    </>
  ),
  eight: (
    <>
      <circle cx="32" cy="22" r="10" strokeWidth="6" />
      <circle cx="32" cy="43" r="12" strokeWidth="6" />
    </>
  ),
  hundred: (
    <>
      <path d="M8 22 L14 16 V48" strokeWidth="5" />
      <ellipse cx="30" cy="32" rx="8" ry="16" strokeWidth="5" />
      <ellipse cx="50" cy="32" rx="8" ry="16" strokeWidth="5" />
    </>
  ),
  "captain-band": (
    <>
      <path d="M12 22 C20 16 44 16 52 22 V42 C44 48 20 48 12 42 Z" fill="currentColor" stroke="none" />
      <path d="M38 26 A8 8 0 1 0 38 38" stroke="#000" strokeOpacity="0.55" strokeWidth="4.5" fill="none" />
    </>
  ),
  roster: (
    <>
      <rect x="12" y="10" width="40" height="46" rx="4" />
      <circle cx="22" cy="22" r="4" fill="currentColor" stroke="none" />
      <path d="M30 22 H44" />
      <circle cx="22" cy="34" r="4" fill="currentColor" stroke="none" />
      <path d="M30 34 H44" />
      <circle cx="22" cy="46" r="4" fill="currentColor" stroke="none" />
      <path d="M30 46 H40" />
    </>
  ),
  group: (
    <>
      <circle cx="22" cy="22" r="7" fill="currentColor" stroke="none" />
      <circle cx="42" cy="22" r="7" fill="currentColor" stroke="none" />
      <path d="M8 50 C8 40 14 36 22 36 C30 36 36 40 36 50 Z" fill="currentColor" stroke="none" />
      <path d="M32 50 C34 42 38 38 42 38 C50 38 56 42 56 50 Z" fill="currentColor" stroke="none" opacity="0.7" />
    </>
  ),
  "handshake-team": (
    <>
      <path d="M8 30 L20 20 L32 30 L44 20 L56 30" />
      <path d="M20 30 L28 38 C30 40 34 40 36 38 L44 30" strokeWidth="4.5" />
      <path d="M14 36 L22 44 M50 36 L42 44" />
      <circle cx="20" cy="12" r="4" fill="currentColor" stroke="none" />
      <circle cx="44" cy="12" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  "team-chat": (
    <>
      <path d="M10 14 H42 V34 H24 L14 42 V34 H10 Z" fill="currentColor" stroke="none" />
      <path d="M46 24 H54 V44 H50 V50 L42 44 H30 V38" />
      <circle cx="20" cy="24" r="2.5" fill="#000" fillOpacity="0.5" stroke="none" />
      <circle cx="28" cy="24" r="2.5" fill="#000" fillOpacity="0.5" stroke="none" />
      <circle cx="36" cy="24" r="2.5" fill="#000" fillOpacity="0.5" stroke="none" />
    </>
  ),
  emblem: (
    <>
      <path d="M32 8 L54 18 V34 C54 46 44 54 32 58 C20 54 10 46 10 34 V18 Z" fill="currentColor" stroke="none" />
      <path d="M32 18 L38 30 L52 30 L42 38 L46 50 L32 42 L18 50 L22 38 L12 30 L26 30 Z" fill="#000" fillOpacity="0.45" stroke="none" transform="translate(0 2) scale(0.8) translate(8 4)" />
    </>
  ),
  banner: (
    <>
      <path d="M16 8 H48 V50 L32 40 L16 50 Z" fill="currentColor" stroke="none" />
      <path d="M22 18 H42 M22 26 H38" stroke="#000" strokeOpacity="0.45" />
    </>
  ),
  compass: (
    <>
      <circle cx="32" cy="32" r="22" />
      <path d="M40 24 L36 36 L24 40 L28 28 Z" fill="currentColor" stroke="none" />
      <circle cx="32" cy="32" r="2.5" fill="#000" fillOpacity="0.5" stroke="none" />
      <path d="M32 6 V10 M32 54 V58 M6 32 H10 M54 32 H58" strokeWidth="3" />
    </>
  ),
  map: (
    <>
      <path d="M8 16 L24 10 L40 16 L56 10 V48 L40 54 L24 48 L8 54 Z" />
      <path d="M24 10 V48 M40 16 V54" opacity="0.6" />
      <circle cx="16" cy="30" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  explorer: (
    <>
      <path d="M32 8 C22 8 16 16 16 26 C16 38 32 56 32 56 C32 56 48 38 48 26 C48 16 42 8 32 8 Z" fill="currentColor" stroke="none" />
      <circle cx="32" cy="26" r="7" fill="#000" fillOpacity="0.5" stroke="none" />
      <path d="M10 58 H54" opacity="0.5" />
    </>
  ),
};
