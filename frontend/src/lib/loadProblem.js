import { toast } from "sonner";
import { AREA_LABELS as AREA_NAMES } from "@/lib/permissions";

// Was beim Laden schiefging (#1152, wie loadProblem in der App): ohne Netz, nicht gefunden (404), nicht freigegeben
// (401/403) oder ein anderer Fehler. Danach richtet sich, was eine Seite zeigt - ein Ladefehler ist nie „nichts da“.

export function problemKind(error) {
  if (!error || !error.response) return "offline";
  const status = error.response.status;
  if (status === 404) return "notFound";
  if (status === 401 || status === 403) return "denied";
  return "error";
}

/** „Dafür fehlt dir …“ (#1353): bei 401/403 der Satz des Servers (fehlender Bereich, Zwei-Faktor), sonst der Bereich der
 * Seite. Bei anderen Fehlern leer - dann gilt die Fehlermeldung der Seite. */
export function deniedText(error, areas = []) {
  if (problemKind(error) !== "denied") return "";
  const detail = error.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  const names = areas.map((area) => `„${AREA_NAMES[area] || area}“`).join(" oder ");
  return names ? `Dafür fehlt dir der Bereich ${names}.` : "Dafür fehlt dir das Recht.";
}

function canceled(error) {
  return error?.code === "ERR_CANCELED" || error?.name === "CanceledError" || error?.name === "AbortError";
}

// Welche Meldung wann zuletzt kam (#2412): Seiten mit Nachladen im Takt scheitern bei einer Störung immer wieder - der
// Hinweis kommt einmal und erst wieder, wenn der Abruf zwischendurch geklappt hat (`loadOk`) oder nach fünf Minuten.
const REPEAT_AFTER_MS = 5 * 60 * 1000;
const reported = new Map();

/**
 * Ein Teil der Seite kam nicht (#2412) - eine Auswahlliste, eine Kachel, ein Zusatz: statt still zu fehlen, meldet ein
 * Hinweis den Ladefehler. Gibt den Fänger für `.catch(...)` zurück. Dieselbe Meldung steht nur einmal da, auch wenn
 * mehrere Abrufe scheitern oder einer im Takt immer wieder (siehe `loadOk`, je Abruf mit eigenem `key`). Abgebrochene Abrufe bleiben still, ebenso
 * „kein Netz“ - dafür gibt es die Offline-Leiste. Fehlt die ganze Seite, gehört der Fehler in die Seite
 * (PublicErrorState, LoadState), nicht hierher.
 */
export function toastLoadFailed(message, key = message) {
  return (error) => {
    if (canceled(error)) return;
    if (!error?.response && typeof navigator !== "undefined" && navigator.onLine === false) return;
    const last = reported.get(key);
    const now = Date.now();
    // Uhr zurückgestellt (now < last): lieber neu melden als bis zum alten Zeitpunkt still bleiben.
    if (last !== undefined && now >= last && now - last < REPEAT_AFTER_MS) return;
    reported.set(key, now);
    toast.error(message, { id: `load-failed:${message}` });
  };
}

/**
 * Der Abruf hat wieder geklappt: scheitert er danach erneut, kommt der Hinweis wieder. `key` ist die Meldung - oder,
 * wenn mehrere Abrufe dieselbe Meldung teilen, der eigene Schlüssel des Abrufs (zweites Argument von toastLoadFailed),
 * damit ein klappender Abruf den Hinweis eines anderen, weiter scheiternden nicht wieder scharf schaltet.
 */
export function loadOk(key) {
  reported.delete(key);
}

/** Nur für Tests: alle gemerkten Meldungen vergessen. */
export function resetLoadReports() {
  reported.clear();
}
