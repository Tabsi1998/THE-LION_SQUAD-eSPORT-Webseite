// Prüfung beim Speichern einer Referenz (#1755): der Server prüft Datum und Platzierung und meldet nur Warnungen je
// Feld („end_date“, „entries.<n>.placement“, bei alten Referenzen „placement“). Hier nur das Zuordnen zu den Feldern
// des Formulars und der Schlüssel, ab wann eine neue Prüfung nötig ist.

/** Die Warnungen nach Feld gruppiert: { end_date: ["…"], "entries.1.placement": ["…"] }. */
export function warningsByField(warnings) {
  const out = {};
  for (const item of Array.isArray(warnings) ? warnings : []) {
    if (!item?.field || !item?.message) continue;
    (out[item.field] ||= []).push(item.message);
  }
  return out;
}

/** Nur die Werte, die die Prüfung liest - ändert sich etwas anderes (Titel, Texte), wird nicht neu geprüft. */
export function checkKey(payload) {
  return JSON.stringify({
    start_date: payload?.start_date || null,
    end_date: payload?.end_date || null,
    status: payload?.status || null,
    entries: (payload?.entries || []).map((entry) => [entry?.placement ?? null, entry?.participant_count ?? null, entry?.team_count ?? null]),
  });
}

/** Kurzer Satz für die Meldung nach dem Speichern. */
export function warningSummary(warnings) {
  const count = Array.isArray(warnings) ? warnings.length : 0;
  if (!count) return "";
  return count === 1 ? "Gespeichert – 1 Hinweis zur Prüfung." : `Gespeichert – ${count} Hinweise zur Prüfung.`;
}
