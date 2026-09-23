// Finanzübersicht (#321, #322) - reine Helfer ohne React: Beträge, Zahlungsstand, Filterquellen,
// der CSV-Export für den Kassier (ohne Formel-Injektion) und die Summenzeile je Veranstaltung.

export const PAYMENT_TONE = {
  draft: "text-[#FFD700]", open: "text-white/80", partial: "text-[#29B6E8]", paid: "text-[#00FF88]",
  overdue: "text-[#FF3B30]", overpaid: "text-[#FF3B30]", credited: "text-white/60", abandoned: "text-white/40",
};

export const SUMMARY_FIELDS = [
  ["booked_cents", "gebucht"], ["invoiced_cents", "fakturiert"], ["paid_cents", "bezahlt"],
  ["open_cents", "offen"], ["credited_cents", "gutgeschrieben"], ["refunded_cents", "erstattet"],
];

export function formatCents(cents, currency = "EUR") {
  const value = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const euros = Math.floor(abs / 100);
  const rest = String(abs % 100).padStart(2, "0");
  return `${sign}${euros},${rest} ${currency === "EUR" ? "€" : currency}`;
}

// „20,50“ oder „20.5“ oder „20“ → 2050; Unsinn → null.
export function parseEuro(text) {
  const clean = String(text ?? "").trim().replace(/\s/g, "").replace(/€/g, "");
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(clean)) return null;
  const [euros, rest = ""] = clean.replace(",", ".").split(".");
  return Number(euros) * 100 + Number((rest + "00").slice(0, 2));
}

// Quellen (Events, Turniere) aus den geladenen Zeilen - jede einmal, nach Namen sortiert.
export function sourcesFrom(rows) {
  const seen = new Map();
  for (const row of rows || []) {
    const id = row?.source_id;
    if (!id || seen.has(id)) continue;
    seen.set(id, { id, kind: row.kind || row.source_kind || row.source?.kind || "event", name: row.source?.name || id });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export function summaryLines(summary) {
  if (!summary) return [];
  return SUMMARY_FIELDS.map(([key, label]) => ({ key, label, value: formatCents(summary[key] || 0) }));
}

// Eine CSV-Zelle: Anführungszeichen verdoppelt; Zellen, die eine Tabellenkalkulation als Formel
// lesen würde (=, +, -, @, Tab, CR), bekommen ein Hochkomma davor.
export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

const CSV_COLUMNS = [
  ["Rechnung", (row) => row.invoice_ref || ""],
  ["Angebot", (row) => row.source?.name || row.source_id || ""],
  ["Person", (row) => row.person || ""],
  ["Betrag", (row) => formatCents(row.total_cents, row.currency)],
  ["Zahlungsstand", (row) => row.payment_label || row.status_label || ""],
  ["Bezahlt", (row) => formatCents(row.paid_cents || 0, row.currency)],
  ["Gutgeschrieben", (row) => formatCents(row.credited_cents || 0, row.currency)],
  ["Erstattet", (row) => formatCents(row.refunded_cents || 0, row.currency)],
  ["Buchung", (row) => (row.booking_state === "cancelled" ? "storniert" : "aktiv")],
  ["Stand", (row) => row.synced_at || ""],
];

const BOM = String.fromCharCode(0xfeff);

// Nur, was der Kassier braucht - keine Adressen, keine Bankdaten, keine Dolibarr-Schlüssel.
export function toCsv(rows) {
  const lines = [CSV_COLUMNS.map(([label]) => csvCell(label)).join(";")];
  for (const row of rows || []) lines.push(CSV_COLUMNS.map(([, pick]) => csvCell(pick(row))).join(";"));
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

export function csvFilename(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return `abrechnung-${day}.csv`;
}

// „Stand von Dolibarr: 23.09., 11:40“ - oder der Fehler, wenn der letzte Abgleich nicht lesen konnte.
export function syncLine(row) {
  if (row?.sync_error) return { tone: "text-[#FF3B30]", text: `Dolibarr nicht lesbar: ${row.sync_error_text || row.sync_error}` };
  if (!row?.synced_at) return { tone: "text-white/40", text: "noch nicht nachgelesen" };
  const at = new Date(row.synced_at);
  return { tone: "text-white/40", text: `Stand ${Number.isNaN(at.getTime()) ? row.synced_at : at.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` };
}
