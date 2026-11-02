// Fehler melden: Pfad ohne Kennungen. Mit der Meldung geht nur mit, was beim Finden hilft - der Pfad ohne Abfrage, und bei
// Seiten mit einer Kennung in der Adresse nur ihr fester Teil.
const PATHS_WITH_ID = ["/karte/pruefen/"];

export function reportablePath(value) {
  const path = String(value || "").split(/[?#]/)[0];
  const prefix = PATHS_WITH_ID.find((start) => path.startsWith(start));
  return prefix ? `${prefix}…` : path;
}
