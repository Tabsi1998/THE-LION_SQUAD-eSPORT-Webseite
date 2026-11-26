// Seiten mit Schlüssel in der Adresse (#1662): „Zurück auf Einzelmails“ und „Newsletter abbestellen“. Bevor irgendein Abruf
// startet, gilt dort „no-referrer“ - sonst ginge die Adresse samt Schlüssel als Referer an die API und an jede eingebundene
// Quelle. Erster Import in src/index.jsx; im Betrieb setzt nginx denselben Kopf schon für das Dokument (nginx.conf,
// $tls_referrer_policy).
export const NO_REFERRER_PATHS = /^\/(sammel-mail\/einzeln|newsletter\/abbestellen)\/?$/;

export function guardReferrer(doc = typeof document === "undefined" ? null : document, path = doc?.location?.pathname || "") {
  if (!doc || !NO_REFERRER_PATHS.test(path) || doc.querySelector('meta[name="referrer"]')) return false;
  const meta = doc.createElement("meta");
  meta.name = "referrer";
  meta.content = "no-referrer";
  doc.head.prepend(meta);
  return true;
}

guardReferrer();
