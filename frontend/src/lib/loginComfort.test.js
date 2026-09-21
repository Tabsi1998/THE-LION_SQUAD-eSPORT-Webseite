import { deviceLabel, dismissPasskeyOffer, readRemember, shouldOfferPasskey, writeRemember } from "./loginComfort";

// Bequem anmelden (#348): Haken und Passkey-Angebot merkt sich nur dieses Gerät.

beforeEach(() => window.localStorage.clear());

test("„Angemeldet bleiben“ ist der Standard und merkt sich die Wahl", () => {
  expect(readRemember()).toBe(true);
  writeRemember(false);
  expect(readRemember()).toBe(false);
  writeRemember(true);
  expect(readRemember()).toBe(true);
});

test("der Passkey wird nur angeboten, wenn es Sinn hat", () => {
  const base = { supported: true, enabled: true, passkeyCount: 0 };
  expect(shouldOfferPasskey(base)).toBe(true);
  expect(shouldOfferPasskey({ ...base, supported: false })).toBe(false);
  expect(shouldOfferPasskey({ ...base, enabled: false })).toBe(false);
  expect(shouldOfferPasskey({ ...base, passkeyCount: 1 })).toBe(false);
  expect(shouldOfferPasskey({ ...base, usedPasskey: true })).toBe(false);
});

test("„Später“ fragt nach 30 Tagen wieder, „Nicht mehr fragen“ nie", () => {
  const base = { supported: true, enabled: true, passkeyCount: 0 };
  const now = Date.UTC(2026, 8, 21);
  dismissPasskeyOffer("later", now);
  expect(shouldOfferPasskey(base, now + 29 * 24 * 3600 * 1000)).toBe(false);
  expect(shouldOfferPasskey(base, now + 31 * 24 * 3600 * 1000)).toBe(true);
  dismissPasskeyOffer("never", now);
  expect(shouldOfferPasskey(base, now + 400 * 24 * 3600 * 1000)).toBe(false);
});

test("der neue Passkey bekommt einen Namen, den man wiedererkennt", () => {
  expect(deviceLabel("Mozilla/5.0 (Linux; Android 15; SM-S921B)")).toBe("Android-Handy");
  expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("iPhone");
  expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Windows-PC");
  expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Mac");
  expect(deviceLabel("")).toBe("Mein Gerät");
});
