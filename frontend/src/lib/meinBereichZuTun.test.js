import { zuTun } from "./meinBereichZuTun";

// „Zu tun“ (#2059): aus vorhandenen Daten, je Zeile ein Knopf in die passende Gruppe.

describe("Zu tun", () => {
  test("ohne Daten: nichts", () => {
    expect(zuTun()).toEqual([]);
    expect(zuTun({ invoices: { summary: { count: 3, open_count: 0 } } })).toEqual([]);
  });

  test("offene Rechnung mit Betrag; überfällig wird gelb", () => {
    const [item] = zuTun({ invoices: { currency: "EUR", summary: { open_count: 2, open_total: 40, overdue_count: 1 } } });
    expect(item.key).toBe("rechnung");
    expect(item.label).toBe("2 offene Rechnungen bezahlen");
    expect(item.detail).toMatch(/^2 offene Belege über €\s40,00, davon 1 überfällig\.$/);
    expect(item.tone).toBe("warn");
    expect(item.to).toBe("/mein-bereich/rechnungen");
    expect(zuTun({ invoices: { summary: { open_count: 1 } } })[0]).toMatchObject({ label: "Offene Rechnung bezahlen", tone: "brand" });
  });

  test("offener Beitrag nur, wenn keine offene Rechnung schon dasteht", () => {
    const membership = { dolibarr: { led_by_dolibarr: true, fee: { status: "due" } } };
    expect(zuTun({ membership }).map((item) => item.key)).toEqual(["beitrag"]);
    expect(zuTun({ membership, invoices: { summary: { open_count: 1 } } }).map((item) => item.key)).toEqual(["rechnung"]);
  });

  test("Einwilligung: nie beantwortet oder Text geändert - ein Widerruf ist eine Entscheidung", () => {
    const consents = { available: true, consents: [
      { code: "foto", label: "Fotos", state: "none", can_give: true },
      { code: "news", label: "Newsletter", state: "given", text_changed: true, can_give: true },
      { code: "daten", label: "Daten", state: "withdrawn", can_give: true },
      { code: "alt", label: "Alt", state: "none", can_give: false },
    ] };
    const [item] = zuTun({ consents });
    expect(item).toMatchObject({ key: "einwilligung", label: "2 Einwilligungen lesen", detail: "Fotos, Newsletter", to: "/mein-bereich/datenschutz?tab=einwilligungen" });
    expect(zuTun({ consents: { available: false, consents: [] } })).toEqual([]);
  });

  test("Nummer wählen nur, solange keine gewählt ist und gewählt werden darf", () => {
    expect(zuTun({ jersey: { available: true, can_choose: true, number: null } })[0]).toMatchObject({ key: "nummer", to: "/mein-bereich/mitgliedschaft#nummer" });
    expect(zuTun({ jersey: { available: true, can_choose: true, number: 7 } })).toEqual([]);
    expect(zuTun({ jersey: { available: true, can_choose: false, number: null } })).toEqual([]);
  });

  test("Versammlung, Abstimmung, Gewinne und Zwei-Faktor - Zwei-Faktor zuerst", () => {
    const items = zuTun({ area: { meetings_open: 1, ballots_open: 2 }, prizes: 1, secondFactor: true });
    expect(items.map((item) => item.key)).toEqual(["zweifaktor", "abstimmung", "versammlung", "gewinn"]);
    expect(items[1].label).toBe("2 Abstimmungen offen");
    expect(items[2].to).toBe("/mein-bereich/verein/versammlungen");
    expect(items[3]).toMatchObject({ label: "Gewinn abholen", to: "/mein-bereich/rechnungen?tab=gewinne" });
    expect(items[0].to).toBe("/mein-bereich/konto?mfa=required");
  });
});
