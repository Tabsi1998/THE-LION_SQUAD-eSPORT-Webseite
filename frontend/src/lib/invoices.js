import { formatDate, formatMoney } from "@/lib/dolibarr";

// Eigene Rechnungen (#296): Texte und Reihenfolge für „Meine Rechnungen“. Was ein Beleg
// darf (bezahlen, PDF), sagt der Server – hier wird nur beschriftet.

export const STATUS_TONES = { open: "info", overdue: "warn", paid: "ok", abandoned: "muted" };

/** Offen und überfällig zuerst, darunter das Archiv – jeweils neueste oben. */
export function splitInvoices(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const isOpen = (row) => (row.status === "open" || row.status === "overdue") && row.type !== "credit_note";
  return { open: list.filter(isOpen), archive: list.filter((row) => !isOpen(row)) };
}

export function invoiceLine(row) {
  const parts = [row.type_label];
  if (row.is_fee) parts.push("Mitgliedsbeitrag");
  if (row.date) parts.push(formatDate(row.date));
  return parts.join(" · ");
}

export function amountLine(row, currency = "EUR") {
  const total = formatMoney(row.total, currency);
  if (row.type === "credit_note") return `${total} Gutschrift`;
  if (row.status === "paid") return `${total} · bezahlt`;
  if (row.status === "abandoned") return `${total} · aufgegeben`;
  const remaining = Number(row.remaining);
  if (Number.isFinite(remaining) && Math.abs(remaining - Number(row.total)) > 0.005) {
    return `${formatMoney(remaining, currency)} offen von ${total}`;
  }
  return `${total} offen`;
}

export function dueLine(row) {
  if (row.status === "overdue") return `Fällig war der ${formatDate(row.due_date)}`;
  if (row.status === "open" && row.due_date) return `Fällig am ${formatDate(row.due_date)}`;
  return "";
}

/** Der Kasten über der Liste. */
export function summaryText(data) {
  if (!data) return "";
  if (data.connected === false) return "Dein Konto ist noch keinem Mitglied in der Mitgliederverwaltung zugeordnet. Sobald der Vorstand die Zuordnung bestätigt hat, stehen deine Rechnungen hier.";
  const { summary, currency = "EUR" } = data;
  if (!summary?.count) return "Es gibt noch keine Rechnungen zu deinem Konto.";
  if (!summary.open_count) return `Alles bezahlt – ${summary.count} ${summary.count === 1 ? "Beleg" : "Belege"} im Archiv.`;
  const overdue = summary.overdue_count ? `, davon ${summary.overdue_count} überfällig` : "";
  return `${summary.open_count} ${summary.open_count === 1 ? "offener Beleg" : "offene Belege"} über ${formatMoney(summary.open_total, currency)}${overdue}.`;
}

export function outageText(data) {
  if (!data || data.available !== false) return "";
  const when = data.as_of ? ` Stand: ${formatDate(data.as_of)}.` : "";
  return `Die Mitgliederverwaltung antwortet gerade nicht (${data.reason_text || "Verbindung"}). Du siehst den letzten bekannten Stand; bezahlen geht erst wieder mit frischen Daten.${when}`;
}
