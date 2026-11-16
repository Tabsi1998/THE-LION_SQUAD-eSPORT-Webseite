import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { CeremonyHost } from "./CeremonyHost";
import { createCeremonyQueue } from "./queue";
import { type CeremonyTier } from "./select";
import { STATE_TIMEOUT_MS, ceremonyState, importedKey, markSeen, resetCeremonySeen, serverCheck } from "./seen";

// Zeremonie einmal je Konto (#2450), wie im Web: jede Art des Schließens meldet „gesehen“ an den Server, vor dem
// Anzeigen fragt die App noch einmal, der Altbestand des Geräts geht einmalig an den Server. Ohne Server-Stand (ältere
// Fassung) bleibt alles wie bisher im Gerät.

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "anna" } }) }));
jest.mock("./sounds", () => ({
  playCeremonySound: async () => true,
  readCeremonySoundPrefs: async () => ({ muted: false, volume: 80 }),
  writeCeremonyMuted: async () => {},
}));
jest.mock("../../navigation/rootNavigation", () => ({ openTab: jest.fn() }));
const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock("../../lib/api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args), post: (...args: unknown[]) => mockPost(...args) }, responseFromCache: (response: { _fromCache?: boolean } | null) => Boolean(response?._fromCache) }));
const mockStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore[key] ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => { mockStore[key] = value; }),
}));

const tier = (code: string): CeremonyTier => ({ code, name: `Stufe ${code}`, material: "gold", rank: 5, category: "match", points: 10, group_name: "Gruppe" });
const serverState = (extra: Record<string, unknown> = {}) => ({ since: "2026-11-16T08:00:00+00:00", unseen: [], level: { level: 5, title: "", prestige: 0 }, recount_seen: [], ...extra });

function seenBodies() {
  return mockPost.mock.calls.filter(([path]) => path === "/achievements/me/ceremony/seen").map(([, body]) => body);
}

beforeEach(() => {
  jest.useFakeTimers();
  Object.keys(mockStore).forEach((key) => delete mockStore[key]);
  resetCeremonySeen();
  mockGet.mockReset();
  mockPost.mockReset();
  mockPost.mockResolvedValue({ data: serverState() });
});

afterEach(() => {
  jest.useRealTimers();
});

describe("Stand vom Server", () => {
  test("meldet den Altbestand des Geräts einmal, danach fragt die App nur noch", async () => {
    mockStore.tls_ach_seen_anna = "2026-11-01T10:00:00.000Z";
    mockStore.tls_level_seen_anna = JSON.stringify({ level: 7, title: "Jäger", prestige: 0 });
    mockPost.mockResolvedValue({ data: serverState({ unseen: ["a"] }) });
    mockGet.mockResolvedValue({ data: serverState() });
    expect(await ceremonyState("anna")).toEqual({ unseen: ["a"], level: { level: 5, title: "", prestige: 0 }, recountSeen: [] });
    expect(mockPost).toHaveBeenCalledWith("/achievements/me/ceremony/import", { seen_until: "2026-11-01T10:00:00.000Z", level: { level: 7, title: "Jäger", prestige: 0 } });
    await ceremonyState("anna");
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/achievements/me/ceremony");
  });

  test("älterer Server: null, kein Melden mehr - auch nicht der Altbestand", async () => {
    mockStore.tls_ach_seen_anna = "2026-11-01T10:00:00.000Z";
    mockGet.mockRejectedValue({ response: { status: 404 } });
    expect(await ceremonyState("anna")).toBeNull();
    expect(await ceremonyState("anna")).toBeNull();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockPost).not.toHaveBeenCalled();
    markSeen("anna", { codes: ["a"] });
    expect(seenBodies()).toEqual([]);
  });

  test("gesehen gilt sofort, auch bevor der Server es bestätigt", async () => {
    mockStore[importedKey("anna")] = "x";
    mockGet.mockResolvedValue({ data: serverState({ unseen: ["a", "b"] }) });
    markSeen("anna", { codes: ["a"], level: { level: 6, title: "Rudel", prestige: 0 } });
    expect(seenBodies()).toEqual([{ codes: ["a"], level: { level: 6, title: "Rudel", prestige: 0 } }]);
    expect(await ceremonyState("anna")).toEqual({ unseen: ["b"], level: { level: 6, title: "Rudel", prestige: 0 }, recountSeen: [] });
  });

  test("die Prüfung vor dem Anzeigen nimmt heraus, was ein anderes Gerät schon gesehen hat", async () => {
    mockStore[importedKey("anna")] = "x";
    mockGet.mockResolvedValue({ data: serverState({ unseen: ["b"], level: { level: 6, title: "", prestige: 0 } }) });
    const check = serverCheck("anna");
    expect(await check({ tiers: [tier("a"), tier("b")], levelUp: { level: 6, prestige: 0 } })).toEqual({ tiers: [tier("b")], levelUp: null });
    expect(await check({ tiers: [], levelUp: { level: 7, prestige: 0 } })).toEqual({ tiers: [], levelUp: { level: 7, prestige: 0 } });
  });
});

async function showSeen(codes = ["a"]) {
  const queue = createCeremonyQueue({ now: () => 0 });
  await render(<CeremonyHost queue={queue} />);
  await act(async () => {
    queue.enqueue({ id: "pkg", tiers: codes.map(tier), onDone: () => markSeen("anna", { codes }), check: serverCheck("anna") });
  });
  // Die Prüfung läuft über Promises.
  for (let step = 0; step < 5 && !screen.queryByTestId("achievement-unlock-overlay"); step += 1) await act(async () => { await Promise.resolve(); });
  return queue;
}

