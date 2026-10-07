import { CalendarDays, Gamepad2, Gift, Heart, IdCard, Shield, Star, Trophy, Users, Vote } from "lucide-react";
import { formatDate } from "@/lib/dolibarr";

// Mitgliedsbeitrag offen nennen (#1251): dieselben Zahlen auf „Mitglied werden“ und im Antrag - die Mitgliedsarten aus
// Dolibarr in der Form von `public_fee`. Dazu die Symbole der Vorteils-Kacheln (#1335), wie die Verwaltung sie wählt.

export function formatMoney(value, currency = "EUR") {
  const number = Number(value || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${number} ${currency === "EUR" ? "€" : currency}`;
}

/** „50,00 € je Jahr · einmalig 10,00 € Aufnahme · Eintritt unterm Jahr anteilig“ - oder „Ohne Beitrag“. */
export function feeLine(fee) {
  if (!fee?.subscription_required || fee.amount === null || fee.amount === undefined) return "Ohne Beitrag";
  const parts = [`${formatMoney(fee.amount, fee.currency)} ${fee.period_label || "je Jahr"}`];
  if (fee.admission_fee) parts.push(`einmalig ${formatMoney(fee.admission_fee, fee.currency)} Aufnahme`);
  if (fee.prorated) parts.push("Eintritt unterm Jahr anteilig");
  return parts.join(" · ");
}

/** Nur der Betrag mit Zeitraum: „50,00 € je Jahr“. */
export function feeAmount(fee) {
  if (!fee?.subscription_required || fee.amount === null || fee.amount === undefined) return "Ohne Beitrag";
  return `${formatMoney(fee.amount, fee.currency)} ${fee.period_label || "je Jahr"}`;
}

/** Wie aktuell die Beträge sind: „Stand 07.10.2026“ nur, wenn Dolibarr gerade nicht antwortet. */
export function feesStandLine(fees) {
  if (!fees?.available || !fees.stale || !fees.as_of) return "";
  return `Stand ${formatDate(String(fees.as_of).slice(0, 10))} – die Mitgliederverwaltung antwortet gerade nicht.`;
}

export const BENEFIT_ICONS = { vote: Vote, gift: Gift, trophy: Trophy, card: IdCard, users: Users, calendar: CalendarDays, star: Star, shield: Shield, heart: Heart, gamepad: Gamepad2 };

export const BENEFIT_ICON_LABELS = {
  vote: "Abstimmen", gift: "Geschenk", trophy: "Pokal", card: "Karte", users: "Leute", calendar: "Kalender", star: "Stern", shield: "Schild", heart: "Herz", gamepad: "Controller",
};

export const DEFAULT_JOIN_BENEFITS = [
  { icon: "vote", title: "Stimmrecht im Verein", text: "Bei den Versammlungen redest du mit und wählst den Vorstand." },
  { icon: "gift", title: "Vorteile bei Partnern", text: "Mit der Mitgliedskarte gibt es Rabatte und Partnerangebote." },
  { icon: "trophy", title: "Turniere nur für Mitglieder", text: "Mitglieder-Turniere, Challenges und eine frühere Anmeldung zu Events." },
  { icon: "card", title: "Eigene Mitgliedskarte", text: "Mit Mitgliedsnummer und Prüfcode – im Browser und in der LionsAPP." },
];
