// Bewerbungen (#1356): jeder Stand als Satz mit dem nächsten Schritt - nie ein Rohwert. Anträge über Dolibarr entscheidet
// der Vorstand dort; hier steht, was zu tun ist und dass der Stand von selbst kommt.

/**
 * @param app        ein Antrag aus /membership/applications
 * @param formatDay  Datum als Text (z. B. viennaDate)
 * @returns {{ label: string, next: string, tone: "open"|"wait"|"done"|"stop"|"unknown", decide: boolean }}
 */
export function applicationState(app, formatDay = (value) => value) {
  const day = (value) => (value ? formatDay(value) : "");
  const decided = day(app?.decided_at);
  if (!app) return { label: "Unbekannt", next: "", tone: "unknown", decide: false };
  if (!app.coupled) {
    if (app.status === "pending") return { label: "Offen", next: "Annehmen oder ablehnen – hier auf der Website.", tone: "open", decide: true };
    if (app.status === "approved") return { label: "Aufgenommen", next: decided ? `Aufgenommen am ${decided}.` : "Aufgenommen.", tone: "done", decide: false };
    if (app.status === "rejected") return { label: "Abgelehnt", next: decided ? `Abgelehnt am ${decided}.` : "Abgelehnt.", tone: "stop", decide: false };
    if (app.status === "withdrawn") return { label: "Zurückgezogen", next: decided ? `Zurückgezogen am ${decided}.` : "Die Person hat den Antrag zurückgezogen.", tone: "stop", decide: false };
    return { label: "Stand unbekannt", next: "Dieser Stand ist neu für die Website – bitte bei der Technik melden.", tone: "unknown", decide: false };
  }
  if (app.status === "submitting") {
    return { label: "Wird übermittelt", next: "Die Website schickt den Antrag an Dolibarr – das geht von selbst. Hängt er länger, die Verbindung zu Dolibarr prüfen lassen.", tone: "wait", decide: false };
  }
  const state = app.dolibarr?.application_status;
  if (state === "received") return { label: "Wartet auf Dolibarr", next: "Dort annehmen oder ablehnen – hier erscheint es von selbst.", tone: "wait", decide: false };
  if (state === "in_review") return { label: "In Prüfung in Dolibarr", next: "Dort entscheiden – hier erscheint es von selbst.", tone: "wait", decide: false };
  if (state === "accepted" || app.status === "approved") return { label: "Aufgenommen", next: decided ? `In Dolibarr aufgenommen am ${decided}.` : "In Dolibarr aufgenommen.", tone: "done", decide: false };
  if (state === "rejected" || app.status === "rejected") return { label: "Abgelehnt", next: decided ? `In Dolibarr abgelehnt am ${decided}.` : "In Dolibarr abgelehnt.", tone: "stop", decide: false };
  if (state === "withdrawn" || app.status === "withdrawn") return { label: "Zurückgezogen", next: decided ? `Zurückgezogen am ${decided}.` : "Die Person hat den Antrag zurückgezogen.", tone: "stop", decide: false };
  return { label: "Stand aus Dolibarr unbekannt", next: "In Dolibarr nachsehen – die Website kennt diesen Stand noch nicht.", tone: "unknown", decide: false };
}

export const STATE_TONE_CLASS = {
  open: "border-[#29B6E8]/45 text-[#29B6E8]",
  wait: "border-[#FF9500]/45 text-[#FF9500]",
  done: "border-[#00FF88]/40 text-[#00FF88]",
  stop: "border-white/20 text-white/55",
  unknown: "border-[#FF9500]/45 text-[#FF9500]",
};
