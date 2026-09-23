import { companionChangeHint, eventBasisLabel, eventOfferSummary, ownEventPriceLine, quoteTotal } from "./eventPrice";

// Kosten am Event in der App (#396): dieselbe Vorschau wie im Web - Person plus Begleitpersonen.

const OFFER = {
  enabled: true,
  currency: "EUR",
  positions: [
    { key: "beitrag", label: "Kostenbeitrag", amount_cents: 2000, basis: "per_person", optional: false },
    { key: "shirt", label: "Event-Shirt", amount_cents: 1500, basis: "per_registration", optional: true },
  ],
};

test("Summe: je Person mal Sitze, Shirt einmal je Anmeldung und nur mit Haken", () => {
  expect(quoteTotal(OFFER, 1)).toBe(2000);
  expect(quoteTotal(OFFER, 2)).toBe(4000);
  expect(quoteTotal(OFFER, 2, ["shirt"])).toBe(5500);
  expect(eventBasisLabel("per_person")).toBe("je Person");
  expect(eventBasisLabel("per_registration")).toBe("je Anmeldung");
});

test("Satz an der Anmeldung: mit Begleitpersonen die Summe dazu", () => {
  expect(eventOfferSummary(OFFER, 1)).toBe("20,00 € je Person");
  expect(eventOfferSummary(OFFER, 2)).toBe("20,00 € je Person · mit 1 Begleitperson 40,00 €");
  expect(eventOfferSummary(OFFER, 3)).toBe("20,00 € je Person · mit 2 Begleitpersonen 60,00 €");
  expect(eventOfferSummary({ ...OFFER, positions: [{ key: "p", label: "Pauschale", amount_cents: 5000, basis: "per_registration" }] }, 3)).toBe("50,00 € je Anmeldung · mit 2 Begleitpersonen 50,00 €");
  expect(eventOfferSummary({ enabled: false, positions: [] })).toBe("");
});

test("eigener Preis und Hinweis zur Änderung: vor und nach dem Beleg", () => {
  expect(ownEventPriceLine({ total_cents: 4000, billing_status: "pending" })).toBe("Dein Kostenbeitrag: 40,00 € · die Rechnung kommt in dein Konto unter „Meine Rechnungen“");
  expect(ownEventPriceLine({ total_cents: 4000, billing_status: "invoiced", invoice_ref: "FA2609-0007", invoice_status: "validated" })).toContain("Rechnung FA2609-0007 offen");
  expect(ownEventPriceLine({ total_cents: 4000, billing_status: "paid", invoice_ref: "FA2609-0007" })).toBe("Dein Kostenbeitrag: 40,00 € · Rechnung FA2609-0007 bezahlt – danke!");
  expect(ownEventPriceLine({ total_cents: 4000, billing_status: "cancelled" })).toContain("storniert");
  expect(ownEventPriceLine(null)).toBe("");
  expect(companionChangeHint({ total_cents: 4000, billing_status: "pending" })).toContain("abmelden und neu anmelden");
  expect(companionChangeHint({ total_cents: 4000, billing_status: "invoiced" })).toContain("Beleg besteht schon");
  expect(companionChangeHint(null)).toBe("");
});
