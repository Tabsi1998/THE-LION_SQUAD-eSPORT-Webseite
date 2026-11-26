import { api } from "@/lib/api";

// Ein Abruf für zwei Stellen (#2059): Der Rahmen von „Mein Bereich“ holt für „Zu tun“ Rechnungen, Mitgliedschaft und die
// Übersicht des Vereins - dieselben Adressen holt die geöffnete Seite. Gleichzeitige Abrufe teilen sich eine Anfrage,
// eine Antwort gilt danach noch kurz (Nachzügler, etwa eine nachgeladene Seite). Nach einer Änderung (`frisch` oder
// `gemeinsamVergessen`) wird neu gefragt. Nur für Lesen ohne Parameter.

const GILT_MS = 3000;
const ablage = new Map();

export function gemeinsamLaden(path, { frisch = false } = {}) {
  const jetzt = Date.now();
  const eintrag = ablage.get(path);
  if (!frisch && eintrag && (eintrag.offen || jetzt - eintrag.am < GILT_MS)) return eintrag.promise;
  const neu = { offen: true, am: jetzt, promise: null };
  neu.promise = api.get(path).then(
    (antwort) => {
      neu.offen = false;
      neu.am = Date.now();
      return antwort;
    },
    (fehler) => {
      if (ablage.get(path) === neu) ablage.delete(path);
      throw fehler;
    },
  );
  ablage.set(path, neu);
  return neu.promise;
}

/** Eine Adresse (oder alle) neu fragen lassen - nach einer Änderung oder in Tests. */
export function gemeinsamVergessen(path) {
  if (path) ablage.delete(path);
  else ablage.clear();
}
