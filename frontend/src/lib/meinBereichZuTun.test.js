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

  test("offener Beitrag nur, wenn keine offene Rechnung schon dasteht - ohne doppeltes „offen“ im Text", () => {
    const membership = { dolibarr: { led_by_dolibarr: true, fee: { status: "due" } } };
    expect(zuTun({ membership }).map((item) => item.key)).toEqual(["beitrag"]);
    const [beitrag] = zuTun({ membership });
    expect(`${beitrag.label} ${beitrag.detail}`.match(/offen/g)).toHaveLength(1);
    expect(zuTun({ membership, invoices: { summary: { open_count: 1 } } }).map((item) => item.key)).toEqual(["rechnung"]);
  });

  test("Einwilligung: nur eine erteilte, deren Text sich geändert hat - die deckt den neuen Text nicht (Prüfung #2059)", () => {
    // Wie der Server (membership_routes._consent_view): text_changed nur bei state given und alter Fassung.
    const consents = { available: true, consents: [
      { code: "fotos", label: "Fotos auf der Website", state: "given", version: 1, current_version: 2, can_give: true, can_withdraw: true, text_changed: true },
      { code: "newsletter", label: "Newsletter", state: "none", version: 0, current_version: 1, can_give: true, can_withdraw: false, text_changed: false },
      { code: "statuten", label: "Statuten", state: "withdrawn", version: 1, current_version: 1, can_give: true, can_withdraw: false, text_changed: false },
      { code: "daten", label: "Datenverarbeitung", state: "given", version: 3, current_version: 3, can_give: false, can_withdraw: true, text_changed: false },
    ] };
    const [item, ...rest] = zuTun({ consents });
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ key: "einwilligung", gruppe: "datenschutz", anzahl: 1, label: "Einwilligung geändert – bitte neu lesen", detail: "Fotos auf der Website", to: "/mein-bereich/datenschutz?tab=einwilligungen" });
    // Zwei geänderte: die Zahl steht vorn.
    const zwei = { available: true, consents: [consents.consents[0], { ...consents.consents[0], code: "chat", label: "Chat-Verlauf" }] };
    expect(zuTun({ consents: zwei })[0]).toMatchObject({ anzahl: 2, label: "2 Einwilligungen geändert – bitte neu lesen", detail: "Fotos auf der Website, Chat-Verlauf" });
    // Nie beantwortete oder widerrufene freiwillige Einwilligungen bleiben draußen - auch mit Feldern, die der Server nicht schickt.
    expect(zuTun({ consents: { available: true, consents: [{ ...consents.consents[1], required: true }, consents.consents[2]] } })).toEqual([]);
    expect(zuTun({ consents: { available: false, consents: consents.consents } })).toEqual([]);
  });

  test("Nummer wählen nur, solange keine gewählt ist und gewählt werden darf", () => {
    expect(zuTun({ jersey: { available: true, can_choose: true, number: null } })[0]).toMatchObject({ key: "nummer", to: "/mein-bereich/mitgliedschaft#nummer" });
    expect(zuTun({ jersey: { available: true, can_choose: true, number: 7 } })).toEqual([]);
    expect(zuTun({ jersey: { available: true, can_choose: false, number: null } })).toEqual([]);
  });

  test("Versammlung und Abstimmung: meetings_open zählt die Abstimmungen schon mit (member_area.py) - nichts doppelt", () => {
    // Wie der Server: 1 offene Einladung und 2 Abstimmungen ergeben meetings_open 3.
    const items = zuTun({ area: { meetings_open: 3, ballots_open: 2 }, prizes: 1, secondFactor: true });
    expect(items.map((item) => item.key)).toEqual(["zweifaktor", "abstimmung", "versammlung", "gewinn"]);
    expect(items[1]).toMatchObject({ label: "2 Abstimmungen offen", anzahl: 2 });
    expect(items[2]).toMatchObject({ detail: "Eine Einladung wartet auf deine Antwort.", anzahl: 1, to: "/mein-bereich/verein/versammlungen" });
    // Zusammen so viele wie die Sprungleiste („Versammlung · 3 offen“).
    expect(items.filter((item) => item.gruppe === "verein").reduce((sum, item) => sum + item.anzahl, 0)).toBe(3);
    expect(items[3]).toMatchObject({ label: "Gewinn abholen", to: "/mein-bereich/rechnungen?tab=gewinne" });
    expect(items[0].to).toBe("/mein-bereich/konto?mfa=required");
  });

  test("nur eine Abstimmung offen: ein Eintrag, nicht zwei", () => {
    const items = zuTun({ area: { meetings_open: 1, ballots_open: 1 } });
    expect(items.map((item) => item.key)).toEqual(["abstimmung"]);
    expect(items[0]).toMatchObject({ label: "Abstimmung offen", anzahl: 1 });
  });
});

// Nur Änderungen, die „Zu tun“ betreffen, laden nach (Prüfung #2059): eine öffentliche Fast-Lap-Änderung zählt über den
// Alias f1 → prizes auch als „prizes“, ändert aber keine eigenen Gewinne.
test("Nachladen: Rechnungen, Mitgliedschaft und eigene Gewinne ja, Fast Lap nein", async () => {
  const { zuTunNachladen } = await import("./meinBereichZuTun");
  expect(zuTunNachladen({ path: "f1/challenges/c-1", resource: "f1" })).toBe(false);
  expect(zuTunNachladen({ path: "fastlap/monza", resource: "fastlap" })).toBe(false);
  expect(zuTunNachladen({ path: "prizes/p-1", resource: "prizes" })).toBe(true);
  expect(zuTunNachladen({ path: "account/invoices", resource: "account" })).toBe(true);
  expect(zuTunNachladen(undefined)).toBe(true);
});
