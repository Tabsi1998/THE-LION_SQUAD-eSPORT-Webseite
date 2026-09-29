// Motive „Community“, „Streaming & Creator“ und „Profil & Konto“ (E8, #618). Raster 64×64, currentColor.

export const PEOPLE = {
  "speech-bubble": (
    <>
      <path d="M10 12 H54 V40 H30 L18 50 V40 H10 Z" fill="currentColor" stroke="none" />
      <circle cx="24" cy="26" r="3" fill="#000" fillOpacity="0.5" stroke="none" />
      <circle cx="32" cy="26" r="3" fill="#000" fillOpacity="0.5" stroke="none" />
      <circle cx="40" cy="26" r="3" fill="#000" fillOpacity="0.5" stroke="none" />
    </>
  ),
  "speech-bubbles": (
    <>
      <path d="M8 12 H40 V32 H22 L14 40 V32 H8 Z" fill="currentColor" stroke="none" />
      <path d="M44 24 H56 V44 H52 V52 L44 44 H30 V36" />
    </>
  ),
  "speech-wave": (
    <>
      <path d="M8 14 H42 V36 H26 L16 44 V36 H8 Z" />
      <path d="M16 25 C20 20 24 30 28 25 S36 20 36 25" strokeWidth="3.5" />
      <path d="M48 20 A10 10 0 0 1 48 36 M52 14 A16 16 0 0 1 52 42" strokeWidth="3" />
    </>
  ),
  "thumbs-up": (
    <>
      <path d="M8 30 H18 V54 H8 Z" fill="currentColor" stroke="none" />
      <path d="M18 32 L28 12 C32 12 34 16 32 22 L30 30 H48 C52 30 54 34 52 38 L48 52 C47 54 45 54 43 54 H18" fill="currentColor" stroke="none" />
    </>
  ),
  heart: (
    <>
      <path d="M32 54 C16 42 8 34 8 24 C8 16 14 10 21 10 C26 10 30 13 32 17 C34 13 38 10 43 10 C50 10 56 16 56 24 C56 34 48 42 32 54 Z" fill="currentColor" stroke="none" />
      <path d="M18 20 C18 16 20 14 23 14" stroke="#fff" strokeOpacity="0.5" strokeWidth="3" />
    </>
  ),
  handshake: (
    <>
      <path d="M6 28 L18 20 L30 28 L38 22 L52 22 L58 30" />
      <path d="M22 30 L30 38 C32 40 36 40 38 38 L46 30" strokeWidth="4.5" />
      <path d="M12 34 L24 46 M48 32 L40 42" />
    </>
  ),
  "helping-hand": (
    <>
      <path d="M12 40 C12 30 16 24 20 20 C22 26 24 30 26 30 L26 14 C26 10 32 10 32 14 V26 L34 12 C34 8 40 8 40 12 V28 L42 16 C42 12 48 12 48 16 V30 L50 24 C50 20 56 20 56 24 V40 C56 50 48 56 36 56 C24 56 12 50 12 40 Z" fill="currentColor" stroke="none" />
    </>
  ),
  mentor: (
    <>
      <circle cx="40" cy="18" r="7" fill="currentColor" stroke="none" />
      <path d="M26 56 C26 42 32 36 40 36 C48 36 54 42 54 56 Z" fill="currentColor" stroke="none" />
      <circle cx="16" cy="32" r="5" fill="currentColor" stroke="none" opacity="0.8" />
      <path d="M6 56 C6 46 10 42 16 42 C20 42 22 44 24 46" fill="currentColor" stroke="none" opacity="0.8" />
      <path d="M22 26 L34 28" strokeWidth="3" opacity="0.6" />
    </>
  ),
  gift: (
    <>
      <rect x="10" y="26" width="44" height="30" rx="3" fill="currentColor" stroke="none" />
      <rect x="8" y="18" width="48" height="10" rx="2" fill="currentColor" stroke="none" opacity="0.8" />
      <path d="M32 18 V56" stroke="#000" strokeOpacity="0.45" />
      <path d="M32 18 C24 18 20 12 24 8 C28 6 32 12 32 18 C32 12 36 6 40 8 C44 12 40 18 32 18 Z" />
    </>
  ),
  sticker: (
    <>
      <path d="M12 12 H52 V38 L38 52 H12 Z" fill="currentColor" stroke="none" />
      <path d="M52 38 L38 38 L38 52" stroke="#000" strokeOpacity="0.5" fill="#000" fillOpacity="0.25" />
      <circle cx="24" cy="26" r="3" fill="#000" fillOpacity="0.5" stroke="none" />
      <circle cx="36" cy="26" r="3" fill="#000" fillOpacity="0.5" stroke="none" />
      <path d="M22 34 C26 38 34 38 38 34" stroke="#000" strokeOpacity="0.5" />
    </>
  ),
  camera: (
    <>
      <path d="M8 20 H20 L24 14 H40 L44 20 H56 V50 H8 Z" fill="currentColor" stroke="none" />
      <circle cx="32" cy="34" r="9" fill="#000" fillOpacity="0.5" stroke="none" />
      <circle cx="32" cy="34" r="4" fill="currentColor" stroke="none" />
      <circle cx="49" cy="26" r="2" fill="#000" fillOpacity="0.5" stroke="none" />
    </>
  ),
  portrait: (
    <>
      <rect x="12" y="8" width="40" height="48" rx="3" />
      <circle cx="32" cy="26" r="8" fill="currentColor" stroke="none" />
      <path d="M18 50 C18 40 24 36 32 36 C40 36 46 40 46 50 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "profile-card": (
    <>
      <rect x="8" y="14" width="48" height="36" rx="4" />
      <circle cx="22" cy="28" r="6" fill="currentColor" stroke="none" />
      <path d="M12 44 C12 38 16 36 22 36 C28 36 32 38 32 44" fill="currentColor" stroke="none" />
      <path d="M36 26 H50 M36 34 H48 M36 42 H44" />
    </>
  ),
  "business-card": (
    <>
      <rect x="8" y="16" width="48" height="32" rx="3" />
      <path d="M14 26 H30 M14 34 H26 M14 42 H22" />
      <rect x="38" y="26" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </>
  ),
  "member-card": (
    <>
      <rect x="8" y="14" width="48" height="36" rx="4" fill="currentColor" stroke="none" />
      <rect x="14" y="22" width="12" height="9" rx="1.5" fill="#000" fillOpacity="0.45" stroke="none" />
      <path d="M32 24 H50 M32 31 H46 M14 40 H50" stroke="#000" strokeOpacity="0.45" />
    </>
  ),
  "membership-card": (
    <>
      <rect x="8" y="14" width="48" height="36" rx="4" />
      <path d="M8 24 H56" />
      <path d="M14 34 H30 M14 42 H24" />
      <path d="M40 32 L44 36 L52 28" strokeWidth="3.5" />
    </>
  ),
  envelope: (
    <>
      <rect x="8" y="16" width="48" height="32" rx="3" fill="currentColor" stroke="none" />
      <path d="M8 18 L32 36 L56 18" stroke="#000" strokeOpacity="0.5" fill="none" />
    </>
  ),
  "letter-seal": (
    <>
      <rect x="8" y="14" width="48" height="34" rx="3" />
      <path d="M8 16 L32 34 L56 16" />
      <circle cx="32" cy="44" r="8" fill="currentColor" stroke="none" />
      <path d="M28 44 L31 47 L37 41" stroke="#000" strokeOpacity="0.55" strokeWidth="3" />
    </>
  ),
  newspaper: (
    <>
      <path d="M12 10 H56 V48 C56 52 53 54 50 54 H14 C10 54 8 52 8 48 V20 H12 Z" />
      <rect x="18" y="16" width="14" height="12" fill="currentColor" stroke="none" />
      <path d="M36 18 H50 M36 26 H50 M18 34 H50 M18 42 H44" strokeWidth="3" />
    </>
  ),
  phone: (
    <>
      <rect x="18" y="6" width="28" height="52" rx="6" />
      <path d="M28 12 H36" strokeWidth="3" />
      <circle cx="32" cy="50" r="2.5" fill="currentColor" stroke="none" />
      <path d="M26 24 L30 28 L38 20" strokeWidth="3.5" />
    </>
  ),
  passkey: (
    <>
      <circle cx="24" cy="22" r="10" />
      <path d="M8 54 C8 42 14 38 24 38 C28 38 31 39 33 40" />
      <circle cx="46" cy="34" r="7" fill="currentColor" stroke="none" />
      <path d="M46 41 V56 M46 50 H52 M46 56 H50" strokeWidth="4.5" />
    </>
  ),
  privacy: (
    <>
      <path d="M32 6 L52 14 V30 C52 44 44 52 32 58 C20 52 12 44 12 30 V14 Z" fill="currentColor" stroke="none" />
      <rect x="24" y="30" width="16" height="12" rx="2" fill="#000" fillOpacity="0.5" stroke="none" />
      <path d="M27 30 V26 A5 5 0 0 1 37 26 V30" stroke="#000" strokeOpacity="0.5" fill="none" strokeWidth="3" />
    </>
  ),
  verified: (
    <>
      <path d="M32 6 L38 12 L46 10 L48 18 L56 22 L52 30 L56 38 L48 42 L46 50 L38 48 L32 54 L26 48 L18 50 L16 42 L8 38 L12 30 L8 22 L16 18 L18 10 L26 12 Z" fill="currentColor" stroke="none" />
      <path d="M22 31 L29 38 L43 24" stroke="#000" strokeOpacity="0.55" strokeWidth="5" />
    </>
  ),
  "verified-stream": (
    <>
      <rect x="8" y="14" width="48" height="32" rx="4" />
      <path d="M22 52 H42 M32 46 V52" />
      <path d="M22 30 L29 37 L42 22" strokeWidth="5" />
    </>
  ),
  "on-air": (
    <>
      <rect x="8" y="18" width="48" height="28" rx="6" />
      <circle cx="20" cy="32" r="5" fill="currentColor" stroke="none" />
      <path d="M30 26 H48 M30 32 H44 M30 38 H40" strokeWidth="3" />
      <path d="M20 18 V10 M14 10 H26" strokeWidth="3" />
    </>
  ),
  "broadcast-clock": (
    <>
      <circle cx="28" cy="34" r="18" />
      <path d="M28 24 V34 L35 38" strokeWidth="4.5" />
      <path d="M48 20 A12 12 0 0 1 48 38 M54 14 A20 20 0 0 1 54 44" strokeWidth="3" />
    </>
  ),
  clip: (
    <>
      <path d="M10 22 H42 V46 H10 Z" fill="currentColor" stroke="none" />
      <path d="M42 30 L54 22 V46 L42 38" fill="currentColor" stroke="none" opacity="0.8" />
      <path d="M8 14 L18 20 M22 10 L26 20" strokeWidth="3" />
    </>
  ),
  twitch: (
    <>
      <path d="M14 8 L10 18 V50 H22 V58 L30 50 H40 L54 36 V8 Z" fill="currentColor" stroke="none" />
      <path d="M28 20 V32 M40 20 V32" stroke="#000" strokeOpacity="0.55" strokeWidth="5" />
    </>
  ),
  youtube: (
    <>
      <rect x="8" y="16" width="48" height="32" rx="10" fill="currentColor" stroke="none" />
      <path d="M27 24 L40 32 L27 40 Z" fill="#000" fillOpacity="0.55" stroke="none" />
    </>
  ),
  tiktok: (
    <>
      <path d="M32 8 V40 A8 8 0 1 1 24 32" strokeWidth="6" />
      <path d="M32 8 C32 16 38 22 46 22" strokeWidth="6" />
    </>
  ),
  discord: (
    <>
      <path d="M18 14 C22 12 26 11 32 11 C38 11 42 12 46 14 C52 24 54 34 52 44 C48 48 42 50 40 50 L38 46 C42 45 44 44 46 42 C38 46 26 46 18 42 C20 44 22 45 26 46 L24 50 C22 50 16 48 12 44 C10 34 12 24 18 14 Z" fill="currentColor" stroke="none" />
      <circle cx="25" cy="32" r="4" fill="#000" fillOpacity="0.55" stroke="none" />
      <circle cx="39" cy="32" r="4" fill="#000" fillOpacity="0.55" stroke="none" />
    </>
  ),
  platforms: (
    <>
      <rect x="8" y="12" width="26" height="20" rx="3" />
      <rect x="38" y="12" width="18" height="20" rx="3" fill="currentColor" stroke="none" />
      <rect x="8" y="36" width="18" height="18" rx="3" fill="currentColor" stroke="none" opacity="0.8" />
      <rect x="30" y="36" width="26" height="18" rx="3" />
    </>
  ),
  gamepad: (
    <>
      <path d="M18 20 H46 C54 20 58 30 56 40 C54 48 48 50 44 44 L40 40 H24 L20 44 C16 50 10 48 8 40 C6 30 10 20 18 20 Z" fill="currentColor" stroke="none" />
      <path d="M20 26 V36 M15 31 H25" stroke="#000" strokeOpacity="0.55" strokeWidth="3.5" />
      <circle cx="44" cy="28" r="2.5" fill="#000" fillOpacity="0.55" stroke="none" />
      <circle cx="49" cy="33" r="2.5" fill="#000" fillOpacity="0.55" stroke="none" />
    </>
  ),
  star: (
    <>
      <path d="M32 8 L38 24 L56 25 L42 36 L47 54 L32 44 L17 54 L22 36 L8 25 L26 24 Z" fill="currentColor" stroke="none" />
    </>
  ),
  "prestige-star": (
    <>
      <path d="M32 8 L38 24 L56 25 L42 36 L47 54 L32 44 L17 54 L22 36 L8 25 L26 24 Z" fill="currentColor" stroke="none" />
      <circle cx="32" cy="32" r="7" fill="#000" fillOpacity="0.45" stroke="none" />
      <path d="M8 10 L10 14 L14 16 L10 18 L8 22 L6 18 L2 16 L6 14 Z" fill="currentColor" stroke="none" opacity="0.7" />
      <path d="M56 46 L58 50 L62 52 L58 54 L56 58 L54 54 L50 52 L54 50 Z" fill="currentColor" stroke="none" opacity="0.7" />
    </>
  ),
  flame: (
    <>
      <path d="M34 6 C36 18 46 22 46 36 C46 46 40 56 32 56 C24 56 18 48 18 38 C18 30 22 26 26 22 C26 28 30 30 32 28 C32 20 30 12 34 6 Z" fill="currentColor" stroke="none" />
      <path d="M32 56 C27 50 26 44 30 38 C36 44 37 50 32 56 Z" fill="#000" fillOpacity="0.4" stroke="none" />
    </>
  ),
  reset: (
    <>
      <path d="M50 32 A18 18 0 1 1 40 16" strokeWidth="5" />
      <path d="M40 8 V18 H50" strokeWidth="4.5" />
    </>
  ),
  door: (
    <>
      <rect x="18" y="8" width="28" height="48" rx="2" fill="currentColor" stroke="none" />
      <path d="M12 56 H52" />
      <circle cx="40" cy="32" r="2.5" fill="#000" fillOpacity="0.55" stroke="none" />
    </>
  ),
  bell: (
    <>
      <path d="M18 40 V28 C18 20 24 14 32 14 C40 14 46 20 46 28 V40 L52 46 H12 Z" fill="currentColor" stroke="none" />
      <path d="M26 50 A6 6 0 0 0 38 50" strokeWidth="4" />
      <path d="M32 8 V14" />
    </>
  ),
  volunteer: (
    <>
      <path d="M32 50 C18 40 12 34 12 26 C12 20 16 16 21 16 C25 16 29 18 32 22 C35 18 39 16 43 16 C48 16 52 20 52 26 C52 34 46 40 32 50 Z" fill="currentColor" stroke="none" />
      <path d="M22 54 C26 50 38 50 42 54" />
      <path d="M32 22 V40" stroke="#000" strokeOpacity="0.35" strokeWidth="3" />
    </>
  ),
  sponsor: (
    <>
      <path d="M10 26 L32 12 L54 26 V52 H10 Z" />
      <path d="M22 52 V36 H42 V52" fill="currentColor" stroke="none" />
      <path d="M26 22 H38" strokeWidth="3" />
    </>
  ),
  "club-house": (
    <>
      <path d="M8 30 L32 10 L56 30" />
      <path d="M14 28 V54 H50 V28" />
      <path d="M26 54 V40 H38 V54" fill="currentColor" stroke="none" />
      <path d="M32 10 V4 L42 7 L32 10" fill="currentColor" stroke="none" />
    </>
  ),
  "founding-flag": (
    <>
      <path d="M16 58 V8" strokeWidth="5" />
      <path d="M16 10 H50 V34 H16 Z" fill="currentColor" stroke="none" />
      <path d="M26 16 L28 22 L34 22 L29 25 L31 31 L26 27 L21 31 L23 25 L18 22 L24 22 Z" fill="#000" fillOpacity="0.5" stroke="none" transform="translate(7 0)" />
    </>
  ),
  anniversary: (
    <>
      <path d="M12 24 L32 10 L52 24 V52 H12 Z" />
      <path d="M32 30 L35 36 L42 37 L37 42 L38 49 L32 46 L26 49 L27 42 L22 37 L29 36 Z" fill="currentColor" stroke="none" />
      <path d="M22 8 L24 4 M42 8 L40 4" />
    </>
  ),
  birthday: (
    <>
      <path d="M12 30 H52 V54 H12 Z" fill="currentColor" stroke="none" />
      <path d="M12 38 C18 34 24 42 32 38 C40 34 46 42 52 38" stroke="#000" strokeOpacity="0.45" />
      <path d="M32 30 V18" />
      <path d="M32 18 C29 14 30 10 32 8 C34 10 35 14 32 18 Z" fill="currentColor" stroke="none" />
    </>
  ),
  // Saison-Fundstücke (#678): Fledermaus mit Echo, Kescher mit Schneeflocke, Glas mit Fundstücken.
  bat: (
    <>
      <path d="M32 23 L27 14 L26 24 C18 17 10 18 5 22 C10 25 13 29 14 33 C17 30 21 31 23 36 C26 33 30 36 32 44 C34 36 38 33 41 36 C43 31 47 30 50 33 C51 29 54 25 59 22 C54 18 46 17 38 24 L37 14 Z" fill="currentColor" stroke="none" />
      <circle cx="29.4" cy="28.5" r="1.4" fill="#000" fillOpacity="0.6" stroke="none" />
      <circle cx="34.6" cy="28.5" r="1.4" fill="#000" fillOpacity="0.6" stroke="none" />
      <path d="M25 50 C29 53 35 53 39 50" strokeWidth="3" opacity="0.7" />
      <path d="M21 56 C28 61 36 61 43 56" strokeWidth="3" opacity="0.4" />
    </>
  ),
  "snow-catch": (
    <>
      <path d="M26 4 V18 M19.9 7.5 L32.1 14.5 M32.1 7.5 L19.9 14.5" strokeWidth="3" />
      <path d="M10 28 C11 44 20 56 26 56 C32 56 41 44 42 28" />
      <path d="M18 33 L22 52 M26 34 V56 M34 33 L30 52" strokeWidth="2" opacity="0.5" />
      <ellipse cx="26" cy="28" rx="16" ry="5.5" />
      <path d="M42 28 L58 42" strokeWidth="5" />
    </>
  ),
  "season-collector": (
    <>
      <path d="M16 12 H48 V21 H16 Z" fill="currentColor" stroke="none" />
      <path d="M19 21 V50 C19 54 22 57 26 57 H38 C42 57 45 54 45 50 V21" />
      <path d="M27 29 V39 M22.7 31.5 L31.3 36.5 M31.3 31.5 L22.7 36.5" strokeWidth="2.5" />
      <ellipse cx="38" cy="45" rx="3.6" ry="4.8" fill="currentColor" stroke="none" />
      <circle cx="27.5" cy="48.5" r="3.4" fill="currentColor" stroke="none" opacity="0.7" />
      <path d="M35 31 L37 28 L39 31 L41 28 L43 31" strokeWidth="2.5" />
    </>
  ),
};
