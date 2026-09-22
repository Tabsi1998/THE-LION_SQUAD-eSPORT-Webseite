import { formatCents, ownPriceLine, quoteTotal, startFeeSummary } from "./startFee";

// Startgeld in der App (#319): dieselbe Vorschau wie im Web - Solo eine Person, Team der Roster.

const OFFER = {
  enabled: true,
  currency: "EUR",
  positions: [
    { key: "startgeld", label: "Startgeld", amount_cents: 1000, basis: "per_person", optional: false },
    { key: "shirt", label: "Shirt", amount_cents: 1550, basis: "per_registration", optional: true },
  ],
};

test("Summe: je Spieler mal Sitze, wählbare Positionen nur mit Haken", () => {
  expect(formatCents(1000)).toBe("10,00 €");
  expect(quoteTotal(OFFER, 1)).toBe(1000);
  expect(quoteTotal(OFFER, 5)).toBe(5000);
  expect(quoteTotal(OFFER, 5, ["shirt"])).toBe(6550);
  expect(quoteTotal(null)).toBe(0);
});

test("Satz am Turnier: Solo nur die Summe, Team mit Teamgröße", () => {
  expect(startFeeSummary(OFFER, "solo")).toBe("10,00 € Startgeld");
  expect(startFeeSummary(OFFER, "team", 5)).toBe("10,00 € je Spieler · Team mit 5 Spielern 50,00 €");
  expect(startFeeSummary({ ...OFFER, positions: [{ key: "s", label: "Startgeld", amount_cents: 5000, basis: "per_team" }] }, "team", 5)).toBe("50,00 € je Team");
  expect(startFeeSummary({ enabled: false, positions: [] })).toBe("");
});

test("eigener Preis: eingefroren, storniert oder bezahlt", () => {
  expect(ownPriceLine({ total_cents: 1000, billing_status: "pending" })).toBe("Dein Startgeld: 10,00 € · die Rechnung kommt in dein Konto");
  expect(ownPriceLine({ total_cents: 1000, billing_status: "cancelled" })).toContain("storniert");
  expect(ownPriceLine({ total_cents: 1000, billing_status: "paid", invoice_ref: "FA2609-0007" })).toBe("Dein Startgeld: 10,00 € · Rechnung FA2609-0007 bezahlt – danke!");
  expect(ownPriceLine({ total_cents: 1000, billing_status: "invoiced", invoice_ref: "FA2609-0007", invoice_status: "validated" })).toContain("offen");
  expect(ownPriceLine(null)).toBe("");
});