describe("jede Art des Schließens zählt als gesehen", () => {
  beforeEach(() => {
    mockStore[importedKey("anna")] = "x";
    mockGet.mockResolvedValue({ data: serverState({ unseen: ["a"] }) });
  });

  test("X oben rechts", async () => {
    const queue = await showSeen();
    await fireEvent.press(screen.getByTestId("achievement-unlock-close"));
    expect(seenBodies()).toEqual([{ codes: ["a"] }]);
    expect(queue.getCurrent()).toBeNull();
  });

  test("Tipp daneben", async () => {
    const queue = await showSeen();
    await fireEvent.press(screen.getByTestId("achievement-unlock-overlay"));
    expect(seenBodies()).toEqual([{ codes: ["a"] }]);
    expect(queue.getCurrent()).toBeNull();
  });

  test("Zurück-Taste (Android)", async () => {
    const queue = await showSeen();
    await fireEvent(screen.getByTestId("achievement-unlock-overlay"), "requestClose");
    expect(seenBodies()).toEqual([{ codes: ["a"] }]);
    expect(queue.getCurrent()).toBeNull();
  });

  test("Ablauf zu Ende", async () => {
    const queue = await showSeen();
    expect(seenBodies()).toEqual([]);
    await act(async () => { jest.advanceTimersByTime(20000); });
    expect(seenBodies()).toEqual([{ codes: ["a"] }]);
    expect(queue.getCurrent()).toBeNull();
  });
});

describe("Prüfung vor dem Anzeigen", () => {
  test("am Server schon gesehen: keine Zeremonie", async () => {
    mockStore[importedKey("anna")] = "x";
    mockGet.mockResolvedValue({ data: serverState({ unseen: [] }) });
    const queue = await showSeen(["a"]);
    expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
    expect(queue.getCurrent()).toBeNull();
  });

  test("ohne Server-Stand zeigt die App das Paket wie bisher", async () => {
    mockGet.mockRejectedValue({ response: { status: 404 } });
    await showSeen(["a"]);
    expect(screen.getByTestId("achievement-unlock-overlay")).toBeTruthy();
  });
});

test("zusammengelegte Pakete melden beide „gesehen“", () => {
  const queue = createCeremonyQueue({ now: () => 1 });
  const calls: string[] = [];
  queue.enqueue({ id: "laufend", tiers: [tier("x")] });
  queue.enqueue({ id: "eins", tiers: [tier("a")], onDone: () => calls.push("eins") });
  queue.enqueue({ id: "zwei", tiers: [tier("b")], onDone: () => calls.push("zwei") });
  queue.advance();
  queue.enqueue({ tiers: [], levelUp: { level: 3 }, onDone: () => calls.push("level") });
  queue.advance();
  expect(calls).toEqual(["eins", "zwei", "level"]);
});

test("hängt die Anfrage, kommt nach der Zeitgrenze null - die App zeigt das Paket wie bisher", async () => {
  mockStore[importedKey("anna")] = "x";
  mockGet.mockReturnValue(new Promise(() => {}));
  const queue = createCeremonyQueue({ now: () => 0 });
  await render(<CeremonyHost queue={queue} />);
  await act(async () => {
    queue.enqueue({ id: "pkg", tiers: [tier("a")], check: serverCheck("anna") });
  });
  expect(screen.queryByTestId("achievement-unlock-overlay")).toBeNull();
  await act(async () => { jest.advanceTimersByTime(STATE_TIMEOUT_MS); });
  for (let step = 0; step < 5 && !screen.queryByTestId("achievement-unlock-overlay"); step += 1) await act(async () => { await Promise.resolve(); });
  expect(screen.getByTestId("achievement-unlock-overlay")).toBeTruthy();
  // Die hängende Anfrage blockiert die nächste nicht.
  mockGet.mockResolvedValue({ data: serverState({ unseen: ["b"] }) });
  await expect(ceremonyState("anna")).resolves.toMatchObject({ unseen: ["b"] });
});

test("Stand am Server fehlt trotz Merker (z. B. nach einer Rücksicherung): die App meldet neu", async () => {
  mockStore[importedKey("anna")] = "2026-11-01T00:00:00.000Z";
  mockStore.tls_ach_seen_anna = "2026-11-10T10:00:00.000Z";
  mockGet.mockResolvedValue({ data: serverState({ since: null }) });
  mockPost.mockResolvedValue({ data: serverState({ unseen: ["a"] }) });
  await expect(ceremonyState("anna")).resolves.toMatchObject({ unseen: ["a"] });
  expect(mockPost).toHaveBeenCalledWith("/achievements/me/ceremony/import", { seen_until: "2026-11-10T10:00:00.000Z" });
  mockGet.mockResolvedValue({ data: serverState() });
  await ceremonyState("anna");
  expect(mockPost).toHaveBeenCalledTimes(1);
});

test("offline aus dem Zwischenspeicher: kein Stand - sonst gälte ein alter Stand als frisch", async () => {
  mockStore[importedKey("anna")] = "x";
  mockGet.mockResolvedValue({ data: serverState({ unseen: ["a"] }), _fromCache: true });
  await expect(ceremonyState("anna")).resolves.toBeNull();
  expect(mockPost).not.toHaveBeenCalled();
});

test("die Prüfung vor dem Anzeigen ändert nur Stufen und Level-up", () => {
  const queue = createCeremonyQueue({ now: () => 1 });
  const calls: string[] = [];
  queue.enqueue({ id: "pkg", tiers: [tier("a")], onDone: () => calls.push("done"), check: async () => null });
  queue.refine("pkg", { tiers: [tier("a")], levelUp: null, onDone: null, id: "fremd", context: { catchUp: true } } as never);
  expect(queue.getCurrent()).toMatchObject({ id: "pkg", checked: true, context: {} });
  queue.advance();
  expect(calls).toEqual(["done"]);
});

