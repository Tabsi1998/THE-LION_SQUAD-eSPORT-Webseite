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

/** Neutrale Symbole je Laden (keine Markenlogos): Abspielen für Google Play, Handy mit Pfeil für den App Store. */
const ICONS = {
  play: <path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z" />,
  phone: (
    <>
      <path d="M8 2.5h8a2 2 0 0 1 2 2v15a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7v7m0 0-3-3m3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="18.2" r="0.9" />
    </>
  ),
};

export function StoreButton({ href, variant = STORE_VARIANT, small = "Jetzt bei", big = "Google Play", icon = "play", testId = "store-button", className = "" }) {
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
        <svg className="tls-store__icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" data-icon={icon}>
          {ICONS[icon] || ICONS.play}
        </svg>
      )}
      <span className="tls-store__text">
        <small>{small}</small>
        <b>{big}</b>
      </span>
    </a>
  );
}
