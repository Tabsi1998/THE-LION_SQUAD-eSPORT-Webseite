import { billingFormError, centsFromInput, formToBilling, formatCents, inputFromCents, offerSummary, positionsToForm, previewQuote } from "./pricing";

// Preis-Vorschau im Web (#315, #318): dieselben Regeln wie der Server, ganze Cent.

const OFFER = {
  enabled: true, currency: "EUR",
  positions: [
    { key: "beitrag", label: "Kostenbeitrag", amount_cents: 2000, basis: "per_person", optional: false },
    { key: "shirt", label: "Shirt", amount_cents: 1550, basis: "per_registration", optional: true },
  ],
};

test("Beträge: Text ↔ Cent, ohne Gleitkomma-Fehler", () => {
  expect(centsFromInput("20")).toBe(2000);
  expect(centsFromInput("20,50")).toBe(2050);
  expect(centsFromInput("0.1")).toBe(10);
  expect(centsFromInput("")).toBe(0);
  expect(centsFromInput("zwanzig")).toBeNull();
  expect(centsFromInput("1.234")).toBeNull();
  expect(inputFromCents(2050)).toBe("20,50");
  expect(formatCents(4000)).toBe("40,00 €");
});

test("Vorschau: je Person zählt Begleitpersonen, wählbare Positionen nur mit Haken", () => {
  expect(previewQuote(OFFER, { seats: 1 }).total_cents).toBe(2000);
  expect(previewQuote(OFFER, { seats: 2 }).total_cents).toBe(4000);
  expect(previewQuote(OFFER, { seats: 2, selected: ["shirt"] }).total_cents).toBe(5550);
  expect(previewQuote(null).free).toBe(true);
  expect(offerSummary(OFFER, 1)).toBe("20,00 € je Person");
  expect(offerSummary(OFFER, 2)).toBe("20,00 € je Person · mit 1 Begleitperson 40,00 €");
});

test("Formular ↔ Server und Fehlertexte vor dem Speichern", () => {
  const form = { enabled: true, invoice_timing: "manual", positions: positionsToForm({ positions: OFFER.positions }) };
  expect(form.positions[1].amount).toBe("15,50");
  const billing = formToBilling(form);
  expect(billing.positions[0]).toEqual({ key: "beitrag", label: "Kostenbeitrag", description: "", amount_cents: 2000, basis: "per_person", tax_profile: "none", optional: false, dolibarr_product_id: null });
  expect(billing.invoice_timing).toBe("manual");
  expect(billingFormError({ enabled: false, positions: [] })).toBe("");
  expect(billingFormError({ enabled: true, positions: [] })).toMatch(/keine Position/);
  expect(billingFormError({ enabled: true, positions: [{ label: "", amount: "1" }] })).toMatch(/Bezeichnung/);
  expect(billingFormError({ enabled: true, positions: [{ label: "x", amount: "abc" }] })).toMatch(/Betrag/);
  expect(billingFormError({ enabled: true, positions: [{ label: "x", amount: "1", optional: true }] })).toMatch(/Pflicht/);
  expect(billingFormError({ enabled: true, positions: [{ label: "x", amount: "1", dolibarr_product_id: "a1" }] })).toMatch(/Nummer/);
});
