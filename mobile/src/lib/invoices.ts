import type { Invoice, InvoiceList } from "./memberDocuments";

// Meine Rechnungen für alle (#320): Filter nach Quelle und Stand, die Zeile zum Vorgang, und die
// Erklärung, wenn nichts da ist. Was ein Beleg darf, sagt der Server - hier wird nur sortiert.

export type SourceFilter = "all" | "club" | "event" | "tournament";
export type StateFilter = "all" | "open" | "paid";

export const SOURCE_LABELS: Record<string, string> = { club: "Verein", event: "Events", tournament: "Turniere", other: "Sonstiges" };

export const STATE_FILTERS: Array<{ key: StateFilter; label: string }> = [
  { key: "all", label: "Alle" },
  { key: "open", label: "Offen" },
  { key: "paid", label: "Bezahlt" },
];

/** Die Quellen, die es wirklich gibt - eine allein braucht keinen Filter. */
export function sourceFilters(list: InvoiceList | null | undefined): Array<{ key: SourceFilter; label: string }> {
  const present = Object.keys(list?.sources || {});
  const items: Array<{ key: SourceFilter; label: string }> = [{ key: "all", label: "Alle" }];
  for (const key of ["club", "event", "tournament"] as const) {
    if (present.includes(key)) items.push({ key, label: SOURCE_LABELS[key] });
  }
  return items.length > 2 ? items : [];
}

export function isOpen(invoice: Invoice): boolean {
  return (invoice.status === "open" || invoice.status === "overdue") && invoice.type !== "credit_note";
}

export function filterInvoices(rows: Invoice[] | null | undefined, source: SourceFilter, state: StateFilter): Invoice[] {
  return (rows || []).filter((row) => {
    if (source !== "all" && (row.source || "club") !== source) return false;
    if (state === "open") return isOpen(row);
    if (state === "paid") return !isOpen(row);
    return true;
  });
}

/** „Weihnachtsfeier · 12.12.2026 · 2 Personen“, „Startgeld Herbst-Cup – Team Lions · 5 Spieler“ oder „Mitgliedsbeitrag“. */
export function sourceLine(invoice: Invoice): string {
  const booking = invoice.booking;
  if (!booking) return invoice.source_label || (invoice.is_fee ? "Mitgliedsbeitrag" : "");
  const parts = [invoice.source_label || booking.name];
  if (booking.date) parts.push(booking.date);
  if (invoice.source === "event" && booking.seats > 1) parts.push(`${booking.seats} Personen`);
  if (invoice.source === "tournament" && booking.players > 0) parts.push(`${booking.players} Spieler`);
  return parts.filter(Boolean).join(" · ");
}

export function emptyText(list: InvoiceList | null | undefined): string {
  if (list?.connected && list.invoices?.length) return "Nichts in dieser Auswahl – ändere den Filter oben.";
  return "Sobald der Verein dir eine Rechnung stellt – für ein Event, ein Turnier oder den Mitgliedsbeitrag –, erscheint sie hier.";
}

/** Wie bezahlt wird: online über die Website (Mitglieder), sonst per Überweisung laut Rechnung. */
export function payHint(rows: Invoice[]): string {
  const open = rows.filter(isOpen);
  if (!open.length) return "";
  if (open.some((row) => row.can_pay)) return "Bezahlen geht auf der Website unter „Meine Rechnungen“ – dort führt der Link direkt zum Zahlungsanbieter.";
  return "Bezahlt wird per Überweisung – Bankverbindung und Verwendungszweck stehen auf der Rechnung.";
}
