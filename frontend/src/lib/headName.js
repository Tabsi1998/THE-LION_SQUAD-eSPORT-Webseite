// Namen im Profilkopf (#1218): Spieler- und Vereinsprofil zeigen den Namen in höchstens zwei Zeilen. Ab 16 Zeichen
// gilt ein Name als lang und kommt eine Schriftstufe kleiner; erst wenn auch das nicht reicht, endet er mit „…“
// (Regel `.tls-head-name` in index.css). Der ganze Name steht trotzdem im Text - Vorleseprogramme lesen ihn vollständig.

export const LONG_HEAD_NAME = 16;

export function isLongHeadName(name) {
  return String(name || "").trim().length >= LONG_HEAD_NAME;
}

/** Die Klassen für den Namen im Kopf: immer `tls-head-name`, bei langen Namen dazu die kleinere Stufe. */
export function headNameClass(name) {
  return isLongHeadName(name) ? "tls-head-name tls-head-name--long" : "tls-head-name";
}
