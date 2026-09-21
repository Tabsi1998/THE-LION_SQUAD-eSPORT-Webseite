import { describeSync, feeCard, formatMoney } from "./dolibarr";

// Dolibarr (#295): was auf „Meine Mitgliedschaft“ und oben auf der Admin-Seite steht.

const view = (fee, extra = {}) => ({
  connected: true, led_by_dolibarr: true, as_of: "2026-09-21T10:00:00+00:00", stale: false, paid_until: "2026-12-31", membership_ends: null,
  fee: { required: true, status: "paid", next_due: "2027-01-01", amount: 50, currency: "EUR", discount: { kind: "none", label: "" }, payer: "self", ...fee },
  ...extra,
});

test("ohne Dolibarr-Führung gibt es keine Beitragskarte", () => {
  expect(feeCard(null)).toBeNull();
  expect(feeCard({ connected: true, led_by_dolibarr: false })).toBeNull();
});

test("bezahlt, fällig, Familie und Austritt stehen in ganzen Sätzen", () => {
  const paid = feeCard(view());
  expect(paid.label).toBe("bezahlt");
  expect(paid.tone).toBe("ok");
  expect(paid.lines).toEqual(["Bezahlt bis 31.12.2026", "Nächster Beitrag ab 1.1.2027"]);

  const due = feeCard(view({ status: "due", next_due: "2026-01-01" }, { paid_until: "2025-12-31" }));
  expect(due.tone).toBe("warn");
  expect(due.lines).toContain("Nächster Beitrag seit 1.1.2026 offen");

  const family = feeCard(view({ status: "invoiced", payer: "other", discount: { kind: "age", label: "Jugend" } }, { membership_ends: "2026-12-31" }));
  expect(family.tone).toBe("info");
  expect(family.lines).toContain("Den Beitrag zahlt eine andere Person für dich (z. B. Familie).");
  expect(family.lines).toContain("Ermäßigung: Jugend");
  expect(family.lines).toContain("Mitgliedschaft endet am 31.12.2026");

  expect(feeCard(view({ required: false, status: "not_required", amount: null })).amount).toBeNull();
});

test("Beträge in Euro, ohne Betrag ein Strich", () => {
  expect(formatMoney(50, "EUR")).toMatch(/50,00/);
  expect(formatMoney(null)).toBe("–");
});

test("der letzte Abgleich sagt, was war", () => {
  expect(describeSync(null, "off").text).toBe("Anbindung ist aus.");
  expect(describeSync({}, "preview").tone).toBe("warn");
  const broken = describeSync({ last_run_at: "x", ok: false, last_error: { text: "Dolibarr ist nicht erreichbar" } }, "live");
  expect(broken.tone).toBe("danger");
  expect(broken.text).toBe("Dolibarr ist nicht erreichbar, noch nie gelungen");
  const fine = describeSync({ last_run_at: "x", last_ok_at: "2026-09-21T10:00:00+00:00", ok: true, applied_live: true, was_full: true, counts: { seen: 40, applied: 3 } }, "live");
  expect(fine.tone).toBe("ok");
  expect(fine.text).toMatch(/40 gelesen, 3 übernommen · vollständig/);
  expect(describeSync({ last_run_at: "x", last_ok_at: "2026-09-21T10:00:00+00:00", ok: true, applied_live: false, counts: { seen: 40 } }, "preview").text).toMatch(/nichts übernommen \(Vorschau\)/);
});
