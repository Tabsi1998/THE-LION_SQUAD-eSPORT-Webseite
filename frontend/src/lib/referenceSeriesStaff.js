// Captains externer Serien (#1749): Texte für Verwaltung und „Mein Dienst“. Ob ein Recht gilt und wer veröffentlichen
// darf, entscheidet der Server (services/reference_series_access.py) - hier wird nur beschriftet.
import { dayNoon, viennaDate, viennaDay } from "@/lib/vienna";

/** „31.12.2026“ für einen Kalendertag „JJJJ-MM-TT“; leer ohne Tag. */
export function dayLabel(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return "";
  return viennaDate(dayNoon(day), { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Heute in Wien - kleinster Wert für „Gilt bis“. */
export function todayDay() {
  return viennaDay(Date.now());
}

/** „gilt bis 31.12.2026“ oder „abgelaufen am 31.12.2026“ - nach `is_valid` vom Server. */
export function validityText(row) {
  const day = dayLabel(row?.valid_until);
  if (!day) return "ohne gültigen Ablauf – gilt nicht";
  return row.is_valid === false ? `abgelaufen am ${day}` : `gilt bis ${day}`;
}

/** Was die Einträge dieses Captains werden: direkt veröffentlicht oder Entwurf für den Vorstand. */
export function publishText(publishesDirectly) {
  return publishesDirectly ? "veröffentlicht direkt" : "Einträge sind Entwürfe, der Vorstand gibt frei";
}

/** Der Satz über der Captain-Liste - je nach Einstellung der Saison. */
export function publishModeSentence(publishMode) {
  return publishMode === "direct"
    ? "In dieser Saison veröffentlichen alle Captains direkt (Einstellung „Einträge eines Captains“)."
    : "In dieser Saison sind Einträge der Captains Entwürfe, die der Vorstand freigibt – außer bei Captains mit Recht zum Veröffentlichen.";
}
