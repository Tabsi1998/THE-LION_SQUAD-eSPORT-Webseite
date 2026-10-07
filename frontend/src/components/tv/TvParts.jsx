import { MascotBadge } from "@/components/tls/Logo";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { SponsorGrid } from "@/components/tls/SponsorTicker";
import { TvSeasonDeco } from "./TvSeasonDeco";
import { useTv } from "./TvScreen";

// Gemeinsame Teile der TV-Seiten (#1110, #1111): Kopfleiste mit Jahreszeiten-Deko, Fußleiste mit QR-Code und
// Sponsoren, Schilder. Alle Größen kommen aus tv.css - keine Pixel-Stufen mehr.

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

/** Fußleiste: QR-Code (wächst mit), zwei Zeilen Text, Sponsoren - ohne Bewegung seitenweise statt als Laufband. */
export function TvFooter({ qrValue, kicker, text, sponsorMax = 4, children = null }) {
  const { motionOn } = useTv();
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
      <SponsorGrid max={sponsorMax} marquee still={!motionOn} className="tv-sponsors" />
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
