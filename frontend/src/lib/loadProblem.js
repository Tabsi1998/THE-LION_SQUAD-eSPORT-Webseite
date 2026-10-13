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
