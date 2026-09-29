// Motive „Verein“, „Besonders“, „Geheim“ und „Negativ“ (E8, #618). Raster 64×64, currentColor.

const LION_HEAD = (
  <>
    <path d="M32 8 C22 8 14 16 14 26 C14 30 16 34 16 38 C16 48 22 56 32 56 C42 56 48 48 48 38 C48 34 50 30 50 26 C50 16 42 8 32 8 Z" fill="currentColor" stroke="none" />
    <path d="M22 22 C20 18 24 14 27 17 M42 22 C44 18 40 14 37 17" stroke="#000" strokeOpacity="0.45" strokeWidth="3" />
    <circle cx="26" cy="30" r="3" fill="#000" fillOpacity="0.6" stroke="none" />
    <circle cx="38" cy="30" r="3" fill="#000" fillOpacity="0.6" stroke="none" />
    <path d="M32 36 L28 40 H36 Z" fill="#000" fillOpacity="0.55" stroke="none" />
    <path d="M28 44 C30 47 34 47 36 44" stroke="#000" strokeOpacity="0.55" strokeWidth="3" />
  </>
);

export const CLUB = {
  "honor-lion": (
    <>
      {LION_HEAD}
      <path d="M10 14 L14 20 M54 14 L50 20 M8 30 H12 M52 30 H56" opacity="0.6" />
    </>
  ),
  "iron-lion": (
    <>
      {LION_HEAD}
      <path d="M20 10 L44 10 M16 52 L48 52" stroke="#000" strokeOpacity="0.5" strokeWidth="3" />
    </>
  ),
  "lion-tamer": (
    <>
      {LION_HEAD}
      <circle cx="32" cy="32" r="26" fill="none" opacity="0.6" />
    </>
  ),
  "gamers-heaven": (
    <>
      <path d="M10 42 C10 34 16 28 24 30 C26 22 34 18 40 22 C46 18 54 24 52 32 C58 34 58 44 50 44 H16 C12 44 10 44 10 42 Z" fill="currentColor" stroke="none" />
      <path d="M26 38 H38 M32 34 V42" stroke="#000" strokeOpacity="0.5" strokeWidth="3" />
      <path d="M16 52 H48" opacity="0.5" />
    </>
  ),
  "lan-founder": (
    <>
      <rect x="8" y="14" width="20" height="14" rx="2" fill="currentColor" stroke="none" />
      <rect x="36" y="14" width="20" height="14" rx="2" fill="currentColor" stroke="none" />
      <rect x="22" y="40" width="20" height="14" rx="2" fill="currentColor" stroke="none" />
      <path d="M18 28 V34 H46 V28 M32 34 V40" />
    </>
  ),
  beta: (
    <>
      <path d="M22 56 V14 C22 8 28 6 32 8 C40 10 40 20 32 24 C42 26 44 40 32 42 H22" strokeWidth="5" />
      <path d="M46 14 L50 10 M50 20 H56" opacity="0.6" />
    </>
  ),
  "hall-of-fame": (
    <>
      <path d="M10 22 L32 8 L54 22" />
      <path d="M14 22 V52 M26 22 V52 M38 22 V52 M50 22 V52" />
      <path d="M8 52 H56" strokeWidth="5" />
      <circle cx="32" cy="16" r="2.5" fill="currentColor" stroke="none" />
    </>
  ),
  mvp: (
    <>
      <path d="M8 44 V18 L18 30 L28 18 V44" strokeWidth="5" />
      <path d="M34 18 L42 44 L50 18" strokeWidth="5" />
      <path d="M12 54 H52" />
    </>
  ),
  pioneer: (
    <>
      <path d="M32 6 L36 20 L50 22 L40 32 L42 46 L32 40 L22 46 L24 32 L14 22 L28 20 Z" fill="currentColor" stroke="none" />
      <path d="M10 56 C18 50 46 50 54 56" />
      <path d="M32 40 V50" />
    </>
  ),
  advent: (
    <>
      <circle cx="32" cy="36" r="20" strokeWidth="6" />
      <path d="M22 16 V8 M32 14 V6 M42 16 V8" strokeWidth="4" />
      <path d="M22 8 C20 5 21 3 22 2 C23 3 24 5 22 8 Z M32 6 C30 3 31 1 32 0 C33 1 34 3 32 6 Z M42 8 C40 5 41 3 42 2 C43 3 44 5 42 8 Z" fill="currentColor" stroke="none" />
      <circle cx="18" cy="46" r="3" fill="currentColor" stroke="none" />
      <circle cx="46" cy="46" r="3" fill="currentColor" stroke="none" />
    </>
  ),
  fireworks: (
    <>
      <path d="M32 20 V6 M32 20 L42 10 M32 20 L22 10 M32 20 L46 20 M32 20 L18 20 M32 20 L42 30 M32 20 L22 30" strokeWidth="3.5" />
      <circle cx="32" cy="20" r="3" fill="currentColor" stroke="none" />
      <path d="M32 26 C30 40 26 48 20 56" strokeWidth="3" strokeDasharray="3 4" />
      <path d="M50 44 L52 48 L56 50 L52 52 L50 56 L48 52 L44 50 L48 48 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "pumpkin-night": (
    <>
      <path d="M32 18 C40 18 46 22 48 30 C52 32 54 40 50 48 C46 54 38 56 32 56 C26 56 18 54 14 48 C10 40 12 32 16 30 C18 22 24 18 32 18 Z" fill="currentColor" stroke="none" />
      <path d="M32 18 C32 12 34 10 38 8" strokeWidth="4" />
      <path d="M22 34 L28 30 L28 38 Z M42 34 L36 30 L36 38 Z" fill="#000" fillOpacity="0.6" stroke="none" />
      <path d="M22 44 L26 48 L30 44 L34 48 L38 44 L42 48" stroke="#000" strokeOpacity="0.6" strokeWidth="3" fill="none" />
    </>
  ),
  "full-moon": (
    <>
      <circle cx="32" cy="32" r="20" fill="currentColor" stroke="none" />
      <circle cx="24" cy="26" r="4" fill="#000" fillOpacity="0.3" stroke="none" />
      <circle cx="38" cy="38" r="6" fill="#000" fillOpacity="0.3" stroke="none" />
      <circle cx="40" cy="22" r="2.5" fill="#000" fillOpacity="0.3" stroke="none" />
    </>
  ),
  "witching-hour": (
    <>
      <circle cx="32" cy="34" r="20" />
      <path d="M32 22 V34 L32 34" strokeWidth="4.5" />
      <path d="M32 34 L32 20" strokeWidth="4.5" />
      <path d="M32 34 L33 20" strokeWidth="3" opacity="0.6" />
      <circle cx="32" cy="34" r="2.5" fill="currentColor" stroke="none" />
      <path d="M12 8 L14 12 L18 13 L14 14 L12 18 L10 14 L6 13 L10 12 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "night-shift": (
    <>
      <path d="M40 10 C28 12 20 22 22 34 C24 46 36 54 48 50 C38 56 22 54 14 42 C8 30 16 14 30 10 C34 9 37 9 40 10 Z" fill="currentColor" stroke="none" />
      <path d="M46 16 L48 20 L52 21 L48 22 L46 26 L44 22 L40 21 L44 20 Z" fill="currentColor" stroke="none" />
      <circle cx="54" cy="34" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  konami: (
    <>
      <path d="M32 8 L38 16 H26 Z M32 30 L26 22 H38 Z" fill="currentColor" stroke="none" />
      <path d="M10 42 L18 36 V48 Z M54 42 L46 36 V48 Z" fill="currentColor" stroke="none" />
      <circle cx="26" cy="54" r="4" fill="currentColor" stroke="none" />
      <circle cx="38" cy="54" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  lost: (
    <>
      <path d="M8 50 C16 30 26 30 32 40 C38 50 48 50 56 30" strokeDasharray="5 5" />
      <circle cx="8" cy="50" r="3" fill="currentColor" stroke="none" />
      <path d="M52 12 L56 16 L52 20 M48 10 A8 8 0 1 1 48 26" strokeWidth="3.5" />
    </>
  ),
  echo: (
    <>
      <path d="M24 26 A8 8 0 0 1 24 38 M30 20 A16 16 0 0 1 30 44 M36 14 A24 24 0 0 1 36 50" strokeWidth="4" />
      <circle cx="18" cy="32" r="4" fill="currentColor" stroke="none" />
    </>
  ),
  palindrome: (
    <>
      <path d="M12 44 V20 H24 C30 20 30 32 24 32 H12" strokeWidth="5" />
      <path d="M52 44 V20 H40 C34 20 34 32 40 32 H52" strokeWidth="5" />
      <path d="M32 14 V50" strokeDasharray="4 4" opacity="0.6" />
    </>
  ),
  secret: (
    <>
      <path d="M32 6 C40 6 46 12 46 20 C46 26 42 28 38 32 C36 34 36 36 36 40 H28 C28 34 30 32 34 28 C36 26 38 24 38 20 C38 16 35 14 32 14 C29 14 26 16 26 20 H18 C18 12 24 6 32 6 Z" fill="currentColor" stroke="none" />
      <circle cx="32" cy="50" r="5" fill="currentColor" stroke="none" />
    </>
  ),
  "leap-day": (
    <>
      <rect x="10" y="14" width="44" height="40" rx="4" />
      <path d="M10 26 H54 M20 8 V18 M44 8 V18" />
      <path d="M22 44 V34 C22 30 30 30 30 34 C30 38 22 40 22 44 H30" strokeWidth="3.5" />
      <path d="M36 32 L40 30 V44 M36 44 H44" strokeWidth="3.5" />
    </>
  ),
  "snow-king": (
    <>
      <path d="M32 8 V56 M14 20 L50 44 M50 20 L14 44" strokeWidth="4" />
      <path d="M26 12 L32 18 L38 12 M26 52 L32 46 L38 52 M12 26 L18 28 L16 22 M52 26 L46 28 L48 22 M12 38 L18 36 L16 42 M52 38 L46 36 L48 42" strokeWidth="3" />
    </>
  ),
  "first-egg": (
    <>
      <path d="M32 6 C42 6 50 20 50 34 C50 46 42 56 32 56 C22 56 14 46 14 34 C14 20 22 6 32 6 Z" fill="currentColor" stroke="none" />
      <path d="M18 30 C24 26 30 34 36 30 S46 26 48 30" stroke="#000" strokeOpacity="0.45" />
      <path d="M20 42 C26 38 30 46 36 42 S44 38 46 42" stroke="#000" strokeOpacity="0.45" />
    </>
  ),
  negative: (
    <>
      <path d="M32 8 L58 54 H6 Z" fill="currentColor" stroke="none" />
      <path d="M32 24 V38" stroke="#000" strokeOpacity="0.6" strokeWidth="5" />
      <circle cx="32" cy="46" r="3" fill="#000" fillOpacity="0.6" stroke="none" />
    </>
  ),
};
