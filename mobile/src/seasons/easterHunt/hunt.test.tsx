import React from "react";
import { Alert, View } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

// Ostereiersuche in der App (#647): die Bühne lädt die Eier des Screens und verteilt sie auf seine Karten; jede Karte
// zeigt ihre Eier. Antippen: Gäste werden eingeladen, angemeldet zählt der Fund (Haptik, Ansage, das Ei ist weg, der
// Stand im Kopf zählt mit), das letzte Ei füllt den Korb; zu schnell und abgelaufene Schlüssel werden freundlich
// behandelt. Die Oster-Deko legt während einer laufenden Suche Blumen statt Eier an die Begrüßungskarte.

const mockSeasonState: Record<string, unknown> = { ready: true, seasons: [], byKey: {}, preference: "on", setPreference: jest.fn(async () => {}), reducedMotion: true, reload: jest.fn(), toast: null, showToast: jest.fn(), weather: null };
jest.mock("../SeasonProvider", () => ({ useSeason: () => mockSeasonState }));
const mockAuth: { user: Record<string, unknown> | null; logout: jest.Mock } = { user: null, logout: jest.fn(async () => {}) };
jest.mock("../../auth/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }) }));
const mockNavigate = jest.fn();
jest.mock("../../navigation/rootNavigation", () => ({ navigationRef: { isReady: () => true, navigate: (...args: unknown[]) => mockNavigate(...args), getCurrentRoute: () => ({ name: "Dashboard" }), addListener: () => () => {} } }));
jest.mock("@react-navigation/native", () => {
  const actual = jest.requireActual("@react-navigation/native");
  return { ...actual, useNavigation: () => ({ navigate: (...args: unknown[]) => mockNavigate(...args) }) };
});
const mockApi = { fetchEggs: jest.fn(), findEgg: jest.fn(), fetchBasket: jest.fn() };
jest.mock("./api", () => {
  const actual = jest.requireActual("./api");
  return {
    ...actual,
    fetchEggs: (...args: unknown[]) => mockApi.fetchEggs(...args),
    findEgg: (...args: unknown[]) => mockApi.findEgg(...args),
    fetchBasket: (...args: unknown[]) => mockApi.fetchBasket(...args),
  };
});

const { HuntStage, HuntWidget, huntRoute } = require("./index");
const { HuntEggView } = require("./HuntEgg");
const { emitHuntProgress, reportHuntActive, resetHuntActive } = require("./api");
const { clearHunt, huntState, setHuntSpots } = require("./store");
const { registerPerch, resetPerches } = require("../perches");
const { SeasonPerch } = require("../anchors");
const { EasterEdge } = require("../easter");

const SEASON = { key: "easter_hunt", label: "Ostereiersuche", phase: "suche", intensity: "normal", effective: "normal", channels: ["web", "app"], texts: {}, data: {}, starts_at: "2027-03-26T00:00:00+01:00", ends_at: "2027-03-29T23:59:59+02:00", forced: false };
const EGGS = { active: true, total: 12, guest: false, eggs: [
  { egg_no: 3, token: "3.aaa", spot: { kind: "card", index: 0, place: "top-right" }, pattern: "lion", found: false },
  { egg_no: 5, token: "5.bbb", spot: { kind: "card", index: 1, place: "bottom-left" }, pattern: "dots", found: false },
  { egg_no: 7, token: "7.ccc", spot: { kind: "card", index: 0, place: "top-left" }, pattern: "waves", found: true },
] };

async function flush(ms = 400) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockAuth.user = { id: "u1", username: "anna" };
  mockSeasonState.byKey = {};
  (mockSeasonState.showToast as jest.Mock).mockClear();
  mockNavigate.mockClear();
  Object.values(mockApi).forEach((fn) => fn.mockReset());
  (Haptics.notificationAsync as jest.Mock).mockClear?.();
  resetPerches();
  clearHunt();
  resetHuntActive();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("die Screens mit Verstecken heißen beim Server wie im Admin", () => {
  expect(huntRoute("Dashboard")).toBe("app:Dashboard");
  expect(huntRoute("TournamentList")).toBe("app:Tournaments");
  expect(huntRoute("MoreHub")).toBe("app:More");
  expect(huntRoute("DirectThread")).toBeNull();
});

test("die Bühne lädt die Eier des Screens und legt die ungefundenen an seine Karten", async () => {
  mockApi.fetchEggs.mockResolvedValue(EGGS);
  registerPerch({ id: "c1", screen: "Dashboard", kind: "card", measure: async () => ({ x: 16, y: 200, width: 360, height: 120 }) });
  registerPerch({ id: "c2", screen: "Dashboard", kind: "card", measure: async () => ({ x: 16, y: 360, width: 360, height: 120 }) });
  await render(<HuntStage season={SEASON} screen="Dashboard" />);
  await flush();
  expect(mockApi.fetchEggs).toHaveBeenCalledWith("app:Dashboard");
  const spots = huntState().spots.map((spot: { egg: { egg_no: number }; perchId: string; corner: string }) => `${spot.egg.egg_no}@${spot.perchId}:${spot.corner}`);
  expect(spots).toEqual(["3@c1:tr", "5@c2:bl"]);
  expect(huntState().route).toBe("app:Dashboard");
});

test("eine Karte zeigt ihre Eier - als Knopf „Osterei einsammeln“", async () => {
  setHuntSpots({ screen: "Dashboard", route: "app:Dashboard", spots: [{ egg: EGGS.eggs[0], perchId: "card-a", corner: "tr" }], guest: false, total: 12 });
  await render(<View><SeasonPerch id="card-a" /></View>);
  const egg = screen.getByTestId("hunt-egg-3");
  expect(egg.props.accessibilityLabel).toBe("Osterei einsammeln");
});

test("Gäste werden zum Anmelden eingeladen - gezählt wird nichts", async () => {
  mockAuth.user = { id: "live-public-guest" };
  setHuntSpots({ screen: "Dashboard", route: "app:Dashboard", spots: [{ egg: EGGS.eggs[0], perchId: "card-a", corner: "tr" }], guest: true, total: 12 });
  await render(<HuntEggView spot={huntState().spots[0]} />);
  await fireEvent.press(screen.getByTestId("hunt-egg-3"));
  expect(Alert.alert).toHaveBeenCalledWith("Ostereiersuche", expect.stringContaining("Melde dich an"), expect.any(Array));
  expect(mockApi.findEgg).not.toHaveBeenCalled();
});

test("angemeldet zählt der Fund: Haptik, Ansage, Stand für das Widget, das Ei ist weg", async () => {
  mockApi.findEgg.mockResolvedValue({ found: 4, total: 12, already: false, completed_now: false });
  const progress = jest.fn();
  const { onHuntProgress } = require("./api");
  const stop = onHuntProgress(progress);
  setHuntSpots({ screen: "Dashboard", route: "app:Dashboard", spots: [{ egg: EGGS.eggs[0], perchId: "card-a", corner: "tr" }], guest: false, total: 12 });
  await render(<HuntEggView spot={huntState().spots[0]} />);
  await fireEvent.press(screen.getByTestId("hunt-egg-3"));
  await flush(0);
  expect(mockApi.findEgg).toHaveBeenCalledWith("3.aaa");
  expect(Haptics.notificationAsync).toHaveBeenCalled();
  expect(mockSeasonState.showToast).toHaveBeenCalledWith("Osterei gefunden: 4 von 12", 3000);
  expect(progress).toHaveBeenCalledWith(expect.objectContaining({ found: 4, total: 12, active: true }));
  expect(huntState().spots).toEqual([]);
  stop();
});

test("das letzte Ei füllt den Korb - mit dem Weg zum Korb", async () => {
  mockApi.findEgg.mockResolvedValue({ found: 12, total: 12, completed_now: true, rank: 2 });
  setHuntSpots({ screen: "Dashboard", route: "app:Dashboard", spots: [{ egg: EGGS.eggs[0], perchId: "card-a", corner: "tr" }], guest: false, total: 12 });
  await render(<HuntEggView spot={huntState().spots[0]} />);
  await fireEvent.press(screen.getByTestId("hunt-egg-3"));
  await flush(0);
  const [title, text, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
  expect(title).toBe("Korb voll!");
  expect(text).toContain("Platz 2");
  buttons[1].onPress();
  expect(mockNavigate).toHaveBeenCalledWith("More", { screen: "EasterHunt", initial: false });
});

test("zu schnell: freundlicher Hinweis; abgelaufener Schlüssel: neu holen und einmal nachfassen", async () => {
  setHuntSpots({ screen: "Dashboard", route: "app:Dashboard", spots: [{ egg: EGGS.eggs[0], perchId: "card-a", corner: "tr" }], guest: false, total: 12 });
  mockApi.findEgg.mockRejectedValueOnce({ response: { status: 429 } });
  await render(<HuntEggView spot={huntState().spots[0]} />);
  await fireEvent.press(screen.getByTestId("hunt-egg-3"));
  await flush(0);
  expect(mockSeasonState.showToast).toHaveBeenCalledWith("Langsam – ein Ei nach dem anderen.", 3000);

  mockApi.findEgg.mockRejectedValueOnce({ response: { status: 410 } }).mockResolvedValueOnce({ found: 5, total: 12 });
  mockApi.fetchEggs.mockResolvedValue({ ...EGGS, eggs: [{ ...EGGS.eggs[0], token: "3.fresh" }] });
  await fireEvent.press(screen.getByTestId("hunt-egg-3"));
  await flush(0);
  expect(mockApi.fetchEggs).toHaveBeenCalledWith("app:Dashboard");
  expect(mockApi.findEgg).toHaveBeenLastCalledWith("3.fresh");
});

test("das Widget zeigt den Korb und folgt jedem Fund; antippen öffnet den Korb", async () => {
  mockApi.fetchBasket.mockResolvedValue({ active: true, found: 2, total: 12 });
  await render(<HuntWidget season={SEASON} screen="Dashboard" />);
  await flush(0);
  expect(screen.getByTestId("hunt-widget-count")).toHaveTextContent("2/12");
  await act(async () => {
    emitHuntProgress({ found: 3, total: 12, active: true });
  });
  expect(screen.getByTestId("hunt-widget-count")).toHaveTextContent("3/12");
  await fireEvent.press(screen.getByTestId("hunt-widget"));
  expect(mockNavigate).toHaveBeenCalledWith("More", { screen: "EasterHunt", initial: false });
});

test("Oster-Deko: während einer laufenden Suche Blumen an der Begrüßungskarte - Eier erst, wenn feststeht, dass keine läuft", async () => {
  mockSeasonState.byKey = { easter_hunt: { ...SEASON } };
  const easter = { ...SEASON, key: "easter", phase: "deko", data: { quiet: false, sunday: "2027-03-28" } };
  await render(<EasterEdge season={easter} screen="Dashboard" />);
  expect(screen.getAllByTestId("easter-edge-flower").length).toBeGreaterThan(0);
  await act(async () => {
    reportHuntActive(true);
  });
  expect(screen.queryAllByTestId("easter-edge-egg")).toHaveLength(0);
  await act(async () => {
    reportHuntActive(false);
  });
  expect(screen.getAllByTestId("easter-edge-egg").length).toBeGreaterThan(0);
});
