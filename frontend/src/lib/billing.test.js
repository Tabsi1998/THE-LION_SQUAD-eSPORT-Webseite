import { attentionLine, csvCell, csvFilename, firstAttention, formatCents, parseEuro, sourcesFrom, summaryLines, syncLine, toCsv } from "./billing";

// Finanzübersicht (#321, #322): Beträge, Eingaben, Quellen und der CSV-Export ohne Formel-Injektion.

test("Beträge in Cent werden als Euro gezeigt, Eingaben in Euro werden Cent", () => {
  expect(formatCents(4000)).toBe("40,00 €");
  expect(formatCents(-250)).toBe("-2,50 €");
  expect(formatCents("nein")).toBe("0,00 €");
  expect(parseEuro("20,50")).toBe(2050);
  expect(parseEuro(" 20 € ")).toBe(2000);
  expect(parseEuro("20.5")).toBe(2050);
  expect(parseEuro("abc")).toBeNull();
  expect(parseEuro("-5")).toBeNull();
});

test("die CSV-Zelle entschärft Formeln und Anführungszeichen", () => {
  expect(csvCell("=SUMME(A1)")).toBe("'=SUMME(A1)");
  expect(csvCell("+43 664")).toBe("'+43 664");
  expect(csvCell("Paula; Beispiel")).toBe("\"Paula; Beispiel\"");
  expect(csvCell("sagt \"hallo\"")).toBe("\"sagt \"\"hallo\"\"\"");
  expect(csvCell(null)).toBe("");
});

test("der Export enthält nur Kassier-Spalten, keine Bankdaten oder Schlüssel", () => {
  const csv = toCsv([{ invoice_ref: "FA2609-0001", source: { name: "Weihnachtsfeier" }, person: "=Paula", total_cents: 4000, currency: "EUR",
    payment_label: "teilweise bezahlt", paid_cents: 1000, credited_cents: 0, refunded_cents: 0, booking_state: "cancelled", synced_at: "2026-09-23T10:00:00+00:00",
    thirdparty_id: 42, invoice_id: 7, api_key: "geheim" }]);
  const [head, row] = csv.replace(String.fromCharCode(0xfeff), "").trim().split("\r\n");
  expect(head).toBe("Rechnung;Angebot;Person;Betrag;Zahlungsstand;Bezahlt;Gutgeschrieben;Erstattet;Buchung;Stand");
  expect(row).toBe("FA2609-0001;Weihnachtsfeier;'=Paula;40,00 €;teilweise bezahlt;10,00 €;0,00 €;0,00 €;storniert;2026-09-23T10:00:00+00:00");
  expect(csv).not.toContain("geheim");
  expect(csv).not.toContain("42");
  expect(csvFilename(new Date("2026-09-23T12:00:00Z"))).toBe("abrechnung-2026-09-23.csv");
});

test("Quellen werden einmal gelistet, die Summenzeile hat sechs getrennte Zahlen, der Stand nennt Fehler", () => {
  const sources = sourcesFrom([
    { source_id: "e1", kind: "event", source: { name: "Weihnachtsfeier" } },
    { source_id: "t1", kind: "tournament", source: { name: "Startgeld Herbst-Cup" } },
    { source_id: "e1", kind: "event", source: { name: "Weihnachtsfeier" } },
  ]);
  expect(sources.map((s) => s.id)).toEqual(["t1", "e1"]);
  expect(summaryLines({ booked_cents: 20000, invoiced_cents: 20000, paid_cents: 16000, open_cents: 4000, credited_cents: 2000, refunded_cents: 2000 }).map((l) => `${l.label} ${l.value}`))
    .toEqual(["gebucht 200,00 €", "fakturiert 200,00 €", "bezahlt 160,00 €", "offen 40,00 €", "gutgeschrieben 20,00 €", "erstattet 20,00 €"]);
  expect(summaryLines(null)).toEqual([]);
  expect(syncLine({ sync_error: "not_found", sync_error_text: "Nicht gefunden (404)" }).text).toContain("Nicht gefunden");
  expect(syncLine({}).text).toBe("noch nicht nachgelesen");
  expect(syncLine({ synced_at: "2026-09-23T10:00:00+00:00" }).text.startsWith("Stand ")).toBe(true);
});

test("wo Belege hängen (#842): Export mit Blick im Namen, die Tageszentrale in Worten, der dringendste Blick zuerst", () => {
  const day = new Date("2026-10-03T12:00:00Z");
  expect(csvFilename(day, "overdue")).toBe("abrechnung-überfällig-2026-10-03.csv");
  expect(csvFilename(day, "pdf_missing")).toBe("abrechnung-pdf-fehlt-2026-10-03.csv");
  expect(csvFilename(day, "irgendwas")).toBe("abrechnung-2026-10-03.csv");
  expect(attentionLine({ overdue: 3, pdf_missing: 1, draft_old: 2 })).toBe("3 überfällig · 1 ohne PDF · 2 Entwürfe älter als 7 Tage");
  expect(attentionLine({ overdue: 0, pdf_missing: 0, draft_old: 1 })).toBe("1 Entwurf älter als 7 Tage");
  expect(attentionLine({ overdue: 0, pdf_missing: 0, draft_old: 0 })).toBe("alles in Ordnung");
  expect(firstAttention({ overdue: 0, pdf_missing: 2, draft_old: 1 })).toBe("pdf_missing");
  expect(firstAttention(null)).toBe("");
});
