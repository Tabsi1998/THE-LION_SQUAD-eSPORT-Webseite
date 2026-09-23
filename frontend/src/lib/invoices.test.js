import { amountLine, dueLine, filterInvoices, invoiceLine, outageText, sourceFilters, sourceLine, splitInvoices, summaryText } from "./invoices";

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
  expect(summaryText({ connected: false })).toMatch(/noch keine Rechnungen zu deinem Konto.*Vereinsmitglied/);
  expect(summaryText({ connected: true, summary: { count: 0 } })).toMatch(/noch keine Rechnungen/);
  expect(summaryText({ connected: true, summary: { count: 3, open_count: 0 } })).toBe("Alles bezahlt – 3 Belege im Archiv.");
  expect(summaryText({ connected: true, currency: "EUR", summary: { count: 3, open_count: 2, open_total: 75, overdue_count: 1 } })).toMatch(/2 offene Belege über.*75,00.*davon 1 überfällig/);
});

test("ein Ausfall zeigt den letzten Stand und sagt, dass Bezahlen warten muss", () => {
  expect(outageText({ available: true })).toBe("");
  expect(outageText({ available: false, reason_text: "Dolibarr ist nicht erreichbar", as_of: "2026-09-21T10:00:00+00:00" })).toMatch(/nicht erreichbar.*letzten bekannten Stand.*Stand: /);
});

test("Quelle und Vorgang (#320): Filter nach Quelle und Stand, die Vorgangszeile nur mit Vorgang, Knöpfe erst ab zwei Quellen", () => {
  const event = row({ key: "e", is_fee: false, source: "event", source_label: "Weihnachtsfeier", booking: { name: "Weihnachtsfeier", date: "12.12.2026", seats: 2, companions: 1, team: "", players: 0 } });
  const cup = row({ key: "t", status: "paid", is_fee: false, source: "tournament", source_label: "Startgeld Herbst-Cup – Team Lions", booking: { name: "Herbst-Cup", date: "02.10.2026", seats: 1, companions: 0, team: "Team Lions", players: 5 } });
  const fee = row({ key: "f", source: "club", source_label: "Mitgliedsbeitrag", booking: null });
  expect(sourceLine(event)).toBe("Weihnachtsfeier · 12.12.2026 · 2 Personen");
  expect(sourceLine(cup)).toBe("Startgeld Herbst-Cup – Team Lions · 02.10.2026 · 5 Spieler");
  expect(sourceLine(fee)).toBe("");
  expect(filterInvoices([event, cup, fee], "event", "all").map((r) => r.key)).toEqual(["e"]);
  expect(filterInvoices([event, cup, fee], "all", "paid").map((r) => r.key)).toEqual(["t"]);
  expect(filterInvoices([event, cup, fee], "club", "open").map((r) => r.key)).toEqual(["f"]);
  expect(sourceFilters({ sources: { club: 1, event: 1 } }).map((i) => i.label)).toEqual(["Alle", "Verein", "Events"]);
  expect(sourceFilters({ sources: { club: 4 } })).toEqual([]);
});
