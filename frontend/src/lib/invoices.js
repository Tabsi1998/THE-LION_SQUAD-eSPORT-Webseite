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
  // #320: „nicht zugeordnet“ heißt nur: noch kein Beleg zu diesem Konto - auch Nicht-Mitglieder bekommen hier ihre Event- und Turnierrechnungen.
  if (data.connected === false) return "Es gibt noch keine Rechnungen zu deinem Konto. Sobald der Verein dir eine stellt – für ein Event, ein Turnier oder den Mitgliedsbeitrag –, erscheint sie hier. Vereinsmitglied? Dann unter „Meine Mitgliedschaft“ die Zuordnung anfragen.";
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

// Quelle eines Belegs (#320): Mitgliedsbeitrag, Event oder Turnier - und der Vorgang dahinter.
export const SOURCE_LABELS = { club: "Verein", event: "Events", tournament: "Turniere", other: "Sonstiges" };
export const STATE_FILTERS = [{ key: "all", label: "Alle" }, { key: "open", label: "Offen" }, { key: "paid", label: "Bezahlt" }];

/** Die Quellen-Knöpfe gibt es erst, wenn es mehr als eine Quelle gibt. */
export function sourceFilters(data) {
  const present = Object.keys(data?.sources || {});
  const items = [{ key: "all", label: "Alle" }];
  for (const key of ["club", "event", "tournament"]) {
    if (present.includes(key)) items.push({ key, label: SOURCE_LABELS[key] });
  }
  return items.length > 2 ? items : [];
}

export function isOpenInvoice(row) {
  return (row.status === "open" || row.status === "overdue") && row.type !== "credit_note";
}

export function filterInvoices(rows, source = "all", state = "all") {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (source !== "all" && (row.source || "club") !== source) return false;
    if (state === "open") return isOpenInvoice(row);
    if (state === "paid") return !isOpenInvoice(row);
    return true;
  });
}

/** „Weihnachtsfeier · 12.12.2026 · 2 Personen“ - nur mit Vorgang; der Beitrag steht schon in der Belegzeile. */
export function sourceLine(row) {
  const booking = row?.booking;
  if (!booking) return "";
  const parts = [row.source_label || booking.name];
  if (booking.date) parts.push(booking.date);
  if (row.source === "event" && booking.seats > 1) parts.push(`${booking.seats} Personen`);
  if (row.source === "tournament" && booking.players > 0) parts.push(`${booking.players} Spieler`);
  return parts.filter(Boolean).join(" · ");
}
