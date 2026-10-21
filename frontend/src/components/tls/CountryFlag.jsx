import { countryName, flagRatio, flagSrc } from "@/lib/countryFlags";
import "./countryFlag.css";

// Flagge je Termin und Rennen (#1925): Datei aus public/assets/flags (gemeinfrei, siehe README dort), Alternativtext =
// Landesname. Fester Kasten, damit beim Laden nichts springt: gleiche Höhe je Größe, Breite nach dem echten
// Seitenverhältnis der Flagge bis höchstens 2:1 (breitere wie Katar passen sich ein). Ohne bekanntes Land gibt es nichts.

const HEIGHTS = { xs: 10, sm: 12, md: 14, lg: 16 };
const MAX_RATIO = 2;

export function CountryFlag({ code, size = "md", className = "" }) {
  const src = flagSrc(code);
  if (!src) return null;
  const height = HEIGHTS[size] || HEIGHTS.md;
  const width = Math.round(height * Math.min(flagRatio(code), MAX_RATIO));
  const name = countryName(code);
  return (
    <img
      src={src}
      alt={name}
      title={name}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={`tls-flag ${className}`}
      data-testid="country-flag"
      data-country={String(code).toUpperCase()}
    />
  );
}

/** Titel und Ort eines Termins mit Flagge davor; ohne beides steht der Landesname neben der Flagge. */
export function VenueWithFlag({ round, size = "sm", className = "" }) {
  const text = [round?.title, round?.venue].filter(Boolean).join(" · ") || countryName(round?.country_code);
  if (!text) return null;
  return (
    <span className={`tls-flag-line ${className}`}>
      <CountryFlag code={round?.country_code} size={size} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{text}</span>
    </span>
  );
}
