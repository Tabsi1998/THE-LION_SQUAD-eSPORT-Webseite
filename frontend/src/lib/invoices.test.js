import { amountLine, dueLine, invoiceLine, outageText, splitInvoices, summaryText } from "./invoices";

// Meine Rechnungen (#296): was in Worten dasteht.

const row = (extra) => ({ key: "d-1", ref: "FA-1", type: "standard", type_label: "Rechnung", status: "open", status_label: "offen",
  date: "2026-08-01", due_date: "2026-08-15", total: 60, remaining: 60, overdue: false, is_fee: true, can_pay: false, ...extra });

test("offen und überfällig stehen oben, Gutschriften und Bezahltes im Archiv", () => {
  const groups = splitInvoices([row({ key: "a" }), row({ key: "b", status: "paid" }), row({ key: "c", type: "credit_note", total: -20 }), row({ key: "d", status: "overdue", overdue: true })]);
  expect(groups.open.map((r) => r.key)).toEqual(["a", "d"]);
  expect(groups.archive.map((r) => r.key)).toEqual(["b", "c"]);
});

test("Beträge in Worten: offen, Teilzahlung, bezahlt, Gutschrift", () => {
  expect(amountLine(row())).toMatch(/60,00.*offen$/);
  expect(amountLine(row({ remaining: 15 }))).toMatch(/15,00.*offen von.*60,00/);
  expect(amountLine(row({ status: "paid", remaining: 0 }))).toMatch(/60,00.*bezahlt/);
  expect(amountLine(row({ type: "credit_note", total: -20, remaining: 0 }))).toMatch(/20,00.*Gutschrift/);
  expect(invoiceLine(row())).toBe("Rechnung · Mitgliedsbeitrag · 1.8.2026");
  expect(dueLine(row({ status: "overdue" }))).toBe("Fällig war der 15.8.2026");
  expect(dueLine(row({ status: "paid" }))).toBe("");
});

test("der Kasten oben sagt, was Sache ist – ohne Zuordnung, ohne Belege, alles bezahlt, offen", () => {
  expect(summaryText({ connected: false })).toMatch(/noch keinem Mitglied/);
  expect(summaryText({ connected: true, summary: { count: 0 } })).toMatch(/noch keine Rechnungen/);
  expect(summaryText({ connected: true, summary: { count: 3, open_count: 0 } })).toBe("Alles bezahlt – 3 Belege im Archiv.");
  expect(summaryText({ connected: true, currency: "EUR", summary: { count: 3, open_count: 2, open_total: 75, overdue_count: 1 } })).toMatch(/2 offene Belege über.*75,00.*davon 1 überfällig/);
});

test("ein Ausfall zeigt den letzten Stand und sagt, dass Bezahlen warten muss", () => {
  expect(outageText({ available: true })).toBe("");
  expect(outageText({ available: false, reason_text: "Dolibarr ist nicht erreichbar", as_of: "2026-09-21T10:00:00+00:00" })).toMatch(/nicht erreichbar.*letzten bekannten Stand.*Stand: /);
});
