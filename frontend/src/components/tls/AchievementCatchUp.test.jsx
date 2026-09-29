import { act, render, waitFor } from "@testing-library/react";

// Erfolge als Zeremonie: beim ersten Besuch nichts (nur der Merker), beim nächsten die nachgeholten - und sobald der
// Server meldet, dass er gerade Stufen vergeben hat (#678, Saison-Signale), genau diese sofort, nie doppelt.

const apiMock = { get: vi.fn() };
const authState = { user: { id: "anna" } };
const ceremonies = [];
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/achievements/ceremony/queue", () => ({
  enqueueCeremony: (tiers, context, options) => {
    ceremonies.push({ codes: tiers.map((tier) => tier.code), context, options });
  },
}));

const { AWARDED_EVENT, AchievementCatchUp, earnedTiers } = await import("./AchievementCatchUp");

function tier(code, earnedAt, extra = {}) {
  return { code, name: code, material: "bronze", earned: Boolean(earnedAt), earned_at: earnedAt, ...extra };
}

function groups(...tiers) {
  return [
    { code: "bats", name: "Fledermausflüsterer", category: "community", tiers },
    { code: "late", name: "Zu spät", category: "negative", is_negative: true, tiers: [tier("late_1", "2026-10-30T20:00:00Z")] },
  ];
}

beforeEach(() => {
  localStorage.clear();
  ceremonies.length = 0;
  apiMock.get.mockReset();
  authState.user = { id: "anna" };
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

test("erreichte Stufen: die neueste zuerst, ohne Negatives, Stilles und Unerreichtes", () => {
  const list = earnedTiers(groups(tier("bats_1", "2026-10-28T10:00:00Z"), tier("bats_2", "2026-10-30T10:00:00Z"), tier("bats_3", null), tier("bats_s", "2026-10-31T10:00:00Z", { silent: true })));
  expect(list.map((t) => t.code)).toEqual(["bats_2", "bats_1"]);
  expect(list[0]).toMatchObject({ group_code: "bats", group_name: "Fledermausflüsterer", category: "community" });
  expect(earnedTiers()).toEqual([]);
});

test("erster Besuch: nur der Merker; beim nächsten Besuch die nachgeholten Stufen mit „Während du weg warst!“", async () => {
  apiMock.get.mockResolvedValue({ data: { groups: groups(tier("bats_1", "2026-10-28T10:00:00Z")) } });
  const first = render(<AchievementCatchUp />);
  await settle();
  expect(ceremonies).toEqual([]);
  expect(localStorage.getItem("tls_ach_seen:anna")).toBeTruthy();
  first.unmount();
  localStorage.setItem("tls_ach_seen:anna", "2026-10-29T00:00:00Z");
  apiMock.get.mockResolvedValue({ data: { groups: groups(tier("bats_1", "2026-10-28T10:00:00Z"), tier("bats_2", "2026-10-30T10:00:00Z")) } });
  render(<AchievementCatchUp />);
  await waitFor(() => expect(ceremonies).toHaveLength(1));
  expect(ceremonies[0].codes).toEqual(["bats_2"]);
  expect(ceremonies[0].context).toMatchObject({ catchUp: true, heading: "Während du weg warst!" });
  // Der Merker rückt erst vor, wenn die Zeremonie gezeigt wurde.
  expect(localStorage.getItem("tls_ach_seen:anna")).toBe("2026-10-29T00:00:00Z");
  ceremonies[0].options.onDone();
  expect(localStorage.getItem("tls_ach_seen:anna")).not.toBe("2026-10-29T00:00:00Z");
});

test("gerade vergeben: die neuesten Stufen nach der Zahl des Servers, sofort und nie doppelt - auch ohne Merker und bei falscher Uhr", async () => {
  apiMock.get.mockResolvedValue({ data: { groups: groups(tier("bats_1", "2026-10-28T10:00:00Z")) } });
  render(<AchievementCatchUp />);
  await settle();
  expect(apiMock.get).toHaveBeenCalledTimes(1);
  // Die Uhr des Geräts geht vor: der Merker liegt nach dem Zeitpunkt der Vergabe - die Zahl des Servers zählt trotzdem.
  localStorage.setItem("tls_ach_seen:anna", "2026-12-31T00:00:00Z");
  apiMock.get.mockResolvedValue({ data: { groups: groups(tier("bats_1", "2026-10-28T10:00:00Z"), tier("bats_2", "2026-10-30T19:00:05Z")) } });
  window.dispatchEvent(new CustomEvent(AWARDED_EVENT, { detail: { count: 1, source: "signal" } }));
  await waitFor(() => expect(ceremonies).toHaveLength(1));
  expect(ceremonies[0].codes).toEqual(["bats_2"]);
  expect(ceremonies[0].context.catchUp).toBeUndefined();
  // Dieselbe Stufe noch einmal gemeldet: keine zweite Feier.
  window.dispatchEvent(new CustomEvent(AWARDED_EVENT, { detail: { count: 1 } }));
  await settle();
  expect(ceremonies).toHaveLength(1);
  // Ohne Zahl oder mit null passiert nichts - und es wird auch nichts geladen.
  const calls = apiMock.get.mock.calls.length;
  window.dispatchEvent(new CustomEvent(AWARDED_EVENT, { detail: { count: 0 } }));
  window.dispatchEvent(new CustomEvent(AWARDED_EVENT));
  await settle();
  expect(apiMock.get.mock.calls.length).toBe(calls);
});

test("ohne Anmeldung hört niemand zu; ein Fehler beim Laden bleibt still", async () => {
  authState.user = null;
  const view = render(<AchievementCatchUp />);
  window.dispatchEvent(new CustomEvent(AWARDED_EVENT, { detail: { count: 1 } }));
  await settle();
  expect(apiMock.get).not.toHaveBeenCalled();
  view.unmount();
  authState.user = { id: "ben" };
  apiMock.get.mockRejectedValue(new Error("Netz weg"));
  render(<AchievementCatchUp />);
  window.dispatchEvent(new CustomEvent(AWARDED_EVENT, { detail: { count: 1 } }));
  await settle();
  expect(ceremonies).toEqual([]);
});
