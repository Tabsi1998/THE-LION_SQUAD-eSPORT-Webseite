import * as SecureStore from "expo-secure-store";
import { cardFace, clearOfflineCard, loadOfflineCard, saveOfflineCard, standLine } from "./memberCardOffline";

// Die Mitgliedskarte ohne Netz (#1256): gespeichert wird nur, was auf der Karte steht - nie Prüfcode oder Prüflink -,
// nur für das eigene Konto; Abmelden löscht sie.

const card = {
  status: "valid" as const, club_name: "Beispielverein", name: "Paula", member_number: "TLS-0007", type_label: "Ordentliches Mitglied",
  member_since: "2024-03-01", valid_until: "2026-12-31", verify_url: "https://example.test/karte/pruefen/abcDEF123456xyz0",
  token_expires_at: "2026-10-07T16:10:00Z", accent_color: "#FFD700",
};

beforeEach(async () => {
  await clearOfflineCard();
});

test("nur die Vorderseite der Karte - ohne Prüfcode und Prüflink", async () => {
  expect(cardFace(card)).toEqual({ club_name: "Beispielverein", name: "Paula", member_number: "TLS-0007", type_label: "Ordentliches Mitglied", member_since: "2024-03-01", valid_until: "2026-12-31" });
  expect(cardFace({ status: "none", club_name: "Beispielverein" })).toBeNull();

  await saveOfflineCard("u-1", card, new Date("2026-10-07T16:05:00Z"));
  const raw = String(await SecureStore.getItemAsync("tls.member-card"));
  expect(raw).not.toContain("pruefen");
  expect(raw).not.toContain("abcDEF123456xyz0");
  expect(raw).not.toContain("token_expires_at");
});

test("nur für das eigene Konto; Abmelden löscht sie", async () => {
  await saveOfflineCard("u-1", card, new Date("2026-10-07T16:05:00Z"));
  const stored = await loadOfflineCard("u-1");
  expect(stored?.card.name).toBe("Paula");
  expect(stored?.saved_at).toBe("2026-10-07T16:05:00.000Z");
  expect(await loadOfflineCard("u-2")).toBeNull();
  expect(await loadOfflineCard("")).toBeNull();

  await clearOfflineCard();
  expect(await loadOfflineCard("u-1")).toBeNull();
});

test("ohne Konto oder ohne gültige Karte wird nichts gespeichert; „Stand“ in Wiener Zeit", async () => {
  await saveOfflineCard("", card);
  await saveOfflineCard("u-1", { status: "ended", club_name: "Beispielverein" });
  expect(await SecureStore.getItemAsync("tls.member-card")).toBeNull();
  expect(standLine("2026-10-07T16:05:00Z")).toBe("Stand: 07.10.2026, 18:05");
  expect(standLine(null)).toBe("");
});
