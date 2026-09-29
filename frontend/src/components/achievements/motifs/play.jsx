// Motive „Spielen“ und „Turnier“ (E8, #618). Raster 64×64, Linien in currentColor (Strich 4, runde Enden),
// Flächen mit fill="currentColor". Die Farbe setzt das Abzeichen je Material.

export const PLAY = {
  "crossed-swords": (
    <>
      <path d="M14 50 L46 18 M50 14 L44 20 M18 46 L12 52" />
      <path d="M50 50 L18 18 M14 14 L20 20 M46 46 L52 52" />
      <path d="M12 44 L20 52 M44 12 L52 20" strokeWidth="5" />
      <circle cx="32" cy="32" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  "crossed-flags": (
    <>
      <path d="M12 54 L26 12 M52 54 L38 12" />
      <path d="M26 12 L44 18 L28 26 Z" fill="currentColor" stroke="none" />
      <path d="M38 12 L20 18 L36 26 Z" fill="currentColor" stroke="none" opacity="0.6" />
      <path d="M22 54 L42 54" />
    </>
  ),
  crown: (
    <>
      <path d="M12 46 L10 22 L24 32 L32 16 L40 32 L54 22 L52 46 Z" fill="currentColor" stroke="none" />
      <path d="M14 52 L50 52" strokeWidth="5" />
      <circle cx="32" cy="16" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  "category-crown": (
    <>
      <path d="M14 42 L12 24 L23 32 L32 20 L41 32 L52 24 L50 42 Z" fill="currentColor" stroke="none" />
      <rect x="16" y="46" width="32" height="6" rx="2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="24" r="3" fill="currentColor" stroke="none" />
      <circle cx="52" cy="24" r="3" fill="currentColor" stroke="none" />
      <circle cx="32" cy="20" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  champion: (
    <>
      <path d="M20 12 H44 V26 C44 34 38 40 32 40 C26 40 20 34 20 26 Z" fill="currentColor" stroke="none" />
      <path d="M20 16 H12 C12 26 16 30 22 31 M44 16 H52 C52 26 48 30 42 31" />
      <path d="M32 40 V48 M22 54 H42" />
      <path d="M26 24 L30 28 L38 20" stroke="#000" strokeOpacity="0.45" strokeWidth="3.5" />
    </>
  ),
  checkmark: (
    <>
      <circle cx="32" cy="32" r="22" />
      <path d="M20 33 L28 41 L44 24" strokeWidth="5" />
    </>
  ),
  clock: (
    <>
      <circle cx="32" cy="32" r="22" />
      <path d="M32 18 V32 L42 38" strokeWidth="4.5" />
      <circle cx="32" cy="32" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  alarm: (
    <>
      <circle cx="32" cy="36" r="18" />
      <path d="M32 26 V36 L38 40 M12 22 L20 14 M52 22 L44 14 M24 54 L20 58 M40 54 L44 58" />
    </>
  ),
  target: (
    <>
      <circle cx="32" cy="32" r="22" />
      <circle cx="32" cy="32" r="13" />
      <circle cx="32" cy="32" r="4" fill="currentColor" stroke="none" />
      <path d="M32 6 V14 M32 50 V58 M6 32 H14 M50 32 H58" />
    </>
  ),
  shield: (
    <>
      <path d="M32 8 L52 16 V30 C52 44 44 52 32 58 C20 52 12 44 12 30 V16 Z" />
      <path d="M32 16 V50" opacity="0.7" />
    </>
  ),
  "shield-star": (
    <>
      <path d="M32 8 L52 16 V30 C52 44 44 52 32 58 C20 52 12 44 12 30 V16 Z" />
      <path d="M32 22 L35 30 L43 30 L37 35 L39 43 L32 38 L25 43 L27 35 L21 30 L29 30 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "shield-heart": (
    <>
      <path d="M32 8 L52 16 V30 C52 44 44 52 32 58 C20 52 12 44 12 30 V16 Z" />
      <path d="M32 44 C22 36 20 32 20 28 C20 24 24 22 27 24 L32 28 L37 24 C40 22 44 24 44 28 C44 32 42 36 32 44 Z" fill="currentColor" stroke="none" />
    </>
  ),
  streak: (
    <>
      <path d="M36 8 C38 20 48 24 48 38 C48 48 40 56 32 56 C24 56 16 48 16 38 C16 30 20 26 24 22 C24 30 28 32 30 30 C30 22 30 14 36 8 Z" fill="currentColor" stroke="none" />
      <path d="M32 56 C28 50 26 46 30 40 C34 46 36 50 32 56 Z" fill="#000" fillOpacity="0.4" stroke="none" />
    </>
  ),
  lightning: (
    <>
      <path d="M36 6 L14 36 H30 L26 58 L50 26 H34 Z" fill="currentColor" stroke="none" />
    </>
  ),
  bolt: (
    <>
      <path d="M34 8 L18 34 H31 L28 56 L46 28 H33 Z" fill="currentColor" stroke="none" />
      <circle cx="12" cy="22" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="52" cy="44" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  spark: (
    <>
      <path d="M32 8 L36 26 L54 32 L36 38 L32 56 L28 38 L10 32 L28 26 Z" fill="currentColor" stroke="none" />
      <path d="M50 12 L52 18 L58 20 L52 22 L50 28 L48 22 L42 20 L48 18 Z" fill="currentColor" stroke="none" opacity="0.7" />
    </>
  ),
  phoenix: (
    <>
      <path d="M32 10 C40 18 48 22 52 34 C48 32 44 32 42 34 C50 40 46 52 36 56 C40 48 36 44 32 42 C28 44 24 48 28 56 C18 52 14 40 22 34 C20 32 16 32 12 34 C16 22 24 18 32 10 Z" fill="currentColor" stroke="none" />
      <circle cx="32" cy="24" r="2.5" fill="#000" fillOpacity="0.5" stroke="none" />
    </>
  ),
  giant: (
    <>
      <circle cx="32" cy="16" r="7" fill="currentColor" stroke="none" />
      <path d="M32 26 V44 M20 30 L32 26 L44 30 M32 44 L22 58 M32 44 L42 58" strokeWidth="5" />
      <path d="M10 22 L14 20 M54 22 L50 20" opacity="0.5" />
    </>
  ),
  gavel: (
    <>
      <path d="M18 16 L34 32 M40 10 L54 24 M46 16 L26 36" strokeWidth="5" />
      <path d="M12 52 L30 34" strokeWidth="6" />
      <path d="M10 58 H36" />
    </>
  ),
  whistle: (
    <>
      <path d="M40 22 H20 C12 22 10 32 12 38 C14 46 22 50 30 46 L48 38 V22 H54 V32" />
      <circle cx="22" cy="36" r="4" fill="currentColor" stroke="none" />
      <path d="M52 12 L56 8 M58 18 L62 16" opacity="0.6" />
    </>
  ),
  watchdog: (
    <>
      <circle cx="32" cy="34" r="18" />
      <path d="M22 34 C26 28 38 28 42 34 C38 40 26 40 22 34 Z" fill="currentColor" stroke="none" />
      <circle cx="32" cy="34" r="3" fill="#000" fillOpacity="0.6" stroke="none" />
      <path d="M32 8 V14 M12 20 L16 24 M52 20 L48 24" />
    </>
  ),
  clipboard: (
    <>
      <rect x="14" y="12" width="36" height="44" rx="4" />
      <rect x="24" y="8" width="16" height="8" rx="2" fill="currentColor" stroke="none" />
      <path d="M22 30 L28 36 L42 24" />
      <path d="M22 46 H42" />
    </>
  ),
  ticket: (
    <>
      <path d="M10 22 C14 22 16 20 16 16 H48 C48 20 50 22 54 22 V42 C50 42 48 44 48 48 H16 C16 44 14 42 10 42 Z" />
      <path d="M32 20 V44" strokeDasharray="4 4" />
    </>
  ),
  "ticket-stub": (
    <>
      <path d="M10 22 C14 22 16 20 16 16 H48 C48 20 50 22 54 22 V42 C50 42 48 44 48 48 H16 C16 44 14 42 10 42 Z" />
      <path d="M40 20 V44" strokeDasharray="4 4" />
      <path d="M20 28 H32 M20 36 H30" />
    </>
  ),
  "team-ticket": (
    <>
      <path d="M10 22 C14 22 16 20 16 16 H48 C48 20 50 22 54 22 V42 C50 42 48 44 48 48 H16 C16 44 14 42 10 42 Z" />
      <circle cx="26" cy="29" r="4" fill="currentColor" stroke="none" />
      <circle cx="38" cy="29" r="4" fill="currentColor" stroke="none" />
      <path d="M18 42 C20 36 26 36 32 38 C38 36 44 36 46 42" />
    </>
  ),
  grid: (
    <>
      <rect x="12" y="12" width="16" height="16" rx="3" />
      <rect x="36" y="12" width="16" height="16" rx="3" />
      <rect x="12" y="36" width="16" height="16" rx="3" />
      <rect x="36" y="36" width="16" height="16" rx="3" fill="currentColor" stroke="none" />
    </>
  ),
  ladder: (
    <>
      <path d="M20 8 V56 M44 8 V56" />
      <path d="M20 18 H44 M20 30 H44 M20 42 H44" />
    </>
  ),
  "ladder-up": (
    <>
      <path d="M18 56 V16 M38 56 V16 M18 26 H38 M18 38 H38 M18 50 H38" />
      <path d="M48 30 L54 22 L60 30 M54 22 V44" />
    </>
  ),
  "level-bars": (
    <>
      <rect x="10" y="40" width="10" height="14" rx="2" fill="currentColor" stroke="none" />
      <rect x="27" y="28" width="10" height="26" rx="2" fill="currentColor" stroke="none" />
      <rect x="44" y="14" width="10" height="40" rx="2" fill="currentColor" stroke="none" />
    </>
  ),
  "level-up": (
    <>
      <path d="M32 54 V18 M18 32 L32 18 L46 32" strokeWidth="5" />
      <path d="M14 56 H50" />
    </>
  ),
  "number-one": (
    <>
      <path d="M24 22 L34 12 V52 M22 52 H46" strokeWidth="6" />
    </>
  ),
  "top-ten": (
    <>
      <path d="M14 22 L20 16 V48 M12 48 H28" strokeWidth="5" />
      <ellipse cx="42" cy="32" rx="10" ry="16" strokeWidth="5" />
    </>
  ),
  podium: (
    <>
      <rect x="22" y="18" width="20" height="38" fill="currentColor" stroke="none" />
      <rect x="6" y="30" width="16" height="26" fill="currentColor" stroke="none" opacity="0.7" />
      <rect x="42" y="36" width="16" height="20" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M32 10 L34 14 L38 14 L35 17 L36 21 L32 19 L28 21 L29 17 L26 14 L30 14 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "podium-flag": (
    <>
      <rect x="22" y="26" width="20" height="30" fill="currentColor" stroke="none" />
      <rect x="6" y="36" width="16" height="20" fill="currentColor" stroke="none" opacity="0.7" />
      <rect x="42" y="42" width="16" height="14" fill="currentColor" stroke="none" opacity="0.55" />
      <path d="M32 26 V8 L46 12 L32 18" />
    </>
  ),
  laurel: (
    <>
      <path d="M32 54 C16 50 10 36 12 20 C22 22 30 32 32 54 Z" fill="currentColor" stroke="none" opacity="0.85" />
      <path d="M32 54 C48 50 54 36 52 20 C42 22 34 32 32 54 Z" fill="currentColor" stroke="none" opacity="0.85" />
      <path d="M32 22 V54" stroke="#000" strokeOpacity="0.35" />
    </>
  ),
  "trophy-case": (
    <>
      <rect x="8" y="10" width="48" height="44" rx="3" />
      <path d="M8 32 H56 M32 10 V54" opacity="0.6" />
      <path d="M17 20 h6 v5 c0 3 -3 5 -3 5 s-3 -2 -3 -5 Z" fill="currentColor" stroke="none" />
      <path d="M41 20 h6 v5 c0 3 -3 5 -3 5 s-3 -2 -3 -5 Z" fill="currentColor" stroke="none" />
      <path d="M17 42 h6 v5 c0 3 -3 5 -3 5 s-3 -2 -3 -5 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "team-trophy": (
    <>
      <path d="M22 12 H42 V24 C42 32 37 36 32 36 C27 36 22 32 22 24 Z" fill="currentColor" stroke="none" />
      <path d="M22 16 H14 C14 24 18 28 23 28 M42 16 H50 C50 24 46 28 41 28" />
      <path d="M32 36 V42" />
      <circle cx="20" cy="50" r="4" fill="currentColor" stroke="none" />
      <circle cx="32" cy="50" r="4" fill="currentColor" stroke="none" />
      <circle cx="44" cy="50" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  "grand-slam": (
    <>
      <path d="M20 10 H44 V22 C44 30 38 34 32 34 C26 34 20 30 20 22 Z" fill="currentColor" stroke="none" />
      <path d="M32 34 V40 M22 46 H42" />
      <path d="M10 52 L14 46 L18 52 M26 58 L30 52 L34 58 M46 52 L50 46 L54 52" strokeWidth="3" />
    </>
  ),
  "tournament-live": (
    <>
      <path d="M22 12 H42 V22 C42 30 37 34 32 34 C27 34 22 30 22 22 Z" />
      <path d="M32 34 V44 M22 50 H42" />
      <circle cx="50" cy="16" r="5" fill="currentColor" stroke="none" />
      <path d="M50 8 A8 8 0 0 1 58 16 M50 4 A12 12 0 0 1 62 16" strokeWidth="3" />
    </>
  ),
  host: (
    <>
      <path d="M12 26 L32 12 L52 26 V52 H12 Z" />
      <path d="M26 52 V38 H38 V52" />
      <path d="M32 12 V6" />
    </>
  ),
  spotlight: (
    <>
      <path d="M26 12 L10 52 H54 L38 12 Z" fill="currentColor" stroke="none" opacity="0.35" />
      <rect x="24" y="6" width="16" height="10" rx="3" fill="currentColor" stroke="none" />
      <path d="M12 56 H52" />
    </>
  ),
  metronome: (
    <>
      <path d="M22 10 H42 L52 54 H12 Z" />
      <path d="M32 44 L44 18" strokeWidth="4" />
      <circle cx="44" cy="18" r="3" fill="currentColor" stroke="none" />
      <path d="M22 54 H42" opacity="0.6" />
    </>
  ),
  hourglass: (
    <>
      <path d="M16 8 H48 V16 C48 24 36 28 36 32 C36 36 48 40 48 48 V56 H16 V48 C16 40 28 36 28 32 C28 28 16 24 16 16 Z" />
      <path d="M24 16 H40 L32 26 Z" fill="currentColor" stroke="none" />
      <path d="M22 52 H42 L32 40 Z" fill="currentColor" stroke="none" opacity="0.7" />
    </>
  ),
  sunrise: (
    <>
      <path d="M12 46 A20 20 0 0 1 52 46" fill="currentColor" stroke="none" opacity="0.85" />
      <path d="M32 8 V16 M12 18 L17 23 M52 18 L47 23 M6 46 H58" />
      <path d="M12 54 H52" opacity="0.5" />
    </>
  ),
  owl: (
    <>
      <path d="M18 14 L18 40 C18 50 24 56 32 56 C40 56 46 50 46 40 L46 14 L38 22 H26 Z" fill="currentColor" stroke="none" />
      <circle cx="26" cy="32" r="5" fill="#000" fillOpacity="0.55" stroke="none" />
      <circle cx="38" cy="32" r="5" fill="#000" fillOpacity="0.55" stroke="none" />
      <circle cx="26" cy="32" r="2" fill="#fff" fillOpacity="0.9" stroke="none" />
      <circle cx="38" cy="32" r="2" fill="#fff" fillOpacity="0.9" stroke="none" />
      <path d="M30 42 L32 46 L34 42 Z" fill="#000" fillOpacity="0.5" stroke="none" />
    </>
  ),
  eye: (
    <>
      <path d="M8 32 C16 20 48 20 56 32 C48 44 16 44 8 32 Z" />
      <circle cx="32" cy="32" r="7" fill="currentColor" stroke="none" />
      <circle cx="34" cy="30" r="2" fill="#000" fillOpacity="0.5" stroke="none" />
    </>
  ),
  record: (
    <>
      <circle cx="32" cy="32" r="22" />
      <circle cx="32" cy="32" r="14" opacity="0.5" />
      <circle cx="32" cy="32" r="5" fill="currentColor" stroke="none" />
    </>
  ),
};
