// Abschluss beim Veröffentlichen (#2460): scheitert ein Schritt (Jahreswertung, Auszeichnungen, Erfolge, Gewinne),
// nennt ihn der Server in ``failed_labels``. Die Seite warnt dann und bietet „Abschluss nachholen“ an.

export const SETTLE_WARNING_DURATION = 20000;

/** Die gescheiterten Schritte aus einer Status-Antwort - leer, wenn alles gelaufen ist. */
export function settleFailedLabels(data) {
  return Array.isArray(data?.failed_labels) ? data.failed_labels.filter((label) => typeof label === "string" && label) : [];
}

/** Warnung nach dem Veröffentlichen oder ``null``, wenn kein Schritt gescheitert ist. */
export function settleFailureMessage(data) {
  const failed = settleFailedLabels(data);
  if (!failed.length) return null;
  return `Veröffentlicht, aber nicht alles vergeben – gescheitert: ${failed.join(", ")}. Die übrigen Schritte sind gelaufen. Unter Werkzeuge „Abschluss nachholen“ tippen.`;
}
