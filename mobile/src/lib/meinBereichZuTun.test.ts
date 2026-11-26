import { targetFromUrl } from "../navigation/rootNavigation";
import { brauchtZweiFaktor, zuTun } from "./meinBereichZuTun";

// „Zu tun“ (#2059): dieselben Regeln wie im Web (frontend/src/lib/meinBereichZuTun.test.js) - nur Pflichtiges, je Zeile
// ein Knopf in die passende Gruppe, und jede Adresse öffnet in der App ihren Screen.

describe("Zu tun", () => {
  test("ohne Daten: nichts", () => {
    expect(zuTun()).toEqual([]);
    expect(zuTun({ invoices: { summary: { open_count: 0 } } })).toEqual([]);
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
    const membership = { dolibarr: { led_by_dolibarr: true, fee: { status: "due" } } } as never;
    expect(zuTun({ membership }).map((item) => item.key)).toEqual(["beitrag"]);
    const [beitrag] = zuTun({ membership });
    expect(`${beitrag.label} ${beitrag.detail}`.match(/offen/g)).toHaveLength(1);
    expect(zuTun({ membership, invoices: { summary: { open_count: 1 } } }).map((item) => item.key)).toEqual(["rechnung"]);
  });

  test("Einwilligung: nur eine erteilte, deren Text sich geändert hat (Entscheidung 26.11.)", () => {
    const consents = { available: true, consents: [
      { code: "fotos", label: "Fotos auf der Website", state: "given" as const, version: 1, current_version: 2, can_give: true, can_withdraw: true, text_changed: true },
      { code: "newsletter", label: "Newsletter", state: "none" as const, version: 0, current_version: 1, can_give: true, can_withdraw: false, text_changed: false },
      { code: "statuten", label: "Statuten", state: "withdrawn" as const, version: 1, current_version: 1, can_give: true, can_withdraw: false, text_changed: false },
      { code: "daten", label: "Datenverarbeitung", state: "given" as const, version: 3, current_version: 3, can_give: false, can_withdraw: true, text_changed: false },
    ] };
    const [item, ...rest] = zuTun({ consents });
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ key: "einwilligung", gruppe: "datenschutz", anzahl: 1, label: "Einwilligung geändert – bitte neu lesen", detail: "Fotos auf der Website", to: "/mein-bereich/datenschutz?tab=einwilligungen" });
    const zwei = { available: true, consents: [consents.consents[0], { ...consents.consents[0], code: "chat", label: "Chat-Verlauf" }] };
    expect(zuTun({ consents: zwei })[0]).toMatchObject({ anzahl: 2, label: "2 Einwilligungen geändert – bitte neu lesen", detail: "Fotos auf der Website, Chat-Verlauf" });
    // Nie beantwortete oder widerrufene freiwillige Einwilligungen bleiben draußen.
    expect(zuTun({ consents: { available: true, consents: [consents.consents[1], consents.consents[2]] } })).toEqual([]);
    expect(zuTun({ consents: { available: false, consents: consents.consents } })).toEqual([]);
  });

  test("Nummer wählen nur, solange keine gewählt ist und gewählt werden darf", () => {
    expect(zuTun({ jersey: { available: true, can_choose: true, number: null } })[0]).toMatchObject({ key: "nummer", to: "/mein-bereich/mitgliedschaft#nummer" });
    expect(zuTun({ jersey: { available: true, can_choose: true, number: 7 } })).toEqual([]);
    expect(zuTun({ jersey: { available: true, can_choose: false, number: null } })).toEqual([]);
  });

  test("Versammlung und Abstimmung: meetings_open zählt die Abstimmungen schon mit - nichts doppelt", () => {
    const items = zuTun({ area: { meetings_open: 3, ballots_open: 2 }, prizes: 1, secondFactor: true });
    expect(items.map((item) => item.key)).toEqual(["zweifaktor", "abstimmung", "versammlung", "gewinn"]);
    expect(items[1]).toMatchObject({ label: "2 Abstimmungen offen", anzahl: 2 });
    expect(items[2]).toMatchObject({ detail: "Eine Einladung wartet auf deine Antwort.", anzahl: 1, to: "/mein-bereich/verein/versammlungen" });
    expect(items.filter((item) => item.gruppe === "verein").reduce((sum, item) => sum + item.anzahl, 0)).toBe(3);
    expect(items[3]).toMatchObject({ label: "Gewinn abholen", to: "/mein-bereich/rechnungen?tab=gewinne" });
    expect(items[0].to).toBe("/mein-bereich/konto?mfa=required");
  });

  test("nur eine Abstimmung offen: ein Eintrag, nicht zwei", () => {
    const items = zuTun({ area: { meetings_open: 1, ballots_open: 1 } });
    expect(items.map((item) => item.key)).toEqual(["abstimmung"]);
    expect(items[0]).toMatchObject({ label: "Abstimmung offen", anzahl: 1 });
  });

  test("jede Zeile öffnet in der App ihren Screen", () => {
    const items = zuTun({
      invoices: { summary: { open_count: 1 } },
      consents: { available: true, consents: [{ code: "x", label: "X", state: "given", can_give: true, text_changed: true }] },
      jersey: { available: true, can_choose: true, number: null },
      area: { meetings_open: 2, ballots_open: 1 },
      prizes: 2,
      secondFactor: true,
    });
    expect(items).toHaveLength(7);
    const screens = items.map((item) => [item.key, (targetFromUrl(item.to) as { screen?: string } | null)?.screen]);
    expect(screens).toEqual([
      ["zweifaktor", "MeinBereichGruppe"],
      ["rechnung", "MyInvoices"],
      ["einwilligung", "MeinBereichGruppe"],
      ["nummer", "MyMembership"],
      ["abstimmung", "MemberMeetings"],
      ["versammlung", "MemberMeetings"],
      ["gewinn", "MyPrizes"],
    ]);
  });
});

test("Zwei-Faktor: nur mit einem Bereich der Verwaltung und ohne bestätigte Zwei-Faktor-Anmeldung", () => {
  expect(brauchtZweiFaktor(null)).toBe(false);
  expect(brauchtZweiFaktor({ areas: [] })).toBe(false);
  expect(brauchtZweiFaktor({ areas: ["moderation"] })).toBe(false);
  expect(brauchtZweiFaktor({ areas: ["club"] })).toBe(true);
  expect(brauchtZweiFaktor({ areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: false })).toBe(true);
  expect(brauchtZweiFaktor({ areas: ["tournaments"], mfa_enabled: true, auth_mfa_verified: true })).toBe(false);
});
