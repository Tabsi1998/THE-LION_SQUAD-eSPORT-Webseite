import { emptyText, filterInvoices, payHint, sourceFilters, sourceLine } from "./invoices";
import type { Invoice, InvoiceList } from "./memberDocuments";

// Meine Rechnungen (#320): Filter, Vorgangszeile und die Hinweise - reine Logik.

const fee: Invoice = { key: "d-1", ref: "FA-1", type: "standard", type_label: "Rechnung", status: "open", status_label: "offen", total: 20, is_fee: true, can_pay: true, source: "club", source_label: "Mitgliedsbeitrag", booking: null };
const event: Invoice = { key: "d-2", ref: "FA-2", type: "standard", type_label: "Rechnung", status: "overdue", status_label: "überfällig", overdue: true, total: 40, can_pay: false, source: "event", source_label: "Weihnachtsfeier", booking: { name: "Weihnachtsfeier", date: "12.12.2026", seats: 2, companions: 1, team: "", players: 0 } };
const cup: Invoice = { key: "d-3", ref: "FA-3", type: "standard", type_label: "Rechnung", status: "paid", status_label: "bezahlt", total: 25, can_pay: false, source: "tournament", source_label: "Startgeld Herbst-Cup – Team Lions", booking: { name: "Herbst-Cup", date: "02.10.2026", seats: 1, companions: 0, team: "Team Lions", players: 5 } };
const credit: Invoice = { key: "d-4", ref: "AV-4", type: "credit_note", type_label: "Gutschrift", status: "open", status_label: "offen", total: -10, can_pay: false, source: "club", source_label: "Verein", booking: null };

function list(overrides: Partial<InvoiceList> = {}): InvoiceList {
  return { connected: true, available: true, invoices: [fee, event, cup, credit], sources: { club: 2, event: 1, tournament: 1 }, member: true, ...overrides };
}

test("Filter nach Quelle und Stand; eine Gutschrift ist nie offen", () => {
  expect(filterInvoices(list().invoices, "all", "all").map((r) => r.key)).toEqual(["d-1", "d-2", "d-3", "d-4"]);
  expect(filterInvoices(list().invoices, "event", "all").map((r) => r.key)).toEqual(["d-2"]);
  expect(filterInvoices(list().invoices, "all", "open").map((r) => r.key)).toEqual(["d-1", "d-2"]);
  expect(filterInvoices(list().invoices, "club", "paid").map((r) => r.key)).toEqual(["d-4"]);
  expect(filterInvoices(undefined, "all", "all")).toEqual([]);
});

test("die Quellen-Reiter gibt es nur, wenn es mehr als eine Quelle gibt", () => {
  expect(sourceFilters(list()).map((item) => item.label)).toEqual(["Alle", "Verein", "Events", "Turniere"]);
  expect(sourceFilters(list({ sources: { club: 3 } }))).toEqual([]);
  expect(sourceFilters(null)).toEqual([]);
});

test("die Zeile zum Vorgang", () => {
  expect(sourceLine(fee)).toBe("Mitgliedsbeitrag");
  expect(sourceLine(event)).toBe("Weihnachtsfeier · 12.12.2026 · 2 Personen");
  expect(sourceLine(cup)).toBe("Startgeld Herbst-Cup – Team Lions · 02.10.2026 · 5 Spieler");
  expect(sourceLine({ ...fee, source_label: undefined, is_fee: false })).toBe("");
});

test("leer und bezahlen: ehrlich je nach Lage", () => {
  expect(emptyText(list({ invoices: [], connected: false }))).toContain("Sobald der Verein dir eine Rechnung stellt");
  expect(emptyText(list())).toContain("Nichts in dieser Auswahl");
  expect(payHint([fee, event])).toContain("auf der Website");
  expect(payHint([event])).toContain("Überweisung");
  expect(payHint([cup, credit])).toBe("");
});
