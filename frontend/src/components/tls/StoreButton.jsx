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

/** Symbole je Laden, einfarbig in der Schriftfarbe: Abspielen für Google Play, das Apple-Zeichen für den App Store. */
const ICONS = {
  play: <path d="M6 3.5v17a1 1 0 0 0 1.5.86l14-8.5a1 1 0 0 0 0-1.72l-14-8.5A1 1 0 0 0 6 3.5z" />,
  apple: <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />,
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
