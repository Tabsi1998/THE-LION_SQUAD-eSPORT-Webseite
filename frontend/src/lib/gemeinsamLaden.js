import { api } from "@/lib/api";

// Ein Abruf für zwei Stellen (#2059): Der Rahmen von „Mein Bereich“ holt für „Zu tun“ Rechnungen, Mitgliedschaft und die
// Übersicht des Vereins - dieselben Adressen holt die geöffnete Seite. Gleichzeitige Abrufe teilen sich eine Anfrage,
// eine Antwort gilt danach noch kurz (Nachzügler, etwa eine nachgeladene Seite). Nach einer Änderung (`frisch` oder
// `gemeinsamVergessen`) wird neu gefragt. Nur für Lesen ohne Parameter.
//
// Geteilt wird nur innerhalb eines Kontos (Prüfung #2059): der Schlüssel trägt die Konto-ID, ohne Konto wird nichts
// geteilt. Abmelden und Kontowechsel (AuthContext → `gemeinsamKonto`) leeren die Ablage; eine Antwort, die danach
// noch für das vorige Konto eintrifft, wird verworfen (`istVerworfen`) - sie kommt bei niemandem an.

const GILT_MS = 3000;
const ablage = new Map();
// Für wen die Ablage gerade gilt, und wie oft sie schon geleert wurde (Abmelden, Kontowechsel).
let aktuellesKonto = null;
let runde = 0;

class Verworfen extends Error {
  constructor(path) {
    super(`Antwort für ein anderes Konto verworfen: ${path}`);
    this.name = "Verworfen";
    this.verworfen = true;
  }
}

/** Ob ein Fehler nur die verworfene Antwort eines vorigen Kontos ist - dann nichts anzeigen. */
export function istVerworfen(fehler) {
  return Boolean(fehler?.verworfen);
}

function leeren() {
  runde += 1;
  ablage.clear();
}

/** Das angemeldete Konto (oder null nach dem Abmelden). Ein anderes als bisher leert die Ablage. */
export function gemeinsamKonto(konto) {
  const neu = konto || null;
  if (neu === aktuellesKonto) return;
  aktuellesKonto = neu;
  leeren();
}

export function gemeinsamLaden(path, { frisch = false, konto = "" } = {}) {
  if (!konto) return api.get(path);
  gemeinsamKonto(konto);
  const schluessel = `${konto}\n${path}`;
  const jetzt = Date.now();
  const eintrag = ablage.get(schluessel);
  if (!frisch && eintrag && (eintrag.offen || jetzt - eintrag.am < GILT_MS)) return eintrag.promise;
  const neu = { offen: true, am: jetzt, promise: null };
  const meineRunde = runde;
  neu.promise = api.get(path).then(
    (antwort) => {
      if (meineRunde !== runde) throw new Verworfen(path);
      neu.offen = false;
      neu.am = Date.now();
      return antwort;
    },
    (fehler) => {
      if (ablage.get(schluessel) === neu) ablage.delete(schluessel);
      throw meineRunde !== runde ? new Verworfen(path) : fehler;
    },
  );
  ablage.set(schluessel, neu);
  return neu.promise;
}

/**
 * Eine Adresse (für alle Konten) neu fragen lassen - nach einer Änderung. Ohne Adresse: alles vergessen, auch was noch
 * unterwegs ist (Abmelden, Tests).
 */
export function gemeinsamVergessen(path) {
  if (!path) {
    aktuellesKonto = null;
    leeren();
    return;
  }
  for (const schluessel of [...ablage.keys()]) {
    if (schluessel.endsWith(`\n${path}`)) ablage.delete(schluessel);
  }
}
