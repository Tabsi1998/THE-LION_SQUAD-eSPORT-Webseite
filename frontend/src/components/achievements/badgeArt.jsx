import { PLAY } from "./motifs/play";
import { RACING } from "./motifs/racing";
import { PEOPLE } from "./motifs/people";
import { CLUB } from "./motifs/club";

// Erfolge II (E8, #618): die Abzeichen-Kunst - je Gruppe ein Motiv (Schlüssel „art“ aus den Katalogen
// A–D), gezeichnet auf einem 64×64-Raster in currentColor, damit es in jedem Material funktioniert.
// Ein Schlüssel ohne eigenes Motiv bekommt einen Verwandten (ALIASES); erst danach fällt das Abzeichen
// auf das Lucide-Symbol der Gruppe zurück.

export const MOTIFS = Object.freeze({ ...PLAY, ...RACING, ...PEOPLE, ...CLUB });

// Alte Stufen tragen als „art“ noch Lucide-Namen; die landen bei einem passenden Motiv.
export const ALIASES = Object.freeze({
  "": "negative",
  "alarm-clock": "alarm",
  "alert-octagon": "negative",
  "alert-triangle": "negative",
  "battery-low": "negative",
  "book-open": "newspaper",
  cable: "platforms",
  car: "helmet",
  "cloud-off": "negative",
  cookie: "sticker",
  crosshair: "target",
  "door-open": "door",
  download: "clip",
  "download-cloud": "clip",
  "eye-off": "secret",
  frown: "negative",
  "gamepad-2": "gamepad",
  ghost: "pumpkin-night",
  "image-off": "negative",
  keyboard: "konami",
  "map-off": "lost",
  "message-square": "speech-bubble",
  "messages-square": "speech-bubbles",
  "message-circle": "speech-bubble",
  "monitor-x": "negative",
  "user-x": "negative",
  "users-x": "negative",
  "x-circle": "negative",
  "x-octagon": "negative",
  ban: "negative",
  snail: "negative",
  "zap-off": "negative",
  trophy: "champion",
  medal: "laurel",
  swords: "crossed-swords",
  flag: "checkered-flag",
  users: "group",
  "users-round": "group",
  "user-check": "verified",
  "user-plus": "mentor",
  radio: "on-air",
  broadcast: "on-air",
  timer: "stopwatch",
  zap: "lightning",
  sparkles: "spark",
  award: "laurel",
  badge: "emblem",
  "badge-plus": "emblem",
  "badge-alert": "negative",
  "calendar-check": "calendar",
  "calendar-plus": "calendar",
  "calendar-days": "calendar",
  "check-check": "checkmark",
  "graduation-cap": "mentor",
  "hand-heart": "volunteer",
  "hand-helping": "helping-hand",
  "heart-handshake": "handshake",
  "id-card": "member-card",
  layers: "level-bars",
  moon: "night-shift",
  sun: "sunrise",
  rocket: "level-up",
  "rotate-ccw": "reset",
  server: "lan-founder",
  film: "clip",
  video: "camera",
  tv: "on-air",
  clapperboard: "clip",
  cpu: "lan-founder",
  "trending-up": "level-up",
  flask: "beta",
  wrench: "beta",
  network: "platforms",
  "thermometer-snowflake": "snow-king",
  "git-branch": "ladder-up",
  dumbbell: "giant",
  circle: "record",
  "volume-x": "negative",
  "message-square-warning": "negative",
  "mic-off": "negative",
  "wifi-off": "negative",
  "map-pin-off": "lost",
  megaphone: "speech-wave",
});

export const BADGE_ART_KEYS = Object.freeze(Object.keys(MOTIFS));

export function resolveArt(key) {
  const wanted = String(key || "").trim();
  if (MOTIFS[wanted]) return wanted;
  const alias = ALIASES[wanted];
  return alias && MOTIFS[alias] ? alias : null;
}

export function hasMotif(key) {
  return resolveArt(key) !== null;
}

export function Motif({ art, x = 0, y = 0, size = 64, className = "", ...rest }) {
  const key = resolveArt(art);
  if (!key) return null;
  const scale = size / 64;
  return (
    <g
      className={className}
      data-motif={key}
      transform={`translate(${x} ${y}) scale(${scale})`}
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {MOTIFS[key]}
    </g>
  );
}
