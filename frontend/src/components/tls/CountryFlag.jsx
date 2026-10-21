import { countryName, flagSrc } from "@/lib/countryFlags";
import "./countryFlag.css";

// Flagge je Termin und Rennen (#1925): eigene SVG-Datei (public/assets/flags), Alternativtext = Landesname. Feste
// Breite und Höhe im Seitenverhältnis 4:3, damit beim Laden nichts springt. Ohne bekanntes Land gibt es nichts.

const SIZES = { xs: [14, 10.5], sm: [16, 12], md: [20, 15], lg: [24, 18] };

export function CountryFlag({ code, size = "md", className = "" }) {
  const src = flagSrc(code);
  if (!src) return null;
  const [width, height] = SIZES[size] || SIZES.md;
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
