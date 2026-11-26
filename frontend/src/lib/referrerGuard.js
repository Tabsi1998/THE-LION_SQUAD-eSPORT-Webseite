// Seiten mit Schlüssel in der Adresse (#1662): „Zurück auf Einzelmails“ und „Newsletter abbestellen“.
//
// Den eigentlichen Schutz gibt nginx: die Kopfzeile „Referrer-Policy: no-referrer“ für das Dokument (nginx.conf,
// $tls_referrer_policy über $request_uri). Nur sie greift, bevor der Browser Schriften, CSS und Skript-Teile lädt - dieses
// Modul läuft erst danach. Es deckt die Abrufe ab, die die App selbst startet (API), und die Entwicklung ohne nginx.
// Sobald der Schlüssel aus der Adresse ist oder die Route wechselt, gibt ``releaseReferrer`` die übliche Regel zurück, damit
// sie bei Navigation innerhalb der App nicht stehen bleibt.
export const NO_REFERRER_PATHS = /^\/(sammel-mail\/einzeln|newsletter\/abbestellen)\/?$/;

export function guardReferrer(doc = typeof document === "undefined" ? null : document, path = doc?.location?.pathname || "") {
  if (!doc || !NO_REFERRER_PATHS.test(path) || doc.querySelector('meta[name="referrer"]')) return false;
  const meta = doc.createElement("meta");
  meta.name = "referrer";
  meta.content = "no-referrer";
  doc.head.prepend(meta);
  return true;
}

const DEFAULT_POLICY = "strict-origin-when-cross-origin";

/** Die übliche Regel zurück: ein neues Meta-Tag (ein späteres gilt; das Entfernen allein setzt sie nicht zurück). */
export function releaseReferrer(doc = typeof document === "undefined" ? null : document) {
  const guard = doc?.querySelector('meta[name="referrer"][content="no-referrer"]');
  if (!guard) return false;
  guard.remove();
  const meta = doc.createElement("meta");
  meta.name = "referrer";
  meta.content = DEFAULT_POLICY;
  doc.head.prepend(meta);
  return true;
}

guardReferrer();
