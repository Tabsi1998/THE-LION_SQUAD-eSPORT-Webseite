// LionsAPP: Download-Knopf im Store-Stil (#1084). Ein eigener Knopf mit neutralem Symbol und zwei Zeilen, der sich
// beim Drüberfahren weich verändert - statt des Handy-Blocks. Das offizielle Google-Play-Badge bleibt unverändert
// klein daneben (Googles Markenregeln). Ohne Play-Link gibt es den Knopf nicht.
//
// Drei Varianten aus der Vorschau (Abschnitt 10), Stil in index.css (.tls-store):
//   a  wie im Video: schwarz, kehrt sich beim Drüberfahren um
//   b  Blau läuft ein (Vorgabe): das Blau der Seite füllt den Knopf von links, das Symbol nickt nach unten
//   c  mit App-Kachel: Lichtlauf über der Kachel, der Knopf hebt sich mit blauem Schatten
// „Bewegung reduzieren“ nimmt die Bewegung heraus (--tls-motion-on), die Farbe wechselt weiter.

export const STORE_VARIANT = "b";

export function StoreButton({ href, variant = STORE_VARIANT, small = "Jetzt bei", big = "Google Play", testId = "store-button", className = "" }) {
  if (!href) return null;
  const tile = variant === "c";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`tls-store tls-store--${variant} ${className}`}
      data-testid={testId}
      data-variant={variant}
      aria-label={`${small} ${big}`}
    >
      {tile ? (
        <span className="tls-store__tile" aria-hidden="true">TLS</span>
      ) : (
        <svg className="tls-store__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z" />
        </svg>
      )}
      <span className="tls-store__text">
        <small>{small}</small>
        <b>{big}</b>
      </span>
    </a>
  );
}
