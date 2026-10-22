// Baustein „Drücken“ (#1969): Mikro-Rückmeldung für Karten und Flächen, die man antippt - mit der Maus hebt sich die
// Fläche um 2 px, beim Drücken gibt sie leicht nach (97 %). Nur Verschieben und Skalieren über die Bewegungs-Regeln;
// mit „Bewegung reduzieren“ bleibt sie still. Knöpfe haben das schon (tls-btn) - Press ist für Karten, Kacheln, Chips.
// `as` wählt das Element (Link, button, a, div …), `lift={false}` lässt das Anheben weg (für Chips in Leisten).

export function Press({ as: Tag = "div", lift = true, className = "", ...rest }) {
  const classes = ["tls-press", lift ? "" : "tls-press--flat", className].filter(Boolean).join(" ");
  return <Tag className={classes} {...rest} />;
}
