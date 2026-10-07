import { cardChanged, cardSnapshot, clearOfflineCard, loadOfflineCard, offlineCardOwner, saveOfflineCard, standLine, STORAGE_KEY } from "./memberCardOffline";

// Mitgliedskarte offline (#1256): gespeichert wird nur, was auf der Karte steht - nie der Prüfcode; je Konto; ohne
// Browser-Speicher für diesen Besuch; Abmelden löscht.

const CARD = {
  status: "valid", club_name: "THE LION SQUAD", name: "LunaByte", member_number: "TLS-031", type_label: "Ordentliches Mitglied",
  member_since: "2024-03-01", valid_until: "2026-12-31", verify_url: "https://lionsquad.at/karte/pruefen/geheim", token_expires_at: "2026-10-07T16:10:00Z",
};

afterEach(async () => {
  vi.restoreAllMocks();
  await clearOfflineCard();
});

test("nur die sichtbaren Felder, nie Prüfcode oder Prüfadresse", () => {
  const snapshot = cardSnapshot(CARD, "u1", new Date("2026-10-07T16:05:00Z"));
  expect(snapshot).toEqual({ user_id: "u1", saved_at: "2026-10-07T16:05:00.000Z", name: "LunaByte", member_number: "TLS-031", type_label: "Ordentliches Mitglied",
    member_since: "2024-03-01", valid_until: "2026-12-31", club_name: "THE LION SQUAD" });
  saveOfflineCard("u1", CARD);
  const raw = window.localStorage.getItem(STORAGE_KEY);
  expect(raw).not.toContain("geheim");
  expect(raw).not.toContain("token");
});

test("je Konto: ein anderes Konto sieht die Karte nicht; Abmelden löscht", async () => {
  saveOfflineCard("u1", CARD);
  expect(loadOfflineCard("u1").name).toBe("LunaByte");
  expect(loadOfflineCard("u2")).toBeNull();
  expect(offlineCardOwner()).toBe("u1");
  await clearOfflineCard();
  expect(loadOfflineCard("u1")).toBeNull();
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  // Ungültige Karten werden nicht gespeichert.
  expect(saveOfflineCard("u1", { status: "none" })).toBeNull();
});

test("ohne Browser-Speicher gilt die Karte für diesen Besuch", () => {
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("voll"); });
  vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => { throw new Error("gesperrt"); });
  saveOfflineCard("u1", CARD);
  expect(loadOfflineCard("u1").member_number).toBe("TLS-031");
});

test("ein neues Bild nur bei geänderter Karte; Stand in Wiener Zeit", () => {
  const snapshot = cardSnapshot(CARD, "u1", new Date("2026-10-07T16:05:00Z"));
  expect(cardChanged(null, snapshot)).toBe(true);
  expect(cardChanged(snapshot, { ...CARD, verify_url: "anders" })).toBe(false);
  expect(cardChanged(snapshot, { ...CARD, type_label: "Ehrenmitglied" })).toBe(true);
  expect(standLine(snapshot)).toBe("Stand: 7.10.2026, 18:05");
  expect(standLine({})).toBe("");
});
