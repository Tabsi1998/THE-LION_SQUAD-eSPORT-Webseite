import { PAYMENT_TONE, attentionLine, csvFilename, firstAttention, formatCents, parseEuro, shownOf, sourceName, sourcesFrom, summaryLines, syncLine } from "./billing";

// Finanzübersicht (#321, #322): Beträge, Eingaben, Quellen und der Name des Exports (die Datei selbst baut der Server).

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

test("der Dateiname nennt Blick und Zeitraum, die Liste sagt N von M (#2131)", () => {
  expect(csvFilename(new Date("2026-09-23T12:00:00Z"))).toBe("abrechnung-2026-09-23.csv");
  expect(csvFilename(new Date("2026-09-23T12:00:00Z"), "", { from: "2026-01-01", to: "2026-12-31" })).toBe("abrechnung-2026-01-01-bis-2026-12-31.csv");
  expect(csvFilename(new Date("2026-09-23T12:00:00Z"), "overdue", { from: "2026-01-01" })).toBe("abrechnung-überfällig-2026-01-01.csv");
  expect(shownOf(250, 1234)).toBe(`250 von ${(1234).toLocaleString("de-AT")}`);
  expect(shownOf(3)).toBe("3 von 3");
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
  expect(syncLine({ sync_error: "unavailable", sync_error_text: "Dolibarr antwortet nicht" }).text).toBe("Dolibarr nicht lesbar: Dolibarr antwortet nicht");
  expect(syncLine({}).text).toBe("noch nicht nachgelesen");
  expect(syncLine({ synced_at: "2026-09-23T10:00:00+00:00" }).text.startsWith("Stand ")).toBe(true);
});

test("bezahlt mit Abzug (#2226): eigene Farbe wie bezahlt, „erlassen“ nur in den Summen, wenn etwas erlassen wurde", () => {
  expect(PAYMENT_TONE.paid_reduced).toBe(PAYMENT_TONE.paid);
  const lines = summaryLines({ booked_cents: 4000, invoiced_cents: 4000, paid_cents: 2000, open_cents: 0, credited_cents: 0, waived_cents: 2000, refunded_cents: 0 });
  expect(lines.map((l) => `${l.label} ${l.value}`)).toContain("erlassen 20,00 €");
  expect(lines).toHaveLength(7);
  expect(summaryLines({ paid_cents: 100, waived_cents: 0 }).map((l) => l.key)).not.toContain("waived_cents");
});

test("nie eine interne Kennung als Angebotsname (#2226), ein fehlender Beleg sagt, wo es weitergeht", () => {
  expect(sourceName({ source: { name: "Weihnachtsfeier" }, source_id: "e1" })).toBe("Weihnachtsfeier");
  expect(sourceName({ source: null, source_id: "ev-1234" })).toBe("Angebot nicht mehr vorhanden");
  expect(sourcesFrom([{ source_id: "ev-1234", kind: "event" }]).map((s) => s.name)).toEqual(["Angebot nicht mehr vorhanden"]);
  const gone = syncLine({ sync_error: "not_found", sync_error_text: "Nicht gefunden (404)" });
  expect(gone.text).toBe("In Dolibarr nicht mehr gefunden – siehe Prüffall");
  expect(gone.text).not.toContain("404");
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
