import { MascotBadge } from "@/components/tls/Logo";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { SmartLogo } from "@/components/tls/SmartLogo";
import { SponsorGrid } from "@/components/tls/SponsorTicker";
import { resolveMediaUrl } from "@/lib/api";
import { initials } from "@/lib/slotSource";
import { TvSeasonDeco } from "./TvSeasonDeco";
import { useTv } from "./TvScreen";

// Gemeinsame Teile der TV-Seiten (#1110, #1111): Kopfleiste mit Jahreszeiten-Deko, Fußleiste mit QR-Code und
// Sponsoren, Schilder. Alle Größen kommen aus tv.css - keine Pixel-Stufen mehr. Meilenstein 60: Das Laufband unten ist
// eine der drei Sponsoren-Einstellungen (#1125, Standard aus); Spieler ohne Bild bekommen ein Kürzel in einer Farbe,
// die zu ihrem Namen gehört (wie in der TV-Vorschau) - so findet man sich auf Tafel, Check-in und Rangliste wieder.

/** Eine ruhige Farbe je Name - immer dieselbe, damit man sich an „seinem“ Kästchen wiedererkennt. */
export function faceHue(name) {
  let hash = 0;
  for (const char of String(name || "")) hash = (hash * 31 + char.codePointAt(0)) % 360;
  return hash;
}

/** Bild oder Kürzel in der Farbe des Namens; ein leerer Platz nur mit gestricheltem Rand. */
export function TvFace({ name, avatar = "", className = "", testId }) {
  const empty = !name && !avatar;
  return (
    <span
      className={`tv-face ${empty ? "tv-face--empty" : ""} ${className}`}
      style={empty ? undefined : { "--tv-hue": faceHue(name) }}
      aria-hidden="true"
      data-testid={testId}
    >
      {avatar ? <img src={resolveMediaUrl(avatar)} alt="" /> : initials(name)}
    </span>
  );
}

/** „Runde 2 präsentiert von“ mit Logo - oben in der Kopfleiste (#1125). */
export function TvPresentedBy({ label, sponsor }) {
  if (!sponsor) return null;
  return (
    <div className="tv-presented" data-testid="tv-presented-by">
      <span className="tv-presented__label tv-t-meta">{label}<br />präsentiert von</span>
      <span className="tv-presented__logo" title={sponsor.name}>
        <SmartLogo src={resolveMediaUrl(sponsor.logo_url)} alt={sponsor.name} className="max-h-full max-w-full w-auto h-auto" />
      </span>
    </div>
  );
}

const LONG_TITLE = 34;

/** Kopfleiste: Logo, Kicker, Titel (lange Titel etwas kleiner und zweizeilig, nie „…“), rechts Zusatz. */
export function TvHeader({ kicker, live = false, title, subtitle = null, aside = null, hero = "", className = "", testId = "tv-header" }) {
  const long = String(title || "").length > LONG_TITLE;
  return (
    <header className={`tv-header ${className}`} data-testid={testId}>
      {hero ? <img src={hero} alt="" className="tv-header__hero" /> : null}
      <TvSeasonDeco />
      <div className="tv-header__content">
        <div className="tv-header__brand">
          <MascotBadge className="tv-logo" />
          <div className="min-w-0">
            <div className="tv-kicker tv-t-meta flex items-center gap-[0.6em]">
              {live ? <span className="tv-live-dot-tv tv-live-dot" aria-hidden="true" /> : null}
              <span>{kicker}</span>
            </div>
            <h1 className="tv-t-title font-heading font-black uppercase" data-fit={long ? "small" : undefined}>{title}</h1>
            {subtitle ? <div className="tv-t-info tv-muted mt-[0.2em]">{subtitle}</div> : null}
          </div>
        </div>
        {aside ? <div className="tv-header__aside">{aside}</div> : null}
      </div>
    </header>
  );
}

/**
 * Fußleiste: QR-Code (wächst mit), zwei Zeilen Text und - nur mit „Laufband unten“ (#1125) - die Sponsoren, ohne
 * Bewegung seitenweise statt als Laufband.
 */
export function TvFooter({ qrValue, kicker, text, sponsorMax = 4, children = null }) {
  const { motionOn, settings } = useTv();
  return (
    <footer className="tv-footer" data-testid="tv-footer">
      <div className="tv-footer__qr">
        <div className="tv-qr">
          <BrandedQRCode value={qrValue} size={160} />
        </div>
        <div className="min-w-0">
          <div className="tv-kicker tv-t-meta">{kicker}</div>
          <div className="tv-t-info tv-muted">{text}</div>
        </div>
      </div>
      {children}
      {settings.sponsor_ticker ? <SponsorGrid max={sponsorMax} marquee still={!motionOn} className="tv-sponsors" /> : null}
    </footer>
  );
}

// Live ist rot wie der LIVE-Rahmen der Karten (#1116), Grün heißt „frei“ oder „Anmeldung offen“.
const TONES = {
  live: "live",
  running: "live",
  in_progress: "live",
  check_in: "gold",
  checkin_open: "gold",
  registration_open: "green",
  paused: "muted",
  completed: "muted",
  results_published: "gold",
  cancelled: "red",
  ready: "accent",
  scheduled: "accent",
  waiting_result: "gold",
  disputed: "red",
};

/** Ein Schild in der Farbe seines Zustands. */
export function TvPill({ tone = "muted", children, live = false, testId }) {
  return (
    <span className={`tv-pill tv-t-meta ${tone !== "muted" ? `tv-pill--${tone}` : ""}`} data-testid={testId}>
      {live ? <span className="tv-live-dot-tv tv-live-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function toneFor(status) {
  return TONES[String(status || "").toLowerCase()] || "muted";
}
