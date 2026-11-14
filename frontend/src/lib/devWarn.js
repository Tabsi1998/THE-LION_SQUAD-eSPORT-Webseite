/**
 * Ein Hinweis nur beim Entwickeln (#937): Wo ein Fehlschlag die Seite bewusst nicht stört - etwa wenn das Branding
 * nicht nachgeladen werden kann und das zwischengespeicherte bleibt -, soll er beim Entwickeln trotzdem sichtbar sein.
 * Im fertigen Build und in den Tests bleibt die Konsole still.
 */
export function devWarn(message, error) {
  const env = import.meta.env || {};
  if (!env.DEV || env.MODE === "test") return;
  console.warn(`[TLS] ${message}`, error?.message || error || "");
}
